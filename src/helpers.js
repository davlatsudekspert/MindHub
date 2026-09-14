'use strict';
const crypto = require('crypto');
const { SECRET } = require('./db');

function uid() { return crypto.randomUUID(); }
function now() { return Math.floor(Date.now() / 1000); }
function hashPass(p) { return crypto.createHmac('sha256', SECRET).update(p).digest('hex'); }

/* ── Cursor-asosli pagination uchun ── */
// Ochiq (opaque) token sifatida ishlatiladi — mijoz ichini bilishi shart emas,
// keyingi so'rovda o'zgarishsiz qaytarib beradi. base64url — URL query
// parametrida xavfsiz ishlatish uchun.
function encodeCursor(obj) {
  if (!obj) return null;
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}
function decodeCursor(str) {
  if (!str) return null;
  try {
    return JSON.parse(Buffer.from(str, 'base64url').toString());
  } catch {
    return null;
  }
}

/* ── Parol hashlash (scrypt) ──
   Format: scrypt$N$r$p$salt(hex)$hash(hex)
   Eski hmac formatidagi parollar bilan orqaga moslik saqlanadi:
   agar saqlangan qiymat "scrypt$" bilan boshlanmasa, eski hmac() usulida tekshiriladi. */
const SCRYPT_N = 16384, SCRYPT_R = 8, SCRYPT_P = 1, SCRYPT_KEYLEN = 64;

function hashPassword(plain) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(plain, salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function isScryptHash(stored) {
  return typeof stored === 'string' && stored.startsWith('scrypt$');
}

function verifyPassword(plain, stored) {
  if (!stored) return false;
  if (!isScryptHash(stored)) {
    // Eski format — hmac-sha256(SECRET, parol)
    return stored === hashPass(plain);
  }
  const parts = stored.split('$');
  if (parts.length !== 6) return false;
  const [, Ns, rs, ps, saltHex, hashHex] = parts;
  try {
    const N = Number(Ns), r = Number(rs), p = Number(ps);
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(hashHex, 'hex');
    const actual = crypto.scryptSync(plain, salt, expected.length, { N, r, p });
    if (actual.length !== expected.length) return false;
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// pv (pass_version) tokenga qo'shiladi — parol o'zgarganda bazadagi pass_version
// oshadi va eski tokenlar (boshqa pv bilan) haqiqiy tekshiruvda (routes.js#getAuth,
// bazaga murojaat qilib) rad etiladi. Bu yerdagi verifyToken faqat imzoni va muddatni
// tekshiradi (bazasiz, tez) — {userId, pv} qaytaradi.
function makeToken(userId, pv = 1) {
  const pl = Buffer.from(JSON.stringify({ userId, pv, exp: Date.now() + 14 * 864e5 })).toString('base64url');
  const sg = crypto.createHmac('sha256', SECRET).update(pl).digest('base64url');
  return `${pl}.${sg}`;
}

function verifyToken(tok) {
  if (!tok) return null;
  try {
    const [pl, sg] = tok.split('.');
    if (!pl || !sg) return null;
    if (crypto.createHmac('sha256', SECRET).update(pl).digest('base64url') !== sg) return null;
    const d = JSON.parse(Buffer.from(pl, 'base64url').toString());
    if (Date.now() > d.exp) return null;
    return { userId: d.userId, pv: d.pv || 1 };
  } catch {
    return null;
  }
}

function getAuth(req) {
  const h = req.headers['authorization'] || '';
  const decoded = verifyToken(h.startsWith('Bearer ') ? h.slice(7).trim() : '');
  return decoded ? decoded.userId : null;
}

function timeAgo(ts) {
  const d = now() - ts;
  if (d < 60) return `${d}s`;
  if (d < 3600) return `${Math.floor(d / 60)}m`;
  if (d < 86400) return `${Math.floor(d / 3600)}h`;
  if (d < 604800) return `${Math.floor(d / 86400)}d`;
  if (d < 2592000) return `${Math.floor(d / 604800)}w`;
  return `${Math.floor(d / 2592000)}mo`;
}

function readBody(req) {
  return new Promise((res, rej) => {
    let b = '';
    req.on('data', c => { b += c; if (b.length > 4e6) req.destroy(); });
    req.on('end', () => { 
      try { 
        res(JSON.parse(b)); 
      } catch { 
        res({}); 
      } 
    });
    req.on('error', rej);
  });
}

function parseMultipart(req) {
  return new Promise(resolve => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const buf = Buffer.concat(chunks);
      const ct = req.headers['content-type'] || '';
      const bm = ct.match(/boundary=([^\s;]+)/);
      if (!bm) return resolve({ fields: {}, file: null });
      
      const boundary = '--' + bm[1].trim();
      const fields = {}; 
      let file = null;
      const parts = buf.toString('binary').split(boundary);
      
      for (const part of parts) {
        if (!part.trim() || part.trim() === '--') continue;
        const sep = part.indexOf('\r\n\r\n');
        if (sep < 0) continue;
        
        const hdrs = part.slice(0, sep);
        const content = part.slice(sep + 4).replace(/\r\n$/, '');
        const nm = hdrs.match(/name="([^"]+)"/);
        const fn = hdrs.match(/filename="([^"]+)"/);
        
        if (!nm) continue;
        
        if (fn) {
          const ext = require('path').extname(fn[1]).toLowerCase();
          if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
            file = { ext, data: Buffer.from(content, 'binary') };
          }
        } else {
          fields[nm[1]] = content.trim();
        }
      }
      resolve({ fields, file });
    });
  });
}

function json(res, data, status = 200) {
  // MUHIM: Agar data undefined bo'lsa, {} ga aylantirish
  if (data === undefined || data === null) {
    data = {};
  }
  
  // Eslatma: bu yordamchi funksiya CORS headerlarini o'rnatmaydi — chaqiruvchi
  // route(req,res) darajasida src/cors.js#corsHeaders(req) orqali qo'yilishi kerak
  // (bu yerda req yo'q, shuning uchun ruxsat etilgan originni bilib bo'lmaydi).
  const body = JSON.stringify(data);
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body, 'utf-8')
  };
  
  res.writeHead(status, headers);
  res.end(body);
}

const COLORS = ['#C8922A', '#4D8FFF', '#46C97A', '#9B6FD4', '#3AADCC', '#E8703A', '#FF5252', '#00BCD4'];

function randColor() { 
  return COLORS[Math.floor(Math.random() * COLORS.length)]; 
}

module.exports = {
  uid,
  now,
  hashPass,
  hashPassword,
  verifyPassword,
  isScryptHash,
  makeToken,
  verifyToken,
  getAuth,
  timeAgo,
  readBody,
  parseMultipart,
  json,
  randColor,
  encodeCursor,
  decodeCursor
};