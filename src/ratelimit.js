'use strict';
// Oddiy in-memory sliding-window rate limiter. Bitta server instance uchun
// yetarli (Railway'da ko'pincha bitta instance ishlaydi). Ko'p instance bo'lsa,
// buni Redis asosidagi yechimga almashtirish kerak bo'ladi.

const buckets = new Map(); // key -> [timestamps...]

function check(key, limit, windowSec) {
  const now = Date.now();
  const windowMs = windowSec * 1000;
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

// Har 5 daqiqada eskirgan bucketlarni tozalash — Map cheksiz o'smasligi uchun
setInterval(() => {
  const now = Date.now();
  for (const [key, arr] of buckets) {
    while (arr.length && now - arr[0] > 3600 * 1000) arr.shift();
    if (arr.length === 0) buckets.delete(key);
  }
}, 5 * 60 * 1000).unref();

module.exports = { check, getClientIp, checkRateLimit, checkRateLimitByUser };
