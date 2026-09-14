'use strict';
// Testlar uchun umumiy yordamchilar. Haqiqiy PostgreSQL kerak — DATABASE_URL
// env orqali beriladi (CI'da GitHub Actions service container; lokal test uchun
// `docker run -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:16` yetarli).
//
// HTTP so'rovlarini haqiqiy server/port ochmasdan, to'g'ridan-to'g'ri
// src/routes.js#route(req,res) ni chaqirib simulyatsiya qilamiz — soxta req/res
// orqali. Bu tezroq va portlar bilan bog'liq muammolarsiz.
//
// MUHIM: ba'zi routelar (masalan /api/me/password) readBody(req) dan OLDIN
// await getAuth(req) kabi boshqa async ishni bajaradi — ya'ni req.on('data'/'end')
// qachon chaqirilishi navbatga bog'liq, oldindan aytib bo'lmaydi. Shuning uchun
// tashqaridan "vaqtida" emit qilish o'rniga, req.on() ning o'zi chaqirilgan zahoti
// (qachon chaqirilishidan qat'iy nazar) ma'lumotni "yetkazadi" — bu real vaqt
// tartibidan butunlay mustaqil va ishonchli.

if (!process.env.SECRET) process.env.SECRET = require('crypto').randomBytes(32).toString('hex');
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgres://postgres:postgres@localhost:5432/mindhub_test';
}

const crypto = require('crypto');
const { init, db } = require('../src/db');
const { migrate } = require('../src/migrate');
const { route } = require('../src/routes');

let initialized = false;
async function setup() {
  if (initialized) return;
  await init();
  await migrate();
  initialized = true;
}

// method, path, body (obyekt yoki null), qo'shimcha headerlar (masalan Authorization)
function call(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const bodyBuf = (body !== undefined && body !== null) ? Buffer.from(JSON.stringify(body)) : null;

    const req = {};
    req.method = method;
    req.url = path;
    req.headers = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    if (bodyBuf && !req.headers['content-type']) req.headers['content-type'] = 'application/json';
    req.socket = { remoteAddress: '127.0.0.1' };
    req.destroy = () => {};
    // on() chaqirilgan zahoti (qachon chaqirilishidan qat'iy nazar) ma'lumotni
    // "yetkazadi" — shu bilan readBody()/parseMultipart() qaysi await'dan keyin
    // chaqirilishidan mustaqil ravishda to'g'ri ishlaydi.
    req.on = (event, cb) => {
      if (event === 'data') { if (bodyBuf) queueMicrotask(() => cb(bodyBuf)); }
      else if (event === 'end') { queueMicrotask(() => cb()); }
      return req;
    };

    const res = {
      headersSent: false,
      statusCode: 200,
      _headers: {},
      setHeader(name, value) { this._headers[name] = value; },
      writeHead(code, headers2) {
        this.statusCode = code;
        this.headersSent = true;
        if (headers2) Object.assign(this._headers, headers2);
      },
      end(data) {
        let parsed = null;
        try { parsed = data ? JSON.parse(data) : null; } catch { parsed = data; }
        resolve({ status: this.statusCode, body: parsed, headers: this._headers });
      },
    };

    route(req, res).catch(reject);
  });
}

function uniqueSuffix() {
  return crypto.randomBytes(4).toString('hex');
}

function fakeIp() {
  // Har bir test foydalanuvchisi "boshqa IP"dan kelayotgandek ko'rinadi —
  // aks holda barcha testlar bitta soxta manzildan (127.0.0.1) kelib,
  // IP-asosli rate limitlarga (masalan register: 5/soat/IP) tez urilib qolardi.
  return `10.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}`;
}

async function registerTestUser(overrides = {}) {
  const suffix = uniqueSuffix();
  const username = overrides.username || ('t' + suffix);
  const email = overrides.email || `${username}@example.com`;
  const password = overrides.password || 'secret123';

  const reg = await call('POST', '/api/auth/register', { username, name: username, email, password }, { 'x-forwarded-for': fakeIp() });
  return { reg, username, email, password };
}

// email_codes'dagi eng oxirgi kodni bazadan o'qib, sha256 hash'ini qidiruv
// orqali (000000-999999) tiklaydi — kod ochiq saqlanmagani uchun.
async function getLatestCode(userId, purpose = 'register') {
  const row = await db.get(
    'SELECT code_hash FROM email_codes WHERE user_id=$1 AND purpose=$2 ORDER BY created_at DESC LIMIT 1',
    [userId, purpose]
  );
  if (!row) return null;
  for (let i = 0; i < 1000000; i++) {
    const code = String(i).padStart(6, '0');
    if (crypto.createHash('sha256').update(code).digest('hex') === row.code_hash) return code;
  }
  return null;
}

// To'liq oqim: ro'yxatdan o'tish + tasdiqlash -> { token, user }
async function registerAndVerify(overrides = {}) {
  const { reg, username, email, password } = await registerTestUser(overrides);
  if (!reg.body.pending) throw new Error('register kutilmagan javob: ' + JSON.stringify(reg.body));
  const code = await getLatestCode(reg.body.user_id, 'register');
  const verify = await call('POST', '/api/auth/verify-email', { user_id: reg.body.user_id, code });
  if (!verify.body.token) throw new Error('verify kutilmagan javob: ' + JSON.stringify(verify.body));
  return { ...verify.body, username, email, password };
}

module.exports = { setup, call, db, uniqueSuffix, registerTestUser, getLatestCode, registerAndVerify };
