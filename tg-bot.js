'use strict';
const https = require('https');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error('TELEGRAM_BOT_TOKEN env o\'zgaruvchisi majburiy');
  process.exit(1);
}
const API_BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;
let offset = 0;
let dbRef = null;
const pendingLinks = new Map();

function tg(method, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body || {});
    const url = new URL(`${API_BASE}/${method}`);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, (res) => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => { try { resolve(JSON.parse(buf)); } catch { resolve({ ok: false }); } });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function sendMsg(chatId, text, extra = {}) {
  return tg('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', ...extra });
}

async function sendEmailViaResend(to, code) {
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) return false;
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:420px;margin:0 auto;padding:32px;background:#f8f9fa;border-radius:16px">
      <div style="text-align:center;margin-bottom:24px">
        <div style="font-size:32px;font-weight:800;color:#C8922A">MindHub</div>
      </div>
      <div style="background:#fff;border-radius:12px;padding:24px;text-align:center;box-shadow:0 2px 12px rgba(0,0,0,.06)">
        <div style="font-size:14px;color:#666;margin-bottom:12px">Telegram akkauntni bog'lash uchun tasdiqlash kodi:</div>
        <div style="font-size:36px;font-weight:800;color:#C8922A;letter-spacing:8px;padding:16px;background:#fdf6e8;border-radius:8px;margin:16px 0">${code}</div>
        <div style="font-size:12px;color:#999;margin-top:16px">Bu kod 5 daqiqa ichida amal qiladi.</div>
      </div>
      <div style="text-align:center;font-size:11px;color:#aaa;margin-top:20px">Agar siz bu so'rovni yubormagan bo'lsangiz, bu xabarni e'tiborsiz qoldiring.</div>
    </div>
  `;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'MindHub <onboarding@resend.dev>',
        to: [to],
        subject: 'MindHub — Telegram bog\'lash tasdiqlash kodi',
        html
      })
    });
    return r.ok;
  } catch (e) {
    console.error('Resend xatoligi:', e.message);
    return false;
  }
}

async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const text = (msg.text || '').trim();

  if (text === '/start' || text === '/menu') {
    await sendMsg(chatId,
      `Assalomu alaykum, MindHub botiga xush kelibsiz!\n\n` +
      `Akkauntingizni bog'lash uchun email manzilingizni yuboring.\n\n` +
      `Format: example@mail.com`
    );
    return;
  }

  if (text === '/help' || text === '/cancel') {
    pendingLinks.delete(chatId);
    await sendMsg(chatId,
      `Buyruqlar:\n\n` +
      `/start - Boshlash\n` +
      `/help - Yordam\n` +
      `/cancel - Jarayoni bekor qilish`
    );
    return;
  }

  if (pendingLinks.has(chatId)) {
    const state = pendingLinks.get(chatId);
    const code = text.trim();
    if (code.length === 6 && /^\d+$/.test(code)) {
      if (state.code === code) {
        const expiresAt = Math.floor(Date.now() / 1000);
        if (expiresAt > state.expiresAt) {
          pendingLinks.delete(chatId);
          await sendMsg(chatId, `Kod muddati tugagan. Qaytadan /start yuboring.`);
          return;
        }
        await dbRef.run('UPDATE users SET tg_chat_id=$1 WHERE id=$2', [String(chatId), state.userId]);
        pendingLinks.delete(chatId);
        await sendMsg(chatId,
          `Akkunt bog'landi!\n\n` +
          `Ism: ${state.name}\n` +
          `Username: @${state.username}\n\n` +
          `Endi MindHub saytida parolni tiklashingiz mumkin.`
        );
      } else {
        await sendMsg(chatId, `Noto'g'ri kod. Qaytadan kiriting yoki /cancel bilan bekor qiling.`);
      }
    } else {
      await sendMsg(chatId, `6 xonali raqamli kod kiriting. Yoki /cancel bilan bekor qiling.`);
    }
    return;
  }

  const emailMatch = text.trim().toLowerCase();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailMatch)) {
    const email = emailMatch;
    const user = await dbRef.get('SELECT id, username, name FROM users WHERE lower(email)=lower($1)', [email]);
    if (!user) {
      await sendMsg(chatId, `Bu emailga bog'langan akkaunt topilmadi. MindHub da ro'yxatdan o'tgan emailingizni kiriting.`);
      return;
    }
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = Math.floor(Date.now() / 1000) + 300;
    pendingLinks.set(chatId, {
      userId: user.id,
      username: user.username,
      name: user.name,
      code,
      expiresAt
    });
    const sent = await sendEmailViaResend(email, code);
    if (sent) {
      await sendMsg(chatId,
        `📧 Emailga tasdiqlash kodi yuborildi!\n\n` +
        `Kodni menga yuboring (6 xonali raqam).`
      );
    } else {
      pendingLinks.delete(chatId);
      await sendMsg(chatId, `Email yuborishda xatolik. Qaytadan /start yuboring.`);
    }
    return;
  }

  await sendMsg(chatId, `Noto'g'ri format. Email manzilingizni yuboring: example@mail.com`);
}

async function poll() {
  try {
    const res = await tg('getUpdates', { offset, timeout: 30, allowed_updates: ['message'] });
    if (res.ok && res.result) {
      for (const update of res.result) {
        offset = update.update_id + 1;
        if (update.message) {
          handleMessage(update.message).catch(e => console.error('Bot msg err:', e.message));
        }
      }
    }
  } catch (e) {
    console.error('Poll err:', e.message);
    await new Promise(r => setTimeout(r, 3000));
  }
  setTimeout(poll, 100);
}

async function startBot(database) {
  dbRef = database;
  const me = await tg('getMe');
  if (!me.ok) throw new Error('Bot token invalid: ' + JSON.stringify(me));
  console.log(`🤖 Bot started: @${me.result.username}`);
  poll();
}

module.exports = { startBot, tg, sendMsg };
