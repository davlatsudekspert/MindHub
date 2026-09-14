'use strict';
// Resend REST API orqali email yuborish (SDK kerak emas — oddiy fetch).
// RESEND_API_KEY yo'q bo'lsa (masalan lokal ishlab chiqishda), xatolik
// tashlamaydi — kodni konsolga chiqaradi va { dev: true } qaytaradi.

const GOLD = '#C8922A';

function wrapEmail(innerHtml) {
  return `
    <div style="font-family:Arial,sans-serif;max-width:420px;margin:0 auto;padding:32px;background:#f8f9fa;border-radius:16px">
      <div style="text-align:center;margin-bottom:24px">
        <div style="font-size:32px;font-weight:800;color:${GOLD}">MindHub</div>
      </div>
      <div style="background:#fff;border-radius:12px;padding:24px;text-align:center;box-shadow:0 2px 12px rgba(0,0,0,.06)">
        ${innerHtml}
      </div>
      <div style="text-align:center;font-size:11px;color:#aaa;margin-top:20px">
        Agar bu so'rovni siz yubormagan bo'lsangiz, xabarni e'tiborsiz qoldiring.
      </div>
    </div>
  `;
}

async function sendViaResend({ to, subject, html }) {
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const MAIL_FROM = process.env.MAIL_FROM || 'MindHub <onboarding@resend.dev>';

  if (!RESEND_API_KEY) {
    console.log(`\n=== [DEV] EMAIL (Resend API kaliti yo'q) ===`);
    console.log('Kimga:', to);
    console.log('Mavzu:', subject);
    console.log('HTML (qisqartirilgan):', html.replace(/\s+/g, ' ').slice(0, 300), '...');
    console.log('===\n');
    return { dev: true };
  }

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: MAIL_FROM, to: [to], subject, html }),
  });

  if (!r.ok) {
    const body = await r.text().catch(() => '');
    console.error(`Resend xatosi (${r.status}):`, body);
    throw new Error("Email yuborishda xatolik yuz berdi");
  }
  return { dev: false };
}

async function sendVerifyCode(email, code, username) {
  const html = wrapEmail(`
    <div style="font-size:14px;color:#666;margin-bottom:16px">Salom, <strong>${username}</strong>!</div>
    <div style="font-size:14px;color:#666;margin-bottom:12px">Ro'yxatdan o'tishni yakunlash uchun tasdiqlash kodi:</div>
    <div style="font-size:36px;font-weight:800;color:${GOLD};letter-spacing:8px;padding:16px;background:#fdf6e8;border-radius:8px;margin:16px 0">${code}</div>
    <div style="font-size:12px;color:#999;margin-top:16px">Bu kod 15 daqiqa ichida amal qiladi.</div>
  `);
  return sendViaResend({ to: email, subject: 'MindHub — Emailni tasdiqlash kodi', html });
}

async function sendPasswordReset(email, code, username) {
  const html = wrapEmail(`
    <div style="font-size:14px;color:#666;margin-bottom:16px">Salom, <strong>${username}</strong>!</div>
    <div style="font-size:14px;color:#666;margin-bottom:12px">Parolni tiklash uchun tasdiqlash kodi:</div>
    <div style="font-size:36px;font-weight:800;color:${GOLD};letter-spacing:8px;padding:16px;background:#fdf6e8;border-radius:8px;margin:16px 0">${code}</div>
    <div style="font-size:12px;color:#999;margin-top:16px">Bu kod 15 daqiqa ichida amal qiladi.</div>
  `);
  return sendViaResend({ to: email, subject: 'MindHub — Parol tiklash kodi', html });
}

async function sendPasswordResetLink(email, link, username) {
  const html = wrapEmail(`
    <div style="font-size:14px;color:#666;margin-bottom:16px">Salom, <strong>${username}</strong>!</div>
    <div style="font-size:14px;color:#666;margin-bottom:20px">Parolni tiklash uchun quyidagi havolani bosing:</div>
    <a href="${link}" style="display:inline-block;background:${GOLD};color:#fff;text-decoration:none;font-weight:700;padding:12px 28px;border-radius:8px">Parolni tiklash</a>
    <div style="font-size:12px;color:#999;margin-top:16px">Havola 1 soat ichida amal qiladi.</div>
  `);
  return sendViaResend({ to: email, subject: 'MindHub — Parolni tiklash', html });
}

async function sendWelcome(email, username) {
  const html = wrapEmail(`
    <div style="font-size:20px;margin-bottom:12px">🎉</div>
    <div style="font-size:16px;font-weight:700;color:#222;margin-bottom:8px">Xush kelibsiz, ${username}!</div>
    <div style="font-size:14px;color:#666">Email manzilingiz tasdiqlandi. MindHub jamoasiga xush kelibsiz —
    g'oyalaringizni ulashing, muammolarni ko'taring, javob toping.</div>
  `);
  return sendViaResend({ to: email, subject: 'MindHub — Xush kelibsiz!', html });
}

module.exports = { sendVerifyCode, sendPasswordReset, sendPasswordResetLink, sendWelcome };
