'use strict';
const crypto = require('crypto');
const fs   = require('fs');
const path = require('path');
const url  = require('url');
const { Q, db } = require('./db');
const { verifyToken, makeToken, uid, randColor, hashPassword, verifyPassword, isScryptHash } = require('./helpers');
const ws = require('./ws');
const { corsHeaders } = require('./cors');
const { checkRateLimit, checkRateLimitByUser, getClientIp } = require('./ratelimit');

function sha256Hex(s) { return crypto.createHash('sha256').update(String(s)).digest('hex'); }

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const UPLOAD   = path.join(DATA_DIR, 'uploads');
if (!fs.existsSync(UPLOAD)) fs.mkdirSync(UPLOAD, { recursive: true });
const tgPendingProfiles = new Map();

/* ── helpers ── */
// CORS + xavfsizlik headerlari res.setHeader bilan oldindan qo'yiladi (route()
// boshida), shuning uchun json() ularni qayta yozib yubormasligi uchun faqat
// Content-Type'ni beradi.
function json(res, data, code = 200) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}
// Tokenni tekshiradi VA bazadagi pass_version bilan solishtiradi — parol
// o'zgargan bo'lsa (pass_version oshgan bo'lsa) eski token rad etiladi,
// ya'ni parol tiklanganda barcha eski sessiyalar avtomatik bekor bo'ladi.
async function getAuth(req) {
  const h = req.headers.authorization || '';
  const tok = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!tok) return null;
  const decoded = verifyToken(tok);
  if (!decoded) return null;
  const row = await db.get('SELECT pass_version FROM users WHERE id=$1', [decoded.userId]);
  if (!row) return null;
  if ((row.pass_version || 1) !== (decoded.pv || 1)) return null;
  return decoded.userId;
}
// Returns user id if authed and not banned, else sends error and returns null
async function getAuthNotBanned(req, res) {
  const u2 = await getAuth(req);
  if (!u2) { json(res, { error: 'Unauthorized' }, 401); return null; }
  const user = await Q.uById(u2);
  if (!user) { json(res, { error: 'Topilmadi' }, 404); return null; }
  if (user.is_banned) {
    if (user.ban_expires_at && Math.floor(Date.now()/1000) > user.ban_expires_at) {
      await Q.uUnban(u2);
    } else {
      const expText = user.ban_expires_at ? ` (${new Date(user.ban_expires_at*1000).toLocaleDateString('uz-UZ')} gacha)` : '';
      json(res, { error: `Hisob bloklangan: ${user.ban_reason || ''}${expText}`, banned: true }, 403); return null;
    }
  }
  return u2;
}
async function readBody(req) {
  return new Promise((ok, err) => {
    let d = '';
    req.on('data', c => d += c);
    req.on('end', () => { try { ok(JSON.parse(d || '{}')); } catch { ok({}); } });
    req.on('error', err);
  });
}
// Multipart body uchun umumiy qattiq chegara — eng katta ruxsat etilgan fayl
// (video, 100MB) + maydonlar uchun zaxira. Shundan oshsa, oqim darhol yopiladi —
// butun body hech qachon bundan ko'p RAM egallamaydi.
const MAX_MULTIPART_BYTES = 105 * 1024 * 1024;

async function parseMultipart(req) {
  return new Promise((ok, err) => {
    const ct = req.headers['content-type'] || '';
    const bm = ct.match(/boundary=(.+)/);
    if (!bm) return ok({ fields: {}, files: {} });
    const boundary = Buffer.from('--' + bm[1]);
    let chunks = [];
    let total = 0;
    let tooLarge = false;
    req.on('data', c => {
      if (tooLarge) return;
      total += c.length;
      if (total > MAX_MULTIPART_BYTES) {
        tooLarge = true;
        req.destroy();
        ok({ fields: {}, files: {}, tooLarge: true });
        return;
      }
      chunks.push(c);
    });
    req.on('error', e => { if (!tooLarge) err(e); });
    req.on('end', () => {
      if (tooLarge) return;
      const body = Buffer.concat(chunks);
      const parts = [];
      let start = 0;
      while (true) {
        const idx = body.indexOf(boundary, start);
        if (idx === -1) break;
        if (start > 0) parts.push(body.slice(start, idx - 2));
        start = idx + boundary.length + 2;
      }
      const fields = {};
      const files  = {};
      for (const part of parts) {
        const headerEnd = part.indexOf('\r\n\r\n');
        if (headerEnd === -1) continue;
        const header = part.slice(0, headerEnd).toString();
        const data   = part.slice(headerEnd + 4);
        const nameM  = header.match(/name="([^"]+)"/);
        const fileM  = header.match(/filename="([^"]+)"/);
        const ctM    = header.match(/Content-Type: (.+)/);
        if (!nameM) continue;
        const name = nameM[1];
        if (fileM && data.length > 0) {
          const filename = fileM[1];
          const ext = path.extname(filename).toLowerCase() || '.bin';
          files[name] = { data, ext, mime: (ctM ? ctM[1].trim() : 'application/octet-stream'), filename };
        } else {
          fields[name] = data.toString().trim();
        }
      }
      ok({ fields, files });
    });
  });
}
const UPLOAD_SIZE_LIMITS = {
  image: 10 * 1024 * 1024,
  audio: 25 * 1024 * 1024,
  video: 100 * 1024 * 1024,
};

// Kengaytmadan tashqari fayl imzosini (magic bytes) ham tekshiradi — kengaytmani
// almashtirib boshqa turdagi fayl (masalan .exe'ni .jpg deb) yuklashning oldini oladi.
function checkMagicBytes(buf, ext) {
  if (!buf || buf.length < 12) return false;
  switch (ext) {
    case '.jpg': case '.jpeg':
      return buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF;
    case '.png':
      return buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47;
    case '.gif':
      return buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38;
    case '.webp':
      return buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP';
    case '.mp4': case '.mov':
      return buf.slice(4, 8).toString('ascii') === 'ftyp';
    case '.webm': case '.mkv':
      return buf[0] === 0x1A && buf[1] === 0x45 && buf[2] === 0xDF && buf[3] === 0xA3;
    case '.mp3':
      return (buf[0] === 0xFF && (buf[1] & 0xE0) === 0xE0) || buf.slice(0, 3).toString('ascii') === 'ID3';
    case '.wav':
      return buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WAVE';
    case '.ogg':
      return buf.slice(0, 4).toString('ascii') === 'OggS';
    case '.avi':
      return buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 11).toString('ascii') === 'AVI';
    case '.m4a': case '.aac': case '.heic':
      // Bu formatlar uchun oddiy/ishonchli universal signature yo'q —
      // kengaytma + MIME turiga tayanamiz.
      return true;
    default:
      return true;
  }
}

function saveFile(fileObj, allowedExts, kind = 'image') {
  if (!fileObj || !fileObj.data || fileObj.data.length === 0) return null;
  const ext = fileObj.ext.toLowerCase();
  if (allowedExts && !allowedExts.includes(ext)) return null;
  const maxSize = UPLOAD_SIZE_LIMITS[kind] || UPLOAD_SIZE_LIMITS.image;
  if (fileObj.data.length > maxSize) return null;
  if (!checkMagicBytes(fileObj.data, ext)) return null;
  const fn = uid() + ext;
  fs.writeFileSync(path.join(UPLOAD, fn), fileObj.data);
  return `/uploads/${fn}`;
}
function ago(ts) {
  const d = Math.floor(Date.now()/1000) - ts;
  if (d < 60) return d + 's';
  if (d < 3600) return Math.floor(d/60) + 'm';
  if (d < 86400) return Math.floor(d/3600) + 'soat';
  return Math.floor(d/86400) + 'k';
}
async function fmtPost(p, uid2) {
  const myVote = uid2 ? (await Q.pvGet(uid2, p.id))?.vote || 0 : 0;
  const saved  = uid2 ? !!(await Q.svCheck(uid2, p.id)) : false;
  // Add poll if exists
  let poll = null;
  try {
    const pollRow = await Q.pollGet(p.id);
    if (pollRow) {
      const options = JSON.parse(pollRow.options);
      const counts  = await Q.pollVoteCnt(pollRow.id);
      const total   = (await Q.pollTotalVotes(pollRow.id)).c;
      const myVoteIdx = uid2 ? (await Q.pollVoteGet(uid2, pollRow.id))?.option_index ?? -1 : -1;
      const countsMap = {};
      counts.forEach(r => { countsMap[r.option_index] = r.cnt; });
      poll = {
        id: pollRow.id,
        question: pollRow.question,
        options: options.map((opt, i) => ({
          text: opt,
          votes: countsMap[i] || 0,
          pct: total > 0 ? Math.round((countsMap[i]||0)/total*100) : 0
        })),
        total,
        my_vote: myVoteIdx,
        ends_at: pollRow.ends_at,
        ended: pollRow.ends_at < Math.floor(Date.now()/1000)
      };
    }
  } catch {}
  // Klaster ma'lumoti — faqat muammo/g'oya postlari uchun (feed tezligini saqlash uchun
  // oddiy postlar uchun bu qidiruv butunlay o'tkazib yuboriladi)
  let clusterInfo = { cluster_id: null, cluster_title: null, cluster_size: null };
  if (p.kind === 'problem' || p.kind === 'idea') {
    try {
      const cm = await Q.cmByPostId(p.id);
      if (cm) {
        const cl = await Q.clById(cm.cluster_id);
        if (cl) clusterInfo = { cluster_id: cl.id, cluster_title: cl.title, cluster_size: cl.member_count };
      }
    } catch {}
  }
  return { ...p, my_vote: myVote, saved, poll, ...clusterInfo, ago: ago(p.created_at) };
}
async function fmtCmt(c, uid2) {
  const myVote = uid2 ? (await Q.cvGet(uid2, c.id))?.vote || 0 : 0;
  return { ...c, my_vote: myVote, ago: ago(c.created_at) };
}
function fmtNotif(n) {
  return { ...n, ago: ago(n.created_at) };
}

/* ── notify followers when user posts ── */
async function notifyFollowers(posterId, post) {
  try {
    const followers = await Q.fwFollowersList(posterId);
    const poster = await Q.uById(posterId);
    if (!poster || !followers.length) return;
    for (const { follower_id } of followers) {
      const nid = uid();
      await Q.nInsert(nid, follower_id, posterId, 'new_post', post.id, null,
        `${poster.name} yangi post qo'shdi: ${post.title.slice(0,50)}`);
      ws.sendTo(follower_id, {
        type: 'notif',
        data: {
          id: nid, type: 'new_post', post_id: post.id,
          msg: `${poster.name} yangi post qo'shdi: ${post.title.slice(0,40)}`,
          fn: poster.name, fa: poster.avatar, fc: poster.color,
          is_read: 0, ago: 'Hozir'
        }
      });
    }
  } catch(e) { console.error('notifyFollowers:', e.message); }
}

function tooManyRequests(res, retryAfter) {
  res.setHeader('Retry-After', String(retryAfter));
  return json(res, { error: `Juda ko'p urinish. ${retryAfter} soniyadan keyin qayta urinib ko'ring` }, 429);
}

async function route(req, res) {
  const cors = corsHeaders(req);
  for (const k in cors) res.setHeader(k, cors[k]);

  const parsed = url.parse(req.url, true);
  const p = parsed.pathname.replace(/\/$/, '') || '/';
  const q = parsed.query;
  const m = req.method;

  // Umumiy IP-asosli rate limit: barcha /api/* uchun 300/daqiqa
  const globalRl = checkRateLimit(req, 'global', 300, 60);
  if (!globalRl.ok) return tooManyRequests(res, globalRl.retryAfter);

  /* ══ AUTH ══ */
  if (p === '/api/auth/telegram-login' && m === 'POST') {
    const b = await readBody(req);
    const { id, first_name, username, photo_url, auth_date, hash } = b;
    if (!id || !auth_date || !hash) return json(res, { error: "Ma'lumotlar to'liq emas" }, 400);
    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
    const dataCheckString = [`auth_date=${auth_date}`, `first_name=${first_name || ''}`, `id=${id}`, `photo_url=${photo_url || ''}`, `username=${username || ''}`].join('\n');
    const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
    if (computedHash !== hash) return json(res, { error: "Tekshiruvdan o'tmadi" }, 403);
    const age = Math.floor(Date.now() / 1000) - Number(auth_date);
    if (age > 86400) return json(res, { error: "Sessiya muddati tugagan" }, 403);
    const tgId = String(id);
    let user = await Q.uByTgId(tgId);
    if (!user) {
      const tempToken = crypto.randomBytes(32).toString('hex');
      tgPendingProfiles.set(tempToken, { tgId, first_name: first_name || '', username: username || '', photo_url: photo_url || '', expires: Date.now() + 300000 });
      return json(res, { needProfile: true, tempToken });
    }
    const fullUser = await Q.uById(user.id);
    return json(res, { token: makeToken(user.id, fullUser.pass_version || 1), user: fullUser });
  }
  if (p === '/api/auth/telegram-finish' && m === 'POST') {
    const b = await readBody(req);
    const { tempToken, name, username } = b;
    if (!tempToken || !name || !username) return json(res, { error: "Ma'lumotlar to'liq emas" }, 400);
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) return json(res, { error: 'Username: 3-20 belgi, faqat harf/raqam/_' }, 400);
    const pending = tgPendingProfiles.get(tempToken);
    if (!pending || Date.now() > pending.expires) return json(res, { error: "Sessiya tugagan. Qaytadan kirish kerak" }, 403);
    tgPendingProfiles.delete(tempToken);
    if (await Q.uByUsername(username)) return json(res, { error: 'Bu username band' }, 409);
    const newId = uid();
    const email = `tg_${pending.tgId}@mindhub.local`;
    await Q.uInsert(newId, username.toLowerCase(), name.trim(), email, crypto.randomBytes(32).toString('hex'), randColor());
    await Q.uSetTgId(pending.tgId, newId);
    if (pending.photo_url) await Q.uUpdAv(pending.photo_url, newId);
    // Telegram orqali kirgan foydalanuvchilar uchun email tasdiqlash talab qilinmaydi
    await Q.uSetEmailVerified(newId);
    const tgUser = await Q.uById(newId);
    return json(res, { token: makeToken(newId, tgUser.pass_version || 1), user: tgUser });
  }
  if (p === '/api/auth/register' && m === 'POST') {
    const rl = checkRateLimit(req, 'register', 5, 3600);
    if (!rl.ok) return tooManyRequests(res, rl.retryAfter);
    const b = await readBody(req);
    const { username, name, email, password } = b;
    if (!username || !name || !email || !password) return json(res, { error: "Barcha maydonlarni to'ldiring" }, 400);
    if (password.length < 6) return json(res, { error: 'Parol kamida 6 belgi' }, 400);
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) return json(res, { error: 'Username: 3-20 belgi, faqat harf/raqam/_' }, 400);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(res, { error: "Email formati noto'g'ri" }, 400);
    if (await Q.uExists(username, email)) return json(res, { error: 'Bu username yoki email band' }, 409);
    const id = uid();
    const emailLower = email.toLowerCase();
    await Q.uInsert(id, username.toLowerCase(), name, emailLower, hashPassword(password), '#' + Math.floor(Math.random()*0xFFFFFF).toString(16).padStart(6,'0'));
    // 2 bosqichli ro'yxatdan o'tish: to'liq token BERILMAYDI — avval emailga
    // yuborilgan kodni tasdiqlash kerak (/api/auth/verify-email)
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = Math.floor(Date.now()/1000) + 900;
    await Q.ecInsert(id, emailLower, sha256Hex(code), 'register', expiresAt, getClientIp(req));
    try {
      const { sendVerifyCode } = require('./mailer');
      await sendVerifyCode(emailLower, code, username);
    } catch (e) { console.error('sendVerifyCode xatoligi:', e.message); }
    return json(res, {
      pending: true,
      user_id: id,
      email_masked: emailLower.replace(/(.{2}).*(@.*)/, '$1***$2'),
      expires_in: 900
    }, 201);
  }
  if (p === '/api/auth/verify-email' && m === 'POST') {
    const rl = checkRateLimit(req, 'verify-email', 20, 3600);
    if (!rl.ok) return tooManyRequests(res, rl.retryAfter);
    const b = await readBody(req);
    const { user_id, code } = b;
    if (!user_id || !code) return json(res, { error: "Ma'lumotlar to'liq emas" }, 400);
    const row = await Q.ecGetActive(user_id, 'register');
    if (!row) return json(res, { error: "Kod topilmadi yoki muddati tugagan. Yangi kod so'rang" }, 400);
    if (row.attempts >= row.max_attempts) return json(res, { error: "Urinishlar tugadi, yangi kod so'rang" }, 429);
    if (sha256Hex(String(code).trim()) !== row.code_hash) {
      await Q.ecIncAttempts(row.id);
      return json(res, { error: "Kod noto'g'ri" }, 400);
    }
    await Q.ecMarkUsed(row.id);
    await Q.uSetEmailVerified(user_id);
    const user = await Q.uById(user_id);
    if (!user) return json(res, { error: 'Topilmadi' }, 404);
    try { require('./mailer').sendWelcome(user.email, user.username).catch(()=>{}); } catch {}
    return json(res, { token: makeToken(user_id, user.pass_version || 1), user });
  }
  if (p === '/api/auth/resend-code' && m === 'POST') {
    const rl = checkRateLimit(req, 'resend-code', 10, 3600);
    if (!rl.ok) return tooManyRequests(res, rl.retryAfter);
    const b = await readBody(req);
    const { user_id } = b;
    if (!user_id) return json(res, { error: 'user_id kerak' }, 400);
    const user = await Q.uByIdFull(user_id);
    if (!user) return json(res, { error: 'Topilmadi' }, 404);
    if (user.email_verified) return json(res, { error: 'Email allaqachon tasdiqlangan' }, 400);
    const last = await Q.ecLatest(user_id, 'register');
    if (last) {
      const elapsed = Math.floor(Date.now()/1000) - last.created_at;
      if (elapsed < 60) return json(res, { error: `${60-elapsed} soniyadan keyin qayta urinib ko'ring`, retry_after: 60-elapsed }, 429);
    }
    const countRow = await Q.ecCountLastHour(user_id, 'register');
    if (countRow.c >= 5) return json(res, { error: "Bir soatda faqat 5 marta so'rash mumkin" }, 429);
    await Q.ecInvalidateOthers(user_id, 'register');
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = Math.floor(Date.now()/1000) + 900;
    await Q.ecInsert(user_id, user.email, sha256Hex(code), 'register', expiresAt, getClientIp(req));
    try {
      const { sendVerifyCode } = require('./mailer');
      await sendVerifyCode(user.email, code, user.username);
    } catch (e) { console.error('sendVerifyCode xatoligi:', e.message); }
    return json(res, { ok: true });
  }
  if (p === '/api/auth/login' && m === 'POST') {
    const rl = checkRateLimit(req, 'login', 10, 900);
    if (!rl.ok) return tooManyRequests(res, rl.retryAfter);
    const b = await readBody(req);
    const { username, password } = b;
    if (!username || !password) return json(res, { error: 'Login va parolni kiriting' }, 400);
    const user = await Q.uByLogin(username);
    if (!user || !verifyPassword(password, user.pass)) return json(res, { error: "Noto'g'ri login yoki parol" }, 401);
    if (!isScryptHash(user.pass)) {
      // Shaffof migratsiya: eski hmac formatidagi parolni scrypt'ga qayta hashlab yozib qo'yamiz
      await Q.uUpdPass(hashPassword(password), user.id);
    }
    if (!user.email_verified) {
      return json(res, { error: 'Email tasdiqlanmagan', need_verification: true, user_id: user.id }, 403);
    }
    if (user.is_banned) {
      if (user.ban_expires_at && Math.floor(Date.now()/1000) > user.ban_expires_at) { await Q.uUnban(user.id); }
      else { const expText = user.ban_expires_at ? ` (${new Date(user.ban_expires_at*1000).toLocaleDateString('uz-UZ')} gacha)` : ''; return json(res, { error: `Hisob bloklangan: ${user.ban_reason || ''}${expText}` }, 403); }
    }
    const freshUser = await Q.uById(user.id);
    return json(res, { token: makeToken(user.id, freshUser.pass_version || 1), user: freshUser });
  }
  if (p === '/api/auth/forgot' && m === 'POST') {
    const rl = checkRateLimit(req, 'forgot', 5, 3600);
    if (!rl.ok) return tooManyRequests(res, rl.retryAfter);
    const b = await readBody(req);
    const uname = (b.username || '').trim().toLowerCase();
    if (!uname) return json(res, { error: 'Username kiriting' }, 400);
    await Q.rtClean();
    const user = await Q.uByUsername(uname);
    if (user) {
      const token = crypto.randomBytes(32).toString('hex');
      await Q.rtInsert(token, user.id, Math.floor(Date.now()/1000) + 3600);
      const appUrl = process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;
      const link = `${appUrl}/?reset_token=${token}`;
      try {
        const full = await Q.uByLogin(uname);
        await require('./mailer').sendPasswordResetLink(full.email, link, full.username);
      } catch (e) { console.error('sendPasswordResetLink xatoligi:', e.message); }
    }
    return json(res, { ok: true });
  }
  if (p === '/api/auth/reset/verify' && m === 'POST') {
    const b = await readBody(req);
    const rt = await Q.rtGet(b.token || '');
    if (!rt) return json(res, { valid: false });
    const user = await Q.uById(rt.user_id);
    return json(res, { valid: true, username: user?.username || '' });
  }
  if (p === '/api/auth/reset' && m === 'POST') {
    const b = await readBody(req);
    if (!b.token || !b.new_pass) return json(res, { error: 'Token va yangi parol kerak' }, 400);
    if (b.new_pass.length < 6) return json(res, { error: 'Parol kamida 6 belgi' }, 400);
    const rt = await Q.rtGet(b.token);
    if (!rt) return json(res, { error: "Havola eskirgan yoki noto'g'ri" }, 400);
    await Q.uUpdPass(hashPassword(b.new_pass), rt.user_id);
    await Q.rtUse(b.token);
    return json(res, { ok: true });
  }

  /* ══ EMAIL CODE RESET ══ */
  if (p === '/api/auth/send-code' && m === 'POST') {
    const rl = checkRateLimit(req, 'send-code', 3, 3600);
    if (!rl.ok) return tooManyRequests(res, rl.retryAfter);
    try {
      const b = await readBody(req);
      const uname = (b.username || '').trim().toLowerCase();
      if (!uname) return json(res, { error: 'Username kiriting' }, 400);
      try { await Q.vcClean(); } catch(e) { console.error('vcClean:', e.message); }
      const user = await Q.uByUsername(uname);
      if (!user || !user.email) return json(res, { error: 'Foydalanuvchi topilmadi' }, 404);
      const code = String(Math.floor(100000 + Math.random() * 900000));
      const expiresAt = Math.floor(Date.now() / 1000) + 600;
      await Q.vcInsert(user.id, code, expiresAt);
      let sent = false;
      try {
        const { sendVerifyCode } = require('./mailer');
        const r = await sendVerifyCode(user.email, code, user.username);
        sent = !r || !r.dev; // dev rejimida (RESEND_API_KEY yo'q) faqat konsolga chiqadi — pastdagi TG fallback ham sinab ko'rilsin
      } catch (e) {
        console.error('Email xatoligi:', e.message);
      }
      if (!sent) {
        try {
          const u2 = await db.get('SELECT tg_chat_id FROM users WHERE id=$1', [user.id]);
          if (u2 && u2.tg_chat_id) {
            const https = require('https');
            const botToken = process.env.TELEGRAM_BOT_TOKEN;
            const msg = `🔐 MindHub parol tiklash kodi: ${code}\n\nBu kod 10 daqiqa davomida amal qiladi.`;
            await new Promise((resolve) => {
              const req2 = https.request(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }
              }, (resp) => { let d = ''; resp.on('data', c => d += c); resp.on('end', () => { sent = true; resolve(); }); });
              req2.on('error', (e) => { console.error('TG send error:', e.message); resolve(); });
              req2.write(JSON.stringify({ chat_id: u2.tg_chat_id, text: msg }));
              req2.end();
            });
          }
        } catch (e) { console.error('TG fallback error:', e.message); }
      }
      return json(res, { ok: true, email: user.email.replace(/(.{2}).*(@.*)/, '$1***$2'), sent });
    } catch (e) {
      console.error('send-code xatoligi:', e.message, e.stack);
      return json(res, { error: 'Xatolik: ' + e.message }, 500);
    }
  }
  if (p === '/api/auth/verify-code' && m === 'POST') {
    const b = await readBody(req);
    if (!b.username || !b.code) return json(res, { error: 'Username va kod kerak' }, 400);
    const user = await Q.uByUsername(b.username.trim().toLowerCase());
    if (!user) return json(res, { error: 'Topilmadi' }, 404);
    const vc = await Q.vcGet(user.id, b.code.trim());
    if (!vc) return json(res, { error: "Kod noto'g'ri yoki muddati tugagan" }, 400);
    const resetToken = require('crypto').randomBytes(32).toString('hex');
    await Q.rtInsert(resetToken, user.id, Math.floor(Date.now() / 1000) + 1800);
    await Q.vcUse(vc.id);
    return json(res, { ok: true, reset_token: resetToken, username: user.username });
  }

  /* ══ ME ══ */
  if (p === '/api/me' && m === 'GET') {
    const u2 = await getAuth(req); if (!u2) return json(res, { error: 'Unauthorized' }, 401);
    const user = await Q.uById(u2); if (!user) return json(res, { error: 'Topilmadi' }, 404);
    const followers = (await Q.fwFollowers(u2)).c;
    const following = (await Q.fwFollowing(u2)).c;
    return json(res, { ...user, followers, following });
  }
  if (p === '/api/me' && m === 'PUT') {
    const u2 = await getAuth(req); if (!u2) return json(res, { error: 'Unauthorized' }, 401);
    const b = await readBody(req);
    await Q.uUpdProf((b.name || '').trim(), (b.bio || '').trim(), u2);
    if (b.email) await db.run('UPDATE users SET email=$1 WHERE id=$2', [b.email.trim().toLowerCase(), u2]);
    return json(res, await Q.uById(u2));
  }
  if (p === '/api/me/phone' && m === 'PUT') {
    const u2 = await getAuth(req); if (!u2) return json(res, { error: 'Unauthorized' }, 401);
    const b = await readBody(req);
    const phone = (b.phone || '').trim();
    if (!phone || !/^\+?\d{10,15}$/.test(phone)) return json(res, { error: 'Raqam formati: +998901234567' }, 400);
    await Q.uSetPhone(phone, u2);
    return json(res, { ok: true, phone });
  }
  if (p === '/api/me/avatar' && m === 'POST') {
    const u2 = await getAuth(req); if (!u2) return json(res, { error: 'Unauthorized' }, 401);
    const { files } = await parseMultipart(req);
    const img = saveFile(files.image, ['.jpg','.jpeg','.png','.gif','.webp']);
    if (!img) return json(res, { error: 'Rasm yuklanmadi' }, 400);
    await Q.uUpdAv(img, u2);
    return json(res, { avatar: img });
  }
  if (p === '/api/me/banner' && m === 'POST') {
    const u2 = await getAuth(req); if (!u2) return json(res, { error: 'Unauthorized' }, 401);
    const { files } = await parseMultipart(req);
    const img = saveFile(files.image, ['.jpg','.jpeg','.png','.gif','.webp']);
    if (!img) return json(res, { error: 'Rasm yuklanmadi' }, 400);
    await Q.uUpdBanner(img, u2);
    return json(res, { banner: img });
  }
  if (p === '/api/me/password' && m === 'PUT') {
    const u2 = await getAuth(req); if (!u2) return json(res, { error: 'Unauthorized' }, 401);
    const b = await readBody(req);
    const user = await Q.uByIdFull(u2);
    if (!user || !verifyPassword(b.old_pass || '', user.pass)) return json(res, { error: "Eski parol noto'g'ri" }, 400);
    if (!b.new_pass || b.new_pass.length < 6) return json(res, { error: 'Yangi parol kamida 6 belgi' }, 400);
    await Q.uUpdPass(hashPassword(b.new_pass), u2);
    return json(res, { ok: true });
  }
  if (p === '/api/me/push-token' && m === 'POST') {
    const u2 = await getAuth(req); if (!u2) return json(res, { error: 'Unauthorized' }, 401);
    const b = await readBody(req);
    if (b.token) await Q.pushIns(u2, b.token);
    return json(res, { ok: true });
  }
  if (p === '/api/me/push-token' && m === 'DELETE') {
    const u2 = await getAuth(req); if (!u2) return json(res, { error: 'Unauthorized' }, 401);
    const b = await readBody(req);
    if (b.token) await Q.pushDel(u2, b.token);
    return json(res, { ok: true });
  }

  /* ══ USERS ══ */
  if (p.match(/^\/api\/users\/[^/]+$/) && m === 'GET') {
    const u2 = await getAuth(req);
    const param = p.split('/')[3];
    const user  = await Q.uBySlug(param);
    if (!user) return json(res, { error: 'Topilmadi' }, 404);
    const postRows = await Q.pByUser(user.id);
    const posts = [];
    for (const r of postRows) posts.push(await fmtPost(r, u2));
    const followers = (await Q.fwFollowers(user.id)).c;
    const following = (await Q.fwFollowing(user.id)).c;
    const is_following = u2 ? !!(await Q.fwCheck(u2, user.id)) : false;
    const is_me = u2 === user.id;
    return json(res, { ...user, posts, followers, following, is_following, is_me, online: ws.isOnline(user.id) });
  }
  if (p.match(/^\/api\/users\/search$/) && m === 'GET') {
    const sq = (q.q || '').toLowerCase();
    const users = await Q.uSearch('%'+sq+'%', '%'+sq+'%');
    return json(res, users);
  }
  if (p.match(/^\/api\/users\/[^/]+\/follow$/) && m === 'POST') {
    const u2 = await getAuthNotBanned(req, res); if (!u2) return true;
    const param = p.split('/')[3];
    const target = await Q.uBySlug(param);
    if (!target || target.id === u2) return json(res, { error: 'Ruxsat' }, 400);
    const isFollowing = !!(await Q.fwCheck(u2, target.id));
    if (isFollowing) {
      await Q.fwDelete(u2, target.id);
      await Q.uFollowers(target.id);
      return json(res, { following: false });
    }
    await Q.fwInsert(u2, target.id);
    await Q.uFollowers(target.id);
    const from = await Q.uById(u2);
    const nid  = uid();
    await Q.nInsert(nid, target.id, u2, 'follow', null, null, `${from.name} sizni kuzata boshladi`);
    ws.sendTo(target.id, {
      type: 'notif',
      data: {
        id: nid, type: 'follow', from_id: u2,
        msg: `${from.name} sizni kuzata boshladi`,
        fn: from.name, fa: from.avatar, fc: from.color,
        is_read: 0, ago: 'Hozir'
      }
    });
    return json(res, { following: true });
  }

  /* ══ COMMUNITIES ══ */
  if (p === '/api/communities' && m === 'GET') {
    const u2 = await getAuth(req);
    const sq = q.q ? q.q.toLowerCase() : null;
    const coms = sq ? await Q.comSearch('%'+sq+'%','%'+sq+'%') : await Q.comAll();
    const out = [];
    for (const c of coms) {
      const isMember = u2 ? !!(await Q.memCheck(u2, c.id)) : false;
      if (c.is_private && !isMember && u2 !== c.owner_id) continue;
      const role = u2 ? await Q.comRoleGet(u2, c.id) : null;
      out.push({
        ...c,
        is_member: isMember,
        is_owner: u2 === c.owner_id,
        is_admin: !!(role && role.role === 'admin'),
        pending_request: u2 ? !!(await Q.comReqGet(u2, c.id)) : false
      });
    }
    return json(res, out);
  }
  if (p.match(/^\/api\/communities\/[^/]+$/) && m === 'GET') {
    const u2 = await getAuth(req);
    const slug = p.split('/')[3];
    const com  = await Q.comBySlug(slug);
    if (!com) return json(res, { error: 'Topilmadi' }, 404);
    const isMember = u2 ? !!(await Q.memCheck(u2, com.id)) : false;
    if (com.is_private && !isMember && u2 !== com.owner_id) return json(res, { error: "Maxfiy jamoa" }, 403);
    await Q.comIncViews(com.id);
    const role = u2 ? await Q.comRoleGet(u2, com.id) : null;
    const admins = await Q.comRoleList(com.id);
    const pendingReqs = (u2 && (u2 === com.owner_id || (role && role.role === 'admin'))) ? await Q.comReqByCom(com.id) : [];
    return json(res, {
      ...com,
      views: (com.views || 0) + 1,
      is_member: u2 ? !!(await Q.memCheck(u2, com.id)) : false,
      is_owner: u2 === com.owner_id,
      is_admin: !!(role && role.role === 'admin'),
      pending_request: u2 ? !!(await Q.comReqGet(u2, com.id)) : false,
      admins,
      pending_requests: pendingReqs
    });
  }
  if (p === '/api/communities' && m === 'POST') {
    const u2 = await getAuthNotBanned(req, res); if (!u2) return true;
    const b = await readBody(req);
    const slug = (b.slug || '').toLowerCase().trim().replace(/\s+/g,'-');
    const name = (b.name || '').trim();
    if (!slug || !/^[a-z0-9_-]{2,32}$/.test(slug)) return json(res, { error: "Slug: 2-32 belgi, faqat kichik harf/raqam/_/-" }, 400);
    if (!name) return json(res, { error: "Nom kiritng" }, 400);
    if (await Q.comBySlug(slug)) return json(res, { error: 'Bu slug band' }, 409);
    const cid = uid();
    const is_private = b.is_private ? 1 : 0;
    await Q.comInsert(cid, slug, name, (b.description||'').trim(), (b.color||'#C8922A'), u2, is_private);
    await Q.memJoin(u2, cid);
    await Q.comIncMem(cid);
    return json(res, await Q.comById(cid), 201);
  }
  if (p.match(/^\/api\/communities\/[^/]+$/) && m === 'DELETE') {
    const u2 = await getAuth(req); if (!u2) return json(res, { error: 'Unauthorized' }, 401);
    const slug = p.split('/')[3];
    const com  = await Q.comBySlug(slug);
    if (!com) return json(res, { error: 'Topilmadi' }, 404);
    const user = await Q.uById(u2);
    const role = await Q.comRoleGet(u2, com.id);
    if (com.owner_id !== u2 && !user?.is_admin && !(role && role.role === 'admin')) return json(res, { error: "Ruxsat yo'q" }, 403);
    await Q.comDelete(com.id);
    ws.sendAll({ type: 'com_deleted', data: { slug } });
    return json(res, { ok: true });
  }

  if (p.match(/^\/api\/communities\/[^/]+$/) && m === 'PUT') {
    const u2 = await getAuth(req); if (!u2) return json(res, { error: 'Unauthorized' }, 401);
    const slug = p.split('/')[3];
    const com = await Q.comBySlug(slug);
    if (!com) return json(res, { error: 'Topilmadi' }, 404);
    const user = await Q.uById(u2);
    const role = await Q.comRoleGet(u2, com.id);
    if (com.owner_id !== u2 && !user?.is_admin && !(role && role.role === 'admin')) return json(res, { error: "Ruxsat yo'q" }, 403);
    const ct = req.headers['content-type'] || '';
    let name = com.name, desc = com.description, rules = com.rules, color = com.color;
    let avatar = com.avatar, banner = com.banner;
    let is_private = com.is_private;
    if (ct.includes('multipart')) {
      const { fields, files } = await parseMultipart(req);
      name  = (fields.name  || com.name).trim();
      desc  = (fields.description || com.description || '').trim();
      rules = (fields.rules || com.rules || '').trim();
      color = fields.color || com.color;
      if (fields.is_private !== undefined) is_private = fields.is_private === 'true' || fields.is_private === '1' ? 1 : 0;
      if (files.avatar) { const r = saveFile(files.avatar,['.jpg','.jpeg','.png','.webp']); if(r) avatar=r; }
      if (files.banner) { const r = saveFile(files.banner,['.jpg','.jpeg','.png','.webp']); if(r) banner=r; }
    } else {
      const b = await readBody(req);
      name  = (b.name  || com.name).trim();
      desc  = (b.description || com.description || '').trim();
      rules = (b.rules || com.rules || '').trim();
      color = b.color || com.color;
      if (b.is_private !== undefined) is_private = b.is_private ? 1 : 0;
    }
    try {
      await Q.comUpdateFull(name, desc, rules, color, avatar||null, banner||null, com.id);
    } catch {
      await Q.comUpdate(name, desc, rules, color, com.id);
    }
    if (is_private !== com.is_private) {
      await db.run('UPDATE communities SET is_private=$1 WHERE id=$2', [is_private, com.id]);
    }
    return json(res, await Q.comBySlug(slug));
  }
  if (p.match(/^\/api\/communities\/[^/]+\/join$/) && m === 'POST') {
    const u2 = await getAuthNotBanned(req, res); if (!u2) return true;
    const slug = p.split('/')[3];
    const com  = await Q.comBySlug(slug);
    if (!com) return json(res, { error: 'Topilmadi' }, 404);
    const isMem = !!(await Q.memCheck(u2, com.id));
    if (isMem) { await Q.memLeave(u2, com.id); await Q.comDecMem(com.id); return json(res, { joined: false }); }
    if (com.is_private) {
      const existing = await Q.comReqGet(u2, com.id);
      if (existing) return json(res, { error: 'So\'rov allaqachon yuborilgan', pending: true });
      await Q.comReqInsert(uid(), u2, com.id);
      return json(res, { pending: true, message: 'So\'rov yuborildi, admin tasdiqlashi kerak' });
    }
    await Q.memJoin(u2, com.id); await Q.comIncMem(com.id);
    return json(res, { joined: true });
  }
  /* Community admin management */
  if (p.match(/^\/api\/communities\/[^/]+\/admin$/) && m === 'POST') {
    const u2 = await getAuthNotBanned(req, res); if (!u2) return true;
    const slug = p.split('/')[3];
    const com = await Q.comBySlug(slug);
    if (!com) return json(res, { error: 'Topilmadi' }, 404);
    if (com.owner_id !== u2) return json(res, { error: "Faqat egasi admin tayyorlay oladi" }, 403);
    const b = await readBody(req);
    if (!b.user_id) return json(res, { error: 'user_id kerak' }, 400);
    await Q.comRoleSet(b.user_id, com.id, 'admin');
    return json(res, { ok: true });
  }
  if (p.match(/^\/api\/communities\/[^/]+\/admin$/) && m === 'DELETE') {
    const u2 = await getAuthNotBanned(req, res); if (!u2) return true;
    const slug = p.split('/')[3];
    const com = await Q.comBySlug(slug);
    if (!com) return json(res, { error: 'Topilmadi' }, 404);
    if (com.owner_id !== u2) return json(res, { error: "Faqat egasi admin olib tashlay oladi" }, 403);
    const b = await readBody(req);
    if (!b.user_id) return json(res, { error: 'user_id kerak' }, 400);
    await Q.comRoleDel(b.user_id, com.id);
    return json(res, { ok: true });
  }
  /* Community request approve/reject */
  if (p.match(/^\/api\/communities\/[^/]+\/request\/[^/]+$/) && m === 'POST') {
    const u2 = await getAuthNotBanned(req, res); if (!u2) return true;
    const slug = p.split('/')[3];
    const reqId = p.split('/')[5];
    const com = await Q.comBySlug(slug);
    if (!com) return json(res, { error: 'Topilmadi' }, 404);
    const role = await Q.comRoleGet(u2, com.id);
    if (com.owner_id !== u2 && !(role && role.role === 'admin')) return json(res, { error: "Ruxsat yo'q" }, 403);
    const b = await readBody(req);
    if (b.action === 'approve') {
      await Q.comReqApprove(reqId);
      const request = await db.get('SELECT * FROM community_requests WHERE id=$1', [reqId]);
      if (request) {
        await Q.memJoin(request.user_id, com.id);
        await Q.comIncMem(com.id);
      }
    } else {
      await Q.comReqReject(reqId);
    }
    return json(res, { ok: true });
  }
  /* Popular teams by views */
  if (p === '/api/communities/popular' && m === 'GET') {
    const u2 = await getAuth(req);
    const coms = await Q.comByViews();
    const out = [];
    for (const c of coms) {
      const role = u2 ? await Q.comRoleGet(u2, c.id) : null;
      out.push({
        ...c,
        is_member: u2 ? !!(await Q.memCheck(u2, c.id)) : false,
        is_owner: u2 === c.owner_id,
        is_admin: !!(role && role.role === 'admin'),
        pending_request: u2 ? !!(await Q.comReqGet(u2, c.id)) : false
      });
    }
    return json(res, out);
  }
  /* My requests */
  if (p === '/api/communities/my-requests' && m === 'GET') {
    const u2 = await getAuth(req); if (!u2) return json(res, { error: 'Unauthorized' }, 401);
    const reqs = await Q.comReqAll(u2);
    return json(res, reqs);
  }

  /* ══ POSTS ══ */
  if (p === '/api/posts' && m === 'GET') {
    const u2   = await getAuth(req);
    const sort = q.sort || 'hot';
    const off  = parseInt(q.offset) || 0;
    let rows;
    if (sort === 'new')  rows = await Q.pNew(off);
    else if (sort === 'top') rows = await Q.pHot(off);
    else rows = await Q.pHot(off);
    const out = [];
    for (const r of rows) {
      if (r.community_id) {
        const pc = await db.get('SELECT is_private FROM communities WHERE id=$1', [r.community_id]);
        if (pc && pc.is_private) {
          const isMember = u2 ? !!(await Q.memCheck(u2, r.community_id)) : false;
          if (!isMember) continue;
        }
      }
      out.push(await fmtPost(r, u2));
    }
    return json(res, out);
  }
  if (p === '/api/posts/saved' && m === 'GET') {
    const u2 = await getAuth(req); if (!u2) return json(res, { error: 'Unauthorized' }, 401);
    const rows = await Q.pSaved(u2);
    const out = [];
    for (const r of rows) out.push(await fmtPost(r, u2));
    return json(res, out);
  }
  if (p.match(/^\/api\/posts\/[^/]+$/) && m === 'GET') {
    const u2   = await getAuth(req);
    const post = await Q.pOne(p.split('/')[3]);
    if (!post) return json(res, { error: 'Topilmadi' }, 404);
    const cm = await Q.cmByPost(post.id);
    const comments = [];
    for (const c of cm) comments.push(await fmtCmt(c, u2));
    return json(res, { ...await fmtPost(post, u2), comments });
  }
  if (p === '/api/posts' && m === 'POST') {
    const u2 = await getAuthNotBanned(req, res); if (!u2) return true;
    const rl = checkRateLimitByUser(u2, 'posts', 10, 3600);
    if (!rl.ok) return tooManyRequests(res, rl.retryAfter);
    const ct = req.headers['content-type'] || '';
    let title='', body='', comSlug='', type='text', link=null, image=null, video=null, audio=null, flair=null, kind='post';
    let pollQuestion=null, pollOptions=null, pollDays=3;

    if (ct.includes('multipart')) {
      const { fields, files } = await parseMultipart(req);
      title    = (fields.title    || '').trim();
      body     = (fields.body     || '').trim();
      comSlug  = (fields.community|| '').trim();
      type     = fields.type || 'text';
      link     = fields.link || null;
      flair    = fields.flair || null;
      kind     = fields.kind || 'post';
      pollQuestion = fields.poll_question || null;
      pollOptions  = fields.poll_options  ? JSON.parse(fields.poll_options) : null;
      pollDays     = parseInt(fields.poll_days) || 3;
      if (files.image) { image = saveFile(files.image,['.jpg','.jpeg','.png','.gif','.webp','.heic'],'image'); type='image'; }
      if (files.video) {
        video = saveFile(files.video,['.mp4','.webm','.mov','.avi','.mkv'],'video');
        if (!video) return json(res, { error: "Video: 100MB gacha, qo'llab-quvvatlanadigan format kerak" }, 400);
        type='video';
      }
      if (files.audio) { audio = saveFile(files.audio,['.mp3','.wav','.ogg','.m4a','.aac','.webm'],'audio'); type='audio'; }
    } else {
      const b  = await readBody(req);
      title    = (b.title    || '').trim();
      body     = (b.body     || '').trim();
      comSlug  = (b.community|| '').trim();
      type     = b.type || 'text';
      link     = b.link || null;
      flair    = b.flair || null;
      kind     = b.kind || 'post';
      pollQuestion = b.poll_question || null;
      pollOptions  = b.poll_options  || null;
      pollDays     = parseInt(b.poll_days) || 3;
    }
    if (!title)   return json(res, { error: 'Sarlavha kerak' }, 400);
    if (!comSlug) return json(res, { error: 'Jamoa tanlang' }, 400);
    if (!['post','problem','idea'].includes(kind)) kind = 'post';
    const com = await Q.comBySlug(comSlug);
    if (!com) return json(res, { error: 'Jamoa topilmadi' }, 404);

    const pid = uid();
    await Q.pInsert(pid, u2, com.id, title, body, link, image, video, audio, type, flair, kind);
    await Q.pScore(1,1,0,pid);
    await Q.pvUpsert(u2, pid, 1);
    await Q.uKarma(1, u2);

    // AI klasterlash: faqat 'problem'/'idea' postlari uchun, va faqat AI yoqilgan bo'lsa
    if (['problem','idea'].includes(kind)) {
      try {
        const provider = require('./ai/provider');
        if (provider.enabled) await Q.ajInsert(uid(), 'embed', { post_id: pid });
      } catch (e) { console.error('ai embed job enqueue xatoligi:', e.message); }
    }

    // Poll
    if (pollQuestion && Array.isArray(pollOptions) && pollOptions.length >= 2) {
      const polid = uid();
      const endsAt = Math.floor(Date.now()/1000) + pollDays*86400;
      await Q.pollInsert(polid, pid, pollQuestion.trim(), JSON.stringify(pollOptions.slice(0,10).map(o=>String(o).trim())), pollDays, endsAt);
    }

    const post = await fmtPost(await Q.pOne(pid), u2);
    ws.sendAll({ type: 'new_post', data: post });
    // Notify followers
    await notifyFollowers(u2, post);
    return json(res, post, 201);
  }
  if (p.match(/^\/api\/posts\/[^/]+$/) && m === 'DELETE') {
    const u2 = await getAuth(req); if (!u2) return json(res, { error: 'Unauthorized' }, 401);
    const pid = p.split('/')[3];
    const own = await Q.pOwner(pid); if (!own) return json(res, { error: 'Topilmadi' }, 404);
    const user = await Q.uById(u2);
    if (own.user_id !== u2 && !user?.is_admin) return json(res, { error: "Ruxsat yo'q" }, 403);
    await Q.pDelete(pid);
    ws.sendAll({ type: 'del_post', data: { id: pid } });
    return json(res, { ok: true });
  }
  if (p.match(/^\/api\/posts\/[^/]+\/vote$/) && m === 'POST') {
    const u2 = await getAuthNotBanned(req, res); if (!u2) return true;
    const pid  = p.split('/')[3];
    const own  = await Q.pOwner(pid); if (!own) return json(res, { error: 'Topilmadi' }, 404);
    const b    = await readBody(req);
    const vote = parseInt(b.vote);
    if (![1,-1].includes(vote)) return json(res, { error: 'Vote 1 yoki -1' }, 400);
    const ex = await Q.pvGet(u2, pid);
    let myVote = vote;
    if (ex && ex.vote === vote) { await Q.pvDelete(u2, pid); myVote = 0; }
    else await Q.pvUpsert(u2, pid, vote);
    const c = await Q.pvCount(pid);
    const score = c.up - c.dn;
    await Q.pScore(score, c.up, c.dn, pid);
    if (vote === 1 && own.user_id !== u2) await Q.uKarma(1, own.user_id);
    return json(res, { score, my_vote: myVote, upvotes: c.up, downvotes: c.dn });
  }
  if (p.match(/^\/api\/posts\/[^/]+\/save$/) && m === 'POST') {
    const u2 = await getAuthNotBanned(req, res); if (!u2) return true;
    const pid = p.split('/')[3];
    const saved = !!(await Q.svCheck(u2, pid));
    if (saved) { await Q.svDelete(u2, pid); return json(res, { saved: false }); }
    await Q.svInsert(u2, pid); return json(res, { saved: true });
  }

  /* ══ POLL VOTE ══ */
  if (p.match(/^\/api\/polls\/[^/]+\/vote$/) && m === 'POST') {
    const u2 = await getAuthNotBanned(req, res); if (!u2) return true;
    const pollId = p.split('/')[3];
    const b = await readBody(req);
    const optIdx = parseInt(b.option);
    const poll = await Q.pollGetById(pollId);
    if (!poll) return json(res, { error: "So'rovnoma topilmadi" }, 404);
    if (poll.ends_at < Math.floor(Date.now()/1000)) return json(res, { error: "So'rovnoma tugagan" }, 400);
    const opts = JSON.parse(poll.options);
    if (optIdx < 0 || optIdx >= opts.length) return json(res, { error: "Noto'g'ri variant" }, 400);
    const existing = await Q.pollVoteGet(u2, pollId);
    if (existing) return json(res, { error: "Allaqachon ovoz berdingiz" }, 400);
    await Q.pollVoteIns(u2, pollId, optIdx);
    const counts  = await Q.pollVoteCnt(pollId);
    const total   = (await Q.pollTotalVotes(pollId)).c;
    const countsMap = {};
    counts.forEach(r => { countsMap[r.option_index] = r.cnt; });
    return json(res, {
      options: opts.map((opt,i) => ({ text: opt, votes: countsMap[i]||0, pct: total > 0 ? Math.round((countsMap[i]||0)/total*100) : 0 })),
      total,
      my_vote: optIdx
    });
  }

  /* ══ COMMUNITY POSTS ══ */
  if (p.match(/^\/api\/communities\/[^/]+\/posts$/) && m === 'GET') {
    const u2   = await getAuth(req);
    const slug = p.split('/')[3];
    const sort = q.sort || 'hot';
    const off  = parseInt(q.offset) || 0;
    const com  = await Q.comBySlug(slug);
    if (com && com.is_private) {
      const isMember = u2 ? !!(await Q.memCheck(u2, com.id)) : false;
      if (!isMember && u2 !== com.owner_id) return json(res, { error: "Maxfiy jamoa, a'zo bo'ling" }, 403);
    }
    const rows = sort === 'new' ? await Q.pComNew(slug, off) : await Q.pCom(slug, off);
    const out = [];
    for (const r of rows) out.push(await fmtPost(r, u2));
    return json(res, out);
  }

  /* ══ AI KLASTERLAR (FAZA 3) ══ */
  if (p === '/api/clusters' && m === 'GET') {
    const sort = q.sort || 'hot';
    const limit = Math.min(parseInt(q.limit) || 20, 50);
    const cursor = Math.max(parseInt(q.cursor) || 0, 0);
    const { CLUSTER_MIN_SIZE } = require('./ai/cluster');
    let rows;
    if (sort === 'new') rows = await Q.clListNew(CLUSTER_MIN_SIZE, limit, cursor);
    else if (sort === 'size') rows = await Q.clListSize(CLUSTER_MIN_SIZE, limit, cursor);
    else if (sort === 'unsolved') rows = await Q.clListUnsolved(CLUSTER_MIN_SIZE, limit, cursor);
    else rows = await Q.clListRanked(CLUSTER_MIN_SIZE, limit, cursor);
    const out = [];
    for (const c of rows) {
      const samples = await Q.cmSamplePosts(c.id, 3);
      out.push({
        id: c.id, title: c.title, summary: c.summary, status: c.status, kind: c.kind,
        member_count: c.member_count, unique_users: c.unique_users,
        growth_7d: c.growth_7d || 0, last_activity_at: c.last_activity_at,
        top_community_id: c.top_community_id,
        sample_posts: samples.map(s => ({ id: s.id, title: s.title, username: s.username })),
      });
    }
    return json(res, { clusters: out, next_cursor: cursor + rows.length });
  }
  if (p.match(/^\/api\/clusters\/[^/]+$/) && m === 'GET') {
    const cid = p.split('/')[3];
    const cluster = await Q.clById(cid);
    if (!cluster) return json(res, { error: 'Topilmadi' }, 404);
    const limit = Math.min(parseInt(q.limit) || 20, 50);
    const offset = Math.max(parseInt(q.offset) || 0, 0);
    const members = await Q.cmByCluster(cid, limit, offset);
    const daily = await Q.cdSeries(cid, 30);
    return json(res, {
      ...cluster,
      posts: members.map(m => ({
        post_id: m.post_id, title: m.title, username: m.username, avatar: m.avatar, color: m.color,
        similarity: m.similarity, joined_at: m.joined_at, created_at: m.post_created_at,
      })),
      daily_growth: daily,
    });
  }
  if (p === '/api/ai/similar' && m === 'POST') {
    const u2 = await getAuthNotBanned(req, res); if (!u2) return true;
    const rl = checkRateLimitByUser(u2, 'ai-similar', 20, 60);
    if (!rl.ok) return tooManyRequests(res, rl.retryAfter);
    const provider = require('./ai/provider');
    if (!provider.enabled) return json(res, { clusters: [] });
    const b = await readBody(req);
    const title = (b.title || '').trim();
    const body2 = (b.body || '').trim();
    if (title.length < 10) return json(res, { clusters: [] });
    try {
      const { cosineSim, parseVec } = require('./ai/cluster');
      const text = `${title}\n${body2}`.slice(0, 2000);
      const vectors = await provider.embed([text]);
      if (!vectors || !vectors[0]) return json(res, { clusters: [] });
      const embedding = vectors[0];
      const clusters = await Q.clAllActive();
      const scored = clusters
        .map(c => ({ c, sim: cosineSim(embedding, parseVec(c.centroid)) }))
        .filter(x => x.sim > 0.5)
        .sort((a, b2) => b2.sim - a.sim)
        .slice(0, 3);
      const out = [];
      for (const { c, sim } of scored) {
        const full = await Q.clById(c.id);
        const samples = await Q.cmSamplePosts(c.id, 3);
        out.push({
          id: c.id, title: full.title, member_count: full.member_count,
          similarity: Math.round(sim * 100) / 100,
          sample_posts: samples.map(s => ({ id: s.id, title: s.title })),
        });
      }
      return json(res, { clusters: out });
    } catch (e) {
      console.error('/api/ai/similar xatoligi:', e.message);
      return json(res, { clusters: [] });
    }
  }
  if (p === '/api/stats/problems' && m === 'GET') {
    const topClusters = await Q.clListRanked(1, 10, 0);
    const topReporters = await Q.stTopReporters(10);
    const byCommunity = await Q.stByCommunity();
    const solvedRow = await Q.stSolvedRate();
    const trending = await Q.stTrending(10);
    return json(res, {
      top_clusters: topClusters.map(c => ({ id: c.id, title: c.title, member_count: c.member_count, status: c.status })),
      top_reporters: topReporters,
      by_community: byCommunity,
      solved_rate: solvedRow.total > 0 ? Math.round((solvedRow.solved / solvedRow.total) * 100) : 0,
      trending: trending.map(c => ({ id: c.id, title: c.title, member_count: c.member_count, growth_7d: c.growth_7d })),
    });
  }
  if (p.match(/^\/api\/users\/[^/]+\/problem-profile$/) && m === 'GET') {
    const targetId = p.split('/')[3];
    const clusterIds = await Q.cmForUserClusters(targetId);
    const total = clusterIds.length;
    let solved = 0;
    const clustersOut = [];
    for (const row of clusterIds) {
      const cl = await Q.clById(row.cluster_id);
      if (cl) {
        if (cl.status === 'solved') solved++;
        clustersOut.push({ id: cl.id, title: cl.title, status: cl.status, member_count: cl.member_count });
      }
    }
    return json(res, { user_id: targetId, total_clusters: total, solved_count: solved, clusters: clustersOut });
  }

  /* ══ COMMENTS ══ */
  if (p.match(/^\/api\/posts\/[^/]+\/comments$/) && m === 'POST') {
    const u2 = await getAuthNotBanned(req, res); if (!u2) return true;
    const rl = checkRateLimitByUser(u2, 'comments', 30, 3600);
    if (!rl.ok) return tooManyRequests(res, rl.retryAfter);
    const pid = p.split('/')[3];
    const post = await Q.pOne(pid); if (!post) return json(res, { error: 'Topilmadi' }, 404);
    const b = await readBody(req);
    const body = (b.body || '').trim();
    if (!body) return json(res, { error: 'Izoh bo\'sh bo\'lmasin' }, 400);
    const parentId = b.parent_id || null;
    const depth = parentId ? ((await Q.cmDepth(parentId))?.depth || 0) + 1 : 0;
    const cid = uid();
    await Q.cmInsert(cid, pid, u2, parentId, body, depth);
    await Q.pIncCmt(pid);
    await Q.uKarma(1, u2);
    const comment = await fmtCmt(await Q.cmOne(cid), u2);
    ws.sendAll({ type: 'new_comment', data: { postId: pid, comment } });
    const from = await Q.uById(u2);
    // Notify post owner
    if (post.user_id !== u2) {
      const nid = uid();
      await Q.nInsert(nid, post.user_id, u2, 'comment', pid, cid, `${from.name} postingizga izoh qoldirdi`);
      ws.sendTo(post.user_id, { type: 'notif', data: { id: nid, type: 'comment', post_id: pid, msg: `${from.name} postingizga izoh qoldirdi`, fn: from.name, fa: from.avatar, fc: from.color, is_read: 0, ago: 'Hozir' } });
    }
    // Notify parent comment owner
    if (parentId) {
      const parentOwner = await Q.cmOwner(parentId);
      if (parentOwner && parentOwner.user_id !== u2 && parentOwner.user_id !== post.user_id) {
        const nid = uid();
        await Q.nInsert(nid, parentOwner.user_id, u2, 'reply', pid, cid, `${from.name} izohingizga javob qoldirdi`);
        ws.sendTo(parentOwner.user_id, { type: 'notif', data: { id: nid, type: 'reply', post_id: pid, msg: `${from.name} izohingizga javob qoldirdi`, fn: from.name, fa: from.avatar, fc: from.color, is_read: 0, ago: 'Hozir' } });
      }
    }
    return json(res, comment, 201);
  }
  if (p.match(/^\/api\/comments\/[^/]+\/vote$/) && m === 'POST') {
    const u2 = await getAuthNotBanned(req, res); if (!u2) return true;
    const cid = p.split('/')[3];
    const b   = await readBody(req);
    const vote = parseInt(b.vote);
    if (![1,-1].includes(vote)) return json(res, { error: 'Vote 1 yoki -1' }, 400);
    const own = await Q.cmOwner(cid); if (!own) return json(res, { error: 'Topilmadi' }, 404);
    const ex  = await Q.cvGet(u2, cid);
    let myVote = vote;
    if (ex && ex.vote === vote) { await Q.cvDelete(u2, cid); myVote = 0; }
    else await Q.cvUpsert(u2, cid, vote);
    const c     = await Q.cvCount(cid);
    const score = c.up - c.dn;
    await Q.cmScore(score, cid);
    return json(res, { score, my_vote: myVote });
  }
  if (p.match(/^\/api\/comments\/[^/]+$/) && m === 'DELETE') {
    const u2 = await getAuth(req); if (!u2) return json(res, { error: 'Unauthorized' }, 401);
    const cid = p.split('/')[3];
    const own = await Q.cmOwner(cid); if (!own) return json(res, { error: 'Topilmadi' }, 404);
    const user = await Q.uById(u2);
    if (own.user_id !== u2 && !user?.is_admin) return json(res, { error: "Ruxsat yo'q" }, 403);
    await db.run("DELETE FROM comment_votes WHERE comment_id=$1", [cid]);
    await db.run("DELETE FROM comments WHERE id=$1", [cid]);
    ws.sendAll({ type: 'del_comment', data: { commentId: cid, postId: own.post_id } });
    return json(res, { ok: true });
  }

  /* ══ VOICE MESSAGE UPLOAD ══ */
  if (p === '/api/messages/voice' && m === 'POST') {
    const u2 = await getAuthNotBanned(req, res); if (!u2) return true;
    const { fields, files } = await parseMultipart(req);
    const toId = fields.to_id || fields.to;
    if (!toId) return json(res, { error: "Qabul qiluvchi ko'rsatilmagan" }, 400);
    const vf = files.voice || files.audio;
    if (!vf || !vf.data || vf.data.length === 0) return json(res, { error: 'Audio topilmadi' }, 400);
    const audioUrl = saveFile({ data: vf.data, ext: '.webm' }, ['.webm'], 'audio');
    if (!audioUrl) return json(res, { error: 'Yaroqsiz audio fayli' }, 400);
    const duration = fields.duration || '0:00';
    const mid = uid();
    await Q.msgInsert(mid, u2, toId, '[Ovozli xabar]', 'voice', null, audioUrl, duration);
    const from = await Q.uById(u2);
    const msg = { id: mid, from_id: u2, to_id: toId, body: '[Ovozli xabar]',
      type: 'voice', audio_url: audioUrl, duration, is_read: 0, ago: 'Hozir',
      created_at: Math.floor(Date.now()/1000) };
    ws.sendTo(toId, { type: 'new_msg', data: { msg, from: { id: from.id, name: from.name, username: from.username, color: from.color, avatar: from.avatar } } });
    ws.sendTo(u2,   { type: 'msg_sent', data: { msg } });
    return json(res, msg, 201);
  }

  /* ══ IMAGE MESSAGE UPLOAD ══ */
  if (p === '/api/messages/image' && m === 'POST') {
    const u2 = await getAuthNotBanned(req, res); if (!u2) return true;
    const { fields, files } = await parseMultipart(req);
    const toId = fields.to_id || fields.to;
    if (!toId) return json(res, { error: "Qabul qiluvchi ko'rsatilmagan" }, 400);
    const imgFile = files.image;
    if (!imgFile || !imgFile.data || imgFile.data.length === 0) return json(res, { error: 'Rasm topilmadi' }, 400);
    const imgUrl = saveFile(imgFile, ['.jpg','.jpeg','.png','.gif','.webp']);
    if (!imgUrl) return json(res, { error: 'Yaroqsiz rasm formati' }, 400);
    const mid = uid();
    await Q.msgInsert(mid, u2, toId, '[Rasm]', 'image', imgUrl, null, null);
    const from = await Q.uById(u2);
    const msg = { id: mid, from_id: u2, to_id: toId, body: '[Rasm]',
      type: 'image', image_url: imgUrl, is_read: 0, ago: 'Hozir',
      created_at: Math.floor(Date.now()/1000) };
    ws.sendTo(toId, { type: 'new_msg', data: { msg, from: { id: from.id, name: from.name, username: from.username, color: from.color, avatar: from.avatar } } });
    ws.sendTo(u2,   { type: 'msg_sent', data: { msg } });
    return json(res, msg, 201);
  }

  /* ══ WEBRTC SIGNALING (REST fallback) ══ */
  if (p === '/api/call/offer' && m === 'POST') {
    const u2 = await getAuth(req); if (!u2) return json(res, { error: 'Unauthorized' }, 401);
    const b = await readBody(req);
    const from = await Q.uById(u2);
    ws.sendTo(b.to_id, { type: 'call_offer', data: {
      call_type: b.call_type || 'audio', offer: b.offer,
      from_id: u2, from_name: from.name, from_username: from.username,
      from_avatar: from.avatar, from_color: from.color
    }});
    return json(res, { ok: true });
  }
  if (p === '/api/call/answer' && m === 'POST') {
    const u2 = await getAuth(req); if (!u2) return json(res, { error: 'Unauthorized' }, 401);
    const b = await readBody(req);
    ws.sendTo(b.to_id, { type: 'call_answer', data: { answer: b.answer, from_id: u2 } });
    return json(res, { ok: true });
  }
  if (p === '/api/call/ice' && m === 'POST') {
    const u2 = await getAuth(req); if (!u2) return json(res, { error: 'Unauthorized' }, 401);
    const b = await readBody(req);
    ws.sendTo(b.to_id, { type: 'ice_candidate', data: { candidate: b.candidate, from_id: u2 } });
    return json(res, { ok: true });
  }
  if (p === '/api/call/end' && m === 'POST') {
    const u2 = await getAuth(req); if (!u2) return json(res, { error: 'Unauthorized' }, 401);
    const b = await readBody(req);
    ws.sendTo(b.to_id, { type: 'call_ended', data: { from_id: u2 } });
    return json(res, { ok: true });
  }
  if (p === '/api/call/reject' && m === 'POST') {
    const u2 = await getAuth(req); if (!u2) return json(res, { error: 'Unauthorized' }, 401);
    const b = await readBody(req);
    ws.sendTo(b.to_id, { type: 'call_rejected', data: { from_id: u2 } });
    return json(res, { ok: true });
  }

  /* ══ MESSAGES ══ */
  if (p === '/api/messages' && m === 'GET') {
    const u2 = await getAuth(req); if (!u2) return json(res, { error: 'Unauthorized' }, 401);
    const rows = await Q.msgConvos(u2);
    const convos = [];
    for (const { oid } of rows) {
      const other = await Q.uById(oid);
      if (!other) continue;
      const last  = await Q.msgLast(u2, oid, oid, u2);
      const unread = (await Q.msgUnread(u2)).c;
      convos.push({ other: { ...other }, last: last ? { ...last, ago: ago(last.created_at) } : null, unread });
    }
    return json(res, convos);
  }
  if (p.match(/^\/api\/messages\/[^/]+$/) && m === 'GET') {
    const u2 = await getAuth(req); if (!u2) return json(res, { error: 'Unauthorized' }, 401);
    const toId = p.split('/')[3];
    await Q.msgMarkRead(toId, u2);
    const msgs = await Q.msgThread(u2, toId, toId, u2);
    return json(res, msgs.map(m => ({ ...m, ago: ago(m.created_at) })));
  }
  if (p === '/api/messages' && m === 'POST') {
    const u2 = await getAuthNotBanned(req, res); if (!u2) return true;
    const rl = checkRateLimitByUser(u2, 'messages', 60, 3600);
    if (!rl.ok) return tooManyRequests(res, rl.retryAfter);
    const b  = await readBody(req);
    const toId = b.to_id || b.to;
    if (!toId || !b.body?.trim()) return json(res, { error: "Xabar bo'sh" }, 400);
    const mid  = uid();
    const body = b.body.trim();
    await Q.msgInsert(mid, u2, toId, body, 'text', null, null, null);
    const from = await Q.uById(u2);
    const msg  = { id: mid, from_id: u2, to_id: toId, body, type:'text', is_read: 0, ago: 'Hozir', created_at: Math.floor(Date.now()/1000) };
    ws.sendTo(toId, { type: 'new_msg', data: { msg, from: { id: from.id, name: from.name, username: from.username, color: from.color, avatar: from.avatar } } });
    ws.sendTo(u2,   { type: 'msg_sent', data: { msg } });
    return json(res, msg, 201);
  }

  /* ══ NOTIFICATIONS ══ */
  if (p === '/api/notifications' && m === 'GET') {
    const u2 = await getAuth(req); if (!u2) return json(res, { error: 'Unauthorized' }, 401);
    return json(res, (await Q.nAll(u2)).map(fmtNotif));
  }
  if (p === '/api/notifications/read' && m === 'POST') {
    const u2 = await getAuth(req); if (!u2) return json(res, { error: 'Unauthorized' }, 401);
    await Q.nMarkRead(u2);
    return json(res, { ok: true });
  }
  if (p === '/api/notifications/count' && m === 'GET') {
    const u2 = await getAuth(req); if (!u2) return json(res, { error: 'Unauthorized' }, 401);
    return json(res, { count: (await Q.nUnread(u2)).c });
  }

  /* ══ SEARCH ══ */
  if (p === '/api/search' && m === 'GET') {
    const sq = (q.q || '').toLowerCase();
    if (!sq || sq.length < 2) return json(res, { posts: [], users: [], communities: [] });
    const u2 = await getAuth(req);
    const type = q.type || 'all';
    let posts = [], users = [], coms = [];
    if (type==='all'||type==='posts') {
      const rows = await Q.pSearch('%'+sq+'%','%'+sq+'%');
      for (const r of rows) posts.push(await fmtPost(r,u2));
    }
    if (type==='all'||type==='users') users = await Q.uSearch('%'+sq+'%','%'+sq+'%');
    if (type==='all'||type==='communities') coms = await Q.comSearch('%'+sq+'%','%'+sq+'%');
    return json(res, { posts, users, communities: coms });
  }

  /* ══ REPORTS ══ */
  if (p === '/api/reports' && m === 'POST') {
    const u2 = await getAuthNotBanned(req, res); if (!u2) return true;
    const b  = await readBody(req);
    if (!b.reason?.trim()) return json(res, { error: 'Sabab kerak' }, 400);
    await Q.rpInsert(uid(), u2, b.post_id||null, b.comment_id||null, b.reason.trim());
    return json(res, { ok: true });
  }

  /* ══ ADMIN ══ */
  if (p === '/api/admin/stats' && m === 'GET') {
    const u2 = await getAuth(req); if (!u2) return json(res, { error: 'Unauthorized' }, 401);
    const user = await Q.uById(u2); if (!user?.is_admin) return json(res, { error: "Ruxsat yo'q" }, 403);
    const stats = await Q.adminStats();
    const reports = (await Q.rpAll()).map(r => ({ ...r, ago: ago(r.created_at) }));
    const users = await Q.uAll();
    return json(res, { ...stats, user_count: stats.users, reports, users });
  }
  if (p === '/api/admin/action' && m === 'POST') {
    const u2 = await getAuth(req); if (!u2) return json(res, { error: 'Unauthorized' }, 401);
    const user = await Q.uById(u2); if (!user?.is_admin) return json(res, { error: "Ruxsat yo'q" }, 403);
    const b    = await readBody(req);
    if (b.action === 'ban') {
      const dur = parseInt(b.duration) || 0;
      const expiresAt = dur > 0 ? Math.floor(Date.now()/1000) + dur * 86400 : null;
      await Q.uBan(b.reason||'', b.target_id, expiresAt);
    }
    if (b.action === 'unban')    await Q.uUnban(b.target_id);
    if (b.action === 'makeAdmin')await Q.uMakeAdmin(b.target_id);
    if (b.action === 'remAdmin') await Q.uRemAdmin(b.target_id);
    return json(res, { ok: true });
  }
  if (p.match(/^\/api\/admin\/reports\/[^/]+$/) && m === 'POST') {
    const u2 = await getAuth(req); if (!u2) return json(res, { error: 'Unauthorized' }, 401);
    const user = await Q.uById(u2); if (!user?.is_admin) return json(res, { error: "Ruxsat yo'q" }, 403);
    const rid  = p.split('/')[4];
    const b    = await readBody(req);
    await Q.rpResolve(b.status || 'resolved', rid);
    return json(res, { ok: true });
  }

  /* ══ TELEGRAM PASSWORD RESET ══ */
  if (p === '/api/auth/tg-send-code' && m === 'POST') {
    const b = await readBody(req);
    const email = (b.email || '').trim().toLowerCase();
    if (!email) return json(res, { error: 'Email kerak' }, 400);
    const user = await db.get('SELECT id, username, name, email, tg_chat_id FROM users WHERE lower(email)=lower($1)', [email]);
    if (!user) return json(res, { error: 'Bu emailga bog\'langan akkaunt topilmadi' }, 404);
    await Q.tgCodeClean();
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const codeId = uid();
    const expiresAt = Math.floor(Date.now()/1000) + 600;
    await Q.tgCodeInsert(codeId, user.id, email, code, expiresAt);
    if (user.tg_chat_id) {
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      const telegramMsg = `🔐 MindHub parol tiklash kodi: ${code}\n\nBu kod 10 daqiqa davomida amal qiladi.\nAgar siz bu so'rovni yubormagan bo'lsangiz, xabarni e'tiborsiz qoldiring.`;
      try {
        const https = require('https');
        const sendUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
        const postData = JSON.stringify({ chat_id: user.tg_chat_id, text: telegramMsg });
        const sendReq = https.request(sendUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' } }, (resp) => {
          let data = '';
          resp.on('data', chunk => data += chunk);
          resp.on('end', () => { try { console.log('TG send:', JSON.parse(data)); } catch {} });
        });
        sendReq.on('error', (e) => console.log('TG send error:', e.message));
        sendReq.write(postData);
        sendReq.end();
      } catch(e) { console.log('TG bot error:', e.message); }
    } else {
      console.log('No tg_chat_id for user:', user.username, '- code:', code);
    }
    return json(res, { ok: true, message: 'Kod yuborildi. Telegramdan tekshiring.' });
  }
  if (p === '/api/auth/tg-verify-code' && m === 'POST') {
    const b = await readBody(req);
    const email = (b.email || '').trim().toLowerCase();
    const code = (b.code || '').trim();
    const newPass = (b.new_pass || '').trim();
    if (!email || !code) return json(res, { error: 'Email va kod kerak' }, 400);
    const user = await db.get('SELECT id FROM users WHERE lower(email)=lower($1)', [email]);
    if (!user) return json(res, { error: 'Foydalanuvchi topilmadi' }, 404);
    const codeRow = await Q.tgCodeGet(user.id, code);
    if (!codeRow) return json(res, { error: "Noto'g'ri kod yoki muddati tugagan" }, 400);
    if (newPass) {
      if (newPass.length < 6) return json(res, { error: 'Parol kamida 6 belgi' }, 400);
      await Q.uUpdPass(hashPassword(newPass), user.id);
      await Q.tgCodeUse(codeRow.id);
      return json(res, { ok: true, message: 'Parol yangilandi!' });
    }
    return json(res, { ok: true, verified: true });
  }

  return null;
}

module.exports = { route };
