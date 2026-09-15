'use strict';
// Cloudflare Workers'da binding'lar (D1, R2, Durable Object namespace, env
// o'zgaruvchilar) faqat fetch(request, env, ctx) handler ichida beriladi —
// Node'dagi kabi module yuklanganda darhol mavjud bo'lgan global holat yo'q.
// Lekin bitta Worker joylashuvi (deployment) uchun binding'lar so'rovdan
// so'rovga o'zgarmaydi (wrangler.toml'da statik belgilangan), shuning uchun
// bu yerda BIR MARTA (har isolyat uchun) saqlab qo'yilib, keyin Q obyekti
// (src/db.js), ws.js va storage.js undan xotirjam foydalanadi — routes.js'ning
// 1600+ qatorini "env"ni har joyga uzatib chiqish shart bo'lmaydi.
let _env = null;
let _ctx = null;

function setEnv(env, ctx) { _env = env; if (ctx) _ctx = ctx; }
function getEnv() {
  if (!_env) throw new Error('env hali o\'rnatilmagan — worker/index.js fetch handleri setEnv(env) chaqirishi kerak');
  return _env;
}
// ctx.waitUntil(promise) — javob (Response) mijozga qaytarilgandan keyin ham
// shu promise tugaguncha Worker instansi "tirik" turishini kafolatlaydi.
// ws.js'dagi fire-and-forget bildirishnoma yuborishlari (ws.sendTo/sendAll,
// routes.js'da `await`siz chaqiriladi) buni ishlatadi — aks holda javob
// yuborilgandan keyin DO'ga so'rov o'rtada to'xtab qolishi mumkin edi.
function getCtx() { return _ctx; }
function waitUntil(promise) {
  if (_ctx && typeof _ctx.waitUntil === 'function') _ctx.waitUntil(promise);
  return promise;
}

module.exports = { setEnv, getEnv, getCtx, waitUntil };
