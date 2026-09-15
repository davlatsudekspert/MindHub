'use strict';
// Fayl saqlash abstraksiyasi. STORAGE_DRIVER env orqali tanlanadi:
//   'local' — data/uploads papkasiga yozadi (faqat Node/lokal test uchun —
//     Cloudflare Workers'da fayl tizimi yo'q, ishlamaydi)
//   'r2' (Cloudflare Workers'da standart) — R2 binding orqali (wrangler.toml
//     dagi [[r2_buckets]] "R2" nomi). Fayllar Worker orqali o'zi xizmat
//     qiladi (GET /uploads/:key -> worker/index.js), shuning uchun R2
//     bucket'ni "public" qilish yoki alohida domen ulash SHART EMAS.
//
// Eslatma: bu yerda ilgari @aws-sdk/client-s3'siz, qo'lda yozilgan AWS
// Signature V4 orqali R2'ga ulanadigan kod bor edi (Node/Railway'dan R2'ga
// tashqi HTTP so'rovi sifatida) — Workers'ga to'liq ko'chirilgandan keyin bu
// endi kerak emas: Workers'da R2 binding (env.R2.put/get/delete) to'g'ridan-
// to'g'ri, xavfsizroq va tezroq ishlaydi (tarmoq orqali emas). SigV4 kodi
// olib tashlandi.
//
// Interfeys: save(buffer, ext) -> Promise<url>, del(url) -> Promise<void>

const crypto = require('crypto');
const { getEnv } = require('./env');

const DRIVER = (process.env.STORAGE_DRIVER || 'r2').toLowerCase();

/* ── local (faqat Node/lokal test — Workers'da chaqirilmaydi) ── */
function localSave(buffer, ext) {
  const fs = require('fs');
  const path = require('path');
  const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
  const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const fn = crypto.randomUUID() + ext;
  fs.writeFileSync(path.join(UPLOAD_DIR, fn), buffer);
  return `/uploads/${fn}`;
}

function localDel(url) {
  if (!url || !url.startsWith('/uploads/')) return;
  const fs = require('fs');
  const path = require('path');
  const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
  const fp = path.join(DATA_DIR, 'uploads', path.basename(url));
  try { fs.unlinkSync(fp); } catch { /* fayl allaqachon yo'q bo'lishi mumkin */ }
}

/* ── Cloudflare R2 (Workers binding orqali) ── */
function extToMime(ext) {
  const MIME = {
    '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.png':'image/png', '.gif':'image/gif',
    '.webp':'image/webp', '.heic':'image/heic',
    '.mp4':'video/mp4', '.webm':'video/webm', '.mov':'video/quicktime', '.avi':'video/x-msvideo', '.mkv':'video/x-matroska',
    '.mp3':'audio/mpeg', '.wav':'audio/wav', '.ogg':'audio/ogg', '.m4a':'audio/mp4', '.aac':'audio/aac',
  };
  return MIME[ext.toLowerCase()] || 'application/octet-stream';
}

// Pastki darajadagi yuklash — key'ni aniq belgilash imkonini beradi
// (scripts/migrate-uploads-to-r2.js eski fayl nomlarini saqlab qolish uchun ishlatadi).
// Qaytarilgan URL doim /uploads/<key> shaklida — haqiqiy fayl worker/index.js
// tomonidan shu yo'ldan R2 binding orqali o'qib beriladi (bucket "public"
// bo'lishi yoki alohida domen ulanishi shart emas).
async function putObject(key, buffer, ext) {
  const R2 = getEnv().R2;
  if (!R2) throw new Error('STORAGE_DRIVER=r2 uchun wrangler.toml da [[r2_buckets]] binding="R2" kerak');
  await R2.put(key, buffer, { httpMetadata: { contentType: extToMime(ext) } });
  return `/uploads/${key}`;
}

async function r2Save(buffer, ext) {
  return putObject(crypto.randomUUID() + ext, buffer, ext);
}

async function r2Del(url) {
  if (!url || !url.startsWith('/uploads/')) return;
  const key = url.slice('/uploads/'.length);
  if (!key) return;
  try {
    await getEnv().R2.delete(key);
  } catch (e) {
    console.error('R2 del xatoligi:', e.message);
  }
}

/* ── ochiq interfeys ── */
async function save(buffer, ext) {
  return DRIVER === 'r2' ? r2Save(buffer, ext) : localSave(buffer, ext);
}
async function del(url) {
  return DRIVER === 'r2' ? r2Del(url) : localDel(url);
}

module.exports = { save, del, driver: DRIVER, putObject };
