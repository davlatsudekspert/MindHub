// Cloudflare Workers kirish nuqtasi — server.js (Node/http) o'rnini bosadi.
// ES module sintaksisi (Workers'ning zamonaviy formati) ishlatiladi, lekin
// src/*.js'ning qolgan qismi CommonJS (require/module.exports) bo'lib
// qoladi — esbuild (wrangler ichida) buni avtomatik bog'laydi, alohida
// o'zgartirish shart emas.
//
// Asosiy g'oya: src/routes.js#route(req,res) 1600+ qatorlik biznes-mantiqni
// O'ZGARTIRMASDAN qayta ishlatish uchun bu yerda Node'ning IncomingMessage/
// ServerResponse interfeysini taqlid qiluvchi yengil "shim" (soxtalashtirilgan
// req/res obyektlari) tuzilgan — xuddi test/_helpers.js'dagi kabi (o'sha
// yerda ham xuddi shunday shim orqali routelar haqiqiy server ochmasdan
// sinovdan o'tkazilgan).

const { setEnv, getEnv } = require('../src/env');
const { Q, db, seed } = require('../src/db');
const { route } = require('../src/routes');
const { corsHeaders } = require('../src/cors');
const { runScheduled } = require('../src/cron');
const { tick: aiTick } = require('../src/ai/worker');
const { WsHub } = require('../src/ws-do');

// seed() har ISOLYAT uchun bir marta — sovuq boshlanishda (cold start)
// tizim foydalanuvchisi va standart jamoalarni yaratadi (mavjud bo'lsa hech
// narsa qilmaydi, xavfsiz idempotent). Bir nechta parallel so'rov bir xil
// isolyatga tushib qolsa ham (Workers'da bitta isolyat ko'p so'rovni ketma-ket
// qayta ishlaydi) faqat BIRINCHISI seed() chaqiradi.
let seeded = null;
async function ensureSeeded(secret) {
  if (!seeded) seeded = seed(secret).catch(err => { seeded = null; throw err; });
  return seeded;
}

/* ── Node-uslubidagi req/res shim — routes.js#route(req,res) ni o'zgarishsiz
   chaqirish uchun ── */
function makeReq(request, url, bodyBuffer) {
  const headers = {};
  for (const [k, v] of request.headers) headers[k] = v;
  return {
    method: request.method,
    url: url.pathname + url.search,
    headers,
    socket: { remoteAddress: headers['cf-connecting-ip'] || '' },
    on(event, cb) {
      if (event === 'data') {
        if (bodyBuffer && bodyBuffer.length) queueMicrotask(() => cb(bodyBuffer));
      } else if (event === 'end') {
        queueMicrotask(() => cb());
      }
      return this;
    },
    destroy() {},
  };
}

function makeRes() {
  let resolveDone;
  const done = new Promise(r => { resolveDone = r; });
  const res = {
    _status: 200,
    _headers: {},
    _chunks: [],
    headersSent: false,
    writeHead(status, headers) {
      this._status = status;
      if (headers) Object.assign(this._headers, headers);
      this.headersSent = true;
      return this;
    },
    setHeader(k, v) { this._headers[k] = v; },
    write(chunk) { this._chunks.push(chunk); return true; },
    end(body) {
      if (body !== undefined) this._chunks.push(body);
      this.headersSent = true;
      resolveDone();
    },
    _done: done,
  };
  return res;
}

async function handleApi(request, url, env, ctx) {
  const bodyBuf = request.method !== 'GET' && request.method !== 'HEAD'
    ? Buffer.from(await request.arrayBuffer())
    : Buffer.alloc(0);
  const req = makeReq(request, url, bodyBuf);
  const res = makeRes();
  try {
    const handled = await route(req, res);
    if (handled === null) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'API topilmadi' }));
    }
  } catch (err) {
    console.error("API so'rovida xatolik", request.method, url.pathname, err?.stack || String(err));
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Server xatosi' }));
    }
  }
  const body = res._chunks.length
    ? Buffer.concat(res._chunks.map(c => (typeof c === 'string' ? Buffer.from(c) : c)))
    : undefined;
  return new Response(body, { status: res._status, headers: res._headers });
}

// R2 binding orqali /uploads/:key ni Range (video/audio seek) qo'llab-quvvatlab xizmat qiladi.
async function handleUpload(request, key, env) {
  const rangeHeader = request.headers.get('range');
  let rangeOpt;
  if (rangeHeader) {
    const m = rangeHeader.match(/bytes=(\d+)-(\d*)/);
    if (m) {
      const offset = parseInt(m[1], 10);
      const end = m[2] ? parseInt(m[2], 10) : undefined;
      rangeOpt = { offset, length: end !== undefined ? end - offset + 1 : undefined };
    }
  }
  const obj = await env.R2.get(key, rangeOpt ? { range: rangeOpt } : undefined);
  if (!obj) return new Response('Not found', { status: 404 });
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  headers.set('accept-ranges', 'bytes');
  headers.set('cache-control', 'public,max-age=31536000');
  if (rangeOpt && obj.range) {
    const total = obj.size;
    const start = obj.range.offset;
    const len = obj.range.length ?? (total - start);
    headers.set('content-range', `bytes ${start}-${start + len - 1}/${total}`);
    return new Response(obj.body, { status: 206, headers });
  }
  return new Response(obj.body, { status: 200, headers });
}

export default {
  async fetch(request, env, ctx) {
    setEnv(env, ctx);
    const url = new URL(request.url);

    // WebSocket ulanishlari — Durable Object'ga proksi qilinadi (src/ws-do.js).
    // Token query parametridan userId aniqlanadi (server.js'dagi eski
    // 'upgrade' handlerining ekvivalenti).
    if (url.pathname === '/ws') {
      const { verifyToken } = require('../src/helpers');
      const tok = url.searchParams.get('token');
      const decoded = tok ? verifyToken(decodeURIComponent(tok)) : null;
      const userId = decoded ? decoded.userId : `anon_${Date.now()}`;
      const id = env.WSHUB.idFromName('hub');
      const doUrl = new URL(request.url);
      doUrl.searchParams.set('userId', userId);
      return env.WSHUB.get(id).fetch(doUrl.toString(), request);
    }

    if (request.method === 'OPTIONS') {
      const req = { headers: Object.fromEntries(request.headers) };
      return new Response(null, {
        status: 204,
        headers: {
          ...corsHeaders(req),
          'Access-Control-Allow-Headers': 'Authorization,Content-Type',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
        },
      });
    }

    if (url.pathname.startsWith('/uploads/')) {
      return handleUpload(request, url.pathname.slice('/uploads/'.length), env);
    }

    if (url.pathname.startsWith('/api/')) {
      try {
        await ensureSeeded(env.SECRET);
      } catch (e) {
        console.error('seed() xatoligi:', e?.stack || String(e));
      }
      return handleApi(request, url, env, ctx);
    }

    // Qolgan hamma narsa — statik frontend (public/), Workers Assets binding
    // orqali (wrangler.toml [assets]). not_found_handling=single-page-
    // application allaqachon mavjud bo'lmagan yo'llar uchun index.html'ni
    // qaytaradi (server.js'dagi eski fallback mantig'i bilan bir xil).
    const assetRes = await env.ASSETS.fetch(request);
    if (url.pathname.endsWith('.js') || url.pathname.endsWith('.css')) {
      const headers = new Headers(assetRes.headers);
      headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
      return new Response(assetRes.body, { status: assetRes.status, headers });
    }
    return assetRes;
  },

  // Cron Trigger (wrangler.toml [triggers] crons) — Node versiyasidagi
  // setInterval-asosli src/cron.js#startCron va src/ai/worker.js#startAiWorker
  // o'rnini bosadi (Workers'da doimiy background process yo'q).
  async scheduled(event, env, ctx) {
    setEnv(env, ctx);
    ctx.waitUntil((async () => {
      await runScheduled();
      await aiTick();
    })());
  },
};

export { WsHub };
