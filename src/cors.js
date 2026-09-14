'use strict';
// ALLOWED_ORIGINS env: vergul bilan ajratilgan ruxsat etilgan originlar ro'yxati.
// Masalan: ALLOWED_ORIGINS=https://mindhub.uz,https://www.mindhub.uz
function allowedOrigins() {
  return (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

// So'rov headerlaridagi Origin ruxsat etilganlar ro'yxatida bo'lsa, o'shani qaytaradi
// (Access-Control-Allow-Origin uchun aynan shu qiymat kerak, '*' emas — chunki
// Authorization header bilan credentiallar yuborilyapti). Aks holda null.
function corsOrigin(req) {
  const origin = req.headers && req.headers.origin;
  if (!origin) return null;
  const allowed = allowedOrigins();
  if (allowed.length === 0) return null;
  return allowed.includes(origin) ? origin : null;
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

function corsHeaders(req) {
  const origin = corsOrigin(req);
  const headers = { ...SECURITY_HEADERS };
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Vary'] = 'Origin';
  }
  return headers;
}

module.exports = { allowedOrigins, corsOrigin, corsHeaders, SECURITY_HEADERS };
