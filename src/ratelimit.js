'use strict';
// Oddiy in-memory sliding-window rate limiter.
//
// ⚠️ Cloudflare Workers'da eslatma: bu Map faqat BITTA isolyat ichida
// saqlanadi — Workers so'rovlarni ko'p turli isolyat/edge joylashuvlariga
// tarqatadi, shuning uchun bu chegara "eng yaxshi urinish" (best-effort)
// darajasida, global emas (bitta foydalanuvchi turli isolyatlarga tushib,
// haqiqiy limitdan ko'proq urinish qila olishi mumkin). To'liq to'g'ri
// global chegaralash uchun Durable Object yoki D1/KV asosidagi hisoblagich
// kerak bo'lardi — bu hozircha qilinmagan (texnik qarz sifatida qoldirilgan,
// chunki mavjud xavfsizlik nazoratlari — parol/ovoz cheklovlari — baribir
// bazada tekshiriladi, bu yerdagi limiter faqat qo'shimcha himoya qatlami).
const buckets = new Map(); // key -> [timestamps...]

// setInterval bilan davriy tozalash Workers'da global scope'da TAQIQLANGAN
// ("Disallowed operation called within global scope") — shuning uchun
// buning o'rniga har chaqiruvda vaqti-vaqti bilan (ehtimollik asosida)
// tozalanadi, alohida timer kerak emas.
let lastCleanup = 0;
function opportunisticCleanup() {
  const now = Date.now();
  if (now - lastCleanup < 5 * 60 * 1000) return;
  lastCleanup = now;
  for (const [key, arr] of buckets) {
    while (arr.length && now - arr[0] > 3600 * 1000) arr.shift();
    if (arr.length === 0) buckets.delete(key);
  }
}

function check(key, limit, windowSec) {
  const now = Date.now();
  const windowMs = windowSec * 1000;
  opportunisticCleanup();
  let arr = buckets.get(key);
  if (!arr) { arr = []; buckets.set(key, arr); }
  // eskirgan urinishlarni olib tashlash
  while (arr.length && now - arr[0] > windowMs) arr.shift();
  if (arr.length >= limit) {
    const retryAfter = Math.ceil((windowMs - (now - arr[0])) / 1000);
    return { ok: false, retryAfter: Math.max(1, retryAfter) };
  }
  arr.push(now);
  return { ok: true, retryAfter: 0 };
}

function getClientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (xf) {
    const first = xf.split(',')[0].trim();
    if (first) return first;
  }
  return req.socket.remoteAddress || 'unknown';
}

// Har bir marshrut uchun: checkRateLimit(req, 'login', 10, 900) -> { ok, retryAfter }
// key IP asosida quriladi; foydalanuvchi asosida cheklash kerak bo'lsa
// checkRateLimitByUser(userId, ...) ishlating.
function checkRateLimit(req, bucket, limit, windowSec) {
  const ip = getClientIp(req);
  return check(`${bucket}:ip:${ip}`, limit, windowSec);
}

function checkRateLimitByUser(userId, bucket, limit, windowSec) {
  return check(`${bucket}:user:${userId}`, limit, windowSec);
}

module.exports = { check, getClientIp, checkRateLimit, checkRateLimitByUser };
