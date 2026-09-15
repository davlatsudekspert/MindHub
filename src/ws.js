'use strict';
// routes.js (va src/ai/distribute.js) uchun MOSLIK QATLAMI — eski (xom TCP
// socket asosidagi) ws.js bilan bir xil interfeys (sendTo/sendAll/isOnline)
// saqlanadi, lekin haqiqiy ish endi src/ws-do.js dagi Durable Object'da
// bajariladi. Bu yerdagi funksiyalar shunchaki DO'ga HTTP so'rov yuboradi —
// Workers'da Durable Object'lar bilan aloqa qilishning yagona yo'li shu
// (to'g'ridan-to'g'ri funksiya chaqirish emas, chunki DO alohida "joy"da
// ishlaydi, hatto bitta so'rov ichida ham).
const { getEnv, waitUntil } = require('./env');

function hub() {
  const env = getEnv();
  const id = env.WSHUB.idFromName('hub');
  return env.WSHUB.get(id);
}

// MUHIM: routes.js bu ikkalasini deyarli har doim `await`siz chaqiradi
// (fire-and-forget — bildirishnoma yuborish HTTP javobini kechiktirmasligi
// kerak). Workers'da javob qaytarilgandan keyin Worker instansi darhol
// to'xtatilishi mumkin, shuning uchun waitUntil() bilan bu so'rov javobdan
// keyin ham tugaguncha kutiladi (env.js#waitUntil).
function sendTo(userId, payload) {
  if (!userId) return;
  const p = hub().fetch('https://do/send', {
    method: 'POST',
    body: JSON.stringify({ userId, payload }),
  }).catch(e => console.error('ws.sendTo xatoligi:', e.message));
  return waitUntil(p);
}

function sendAll(payload) {
  const p = hub().fetch('https://do/send', {
    method: 'POST',
    body: JSON.stringify({ broadcast: true, payload }),
  }).catch(e => console.error('ws.sendAll xatoligi:', e.message));
  return waitUntil(p);
}

async function isOnline(userId) {
  try {
    const r = await hub().fetch(`https://do/online?userId=${encodeURIComponent(userId)}`);
    const d = await r.json();
    return !!d.online;
  } catch {
    return false;
  }
}

module.exports = { sendTo, sendAll, isOnline };
