'use strict';
// Fayl saqlash abstraksiyasi. STORAGE_DRIVER env orqali tanlanadi:
//   'local' (standart) — data/uploads papkasiga yozadi (Railway'da diskning
//     efemer ekanligini unutmang — deploy'dan keyin fayllar yo'qoladi)
//   'r2'   — Cloudflare R2 (S3-mos API). @aws-sdk/client-s3 ishlatilmaydi —
//     loyiha ataylab minimal dependency bilan yozilgan, shuning uchun
//     AWS Signature V4 qo'lda amalga oshirilgan (pastda).
//
// Interfeys: save(buffer, ext) -> Promise<url>, del(url) -> Promise<void>

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DRIVER = (process.env.STORAGE_DRIVER || 'local').toLowerCase();

/* ── local ── */
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

async function localSave(buffer, ext) {
  const fn = crypto.randomUUID() + ext;
  fs.writeFileSync(path.join(UPLOAD_DIR, fn), buffer);
  return `/uploads/${fn}`;
}

async function localDel(url) {
  if (!url || !url.startsWith('/uploads/')) return;
  const fp = path.join(UPLOAD_DIR, path.basename(url));
  try { fs.unlinkSync(fp); } catch { /* fayl allaqachon yo'q bo'lishi mumkin */ }
}

/* ── Cloudflare R2 (S3-mos API, AWS Signature V4) ── */
const R2_ACCOUNT_ID  = process.env.R2_ACCOUNT_ID;
const R2_BUCKET      = process.env.R2_BUCKET;
const R2_ACCESS_KEY  = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_KEY  = process.env.R2_SECRET_ACCESS_KEY;
const R2_PUBLIC_URL  = process.env.R2_PUBLIC_URL; // masalan https://cdn.mindhub.uz (oxirida / bo'lmasin)
const R2_REGION      = 'auto';
const R2_SERVICE     = 's3';
const R2_ENDPOINT    = `${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;

function hmac(key, data) {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}
function sha256Hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}
function amzDate() {
  const d = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  return { amzDate: d, dateStamp: d.slice(0, 8) };
}

// AWS Signature V4 — SIGV4 spesifikatsiyasiga qat'iy mos:
// https://docs.aws.amazon.com/general/latest/gr/sigv4-create-canonical-request.html
function signRequest({ method, key, payloadHash, extraHeaders = {} }) {
  const { amzDate: xAmzDate, dateStamp } = amzDate();
  const canonicalUri = '/' + R2_BUCKET + '/' + key.split('/').map(encodeURIComponent).join('/');

  // Barcha header nomlari ataylab kichik harfda beriladi (chaqiruvchi tomondan ham) —
  // SigV4 canonical headers kichik harfda va alifbo tartibida bo'lishi shart.
  const headers = {
    host: R2_ENDPOINT,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': xAmzDate,
    ...extraHeaders,
  };
  const sortedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = sortedHeaderNames.map(h => `${h}:${String(headers[h]).trim()}\n`).join('');
  const signedHeaders = sortedHeaderNames.join(';');

  const canonicalRequest = [
    method,
    canonicalUri,
    '', // query string yo'q
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const credentialScope = `${dateStamp}/${R2_REGION}/${R2_SERVICE}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    xAmzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const kDate = hmac('AWS4' + R2_SECRET_KEY, dateStamp);
  const kRegion = hmac(kDate, R2_REGION);
  const kService = hmac(kRegion, R2_SERVICE);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

  const authorization = `AWS4-HMAC-SHA256 Credential=${R2_ACCESS_KEY}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    url: `https://${R2_ENDPOINT}${canonicalUri}`,
    headers: {
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': xAmzDate,
      Authorization: authorization,
      ...extraHeaders,
    },
  };
}

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
async function putObject(key, buffer, ext) {
  if (!R2_ACCOUNT_ID || !R2_BUCKET || !R2_ACCESS_KEY || !R2_SECRET_KEY || !R2_PUBLIC_URL) {
    throw new Error('STORAGE_DRIVER=r2 uchun R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_PUBLIC_URL barchasi kerak');
  }
  const payloadHash = sha256Hex(buffer);
  const { url, headers } = signRequest({
    method: 'PUT',
    key,
    payloadHash,
    extraHeaders: { 'content-type': extToMime(ext) },
  });
  const r = await fetch(url, { method: 'PUT', headers, body: buffer });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`R2 yuklashda xatolik (${r.status}): ${body.slice(0, 300)}`);
  }
  return `${R2_PUBLIC_URL.replace(/\/$/, '')}/${key}`;
}

async function r2Save(buffer, ext) {
  return putObject(crypto.randomUUID() + ext, buffer, ext);
}

async function r2Del(url) {
  if (!url || !R2_PUBLIC_URL || !url.startsWith(R2_PUBLIC_URL)) return;
  const key = url.slice(R2_PUBLIC_URL.replace(/\/$/, '').length + 1);
  if (!key) return;
  const payloadHash = sha256Hex(Buffer.alloc(0));
  const { url: reqUrl, headers } = signRequest({ method: 'DELETE', key, payloadHash });
  try {
    const r = await fetch(reqUrl, { method: 'DELETE', headers });
    if (!r.ok && r.status !== 404) {
      console.error(`R2 o'chirishda xatolik (${r.status}):`, await r.text().catch(() => ''));
    }
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

module.exports = { save, del, driver: DRIVER, putObject, UPLOAD_DIR };
