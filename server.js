#!/usr/bin/env node
'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');
const url  = require('url');

const { init }          = require('./src/db');
const { migrate }       = require('./src/migrate');
const { route }         = require('./src/routes');
const ws                = require('./src/ws');
const { verifyToken }   = require('./src/helpers');
const { corsHeaders, SECURITY_HEADERS } = require('./src/cors');
const { startCron }     = require('./src/cron');
const { startAiWorker } = require('./src/ai/worker');
const { log }           = require('./src/logger');

// Process darajasidagi xavfsizlik to'ri: ushlanmagan promise rad etilishi
// (unhandled rejection) Node 15+ da butun serverni yiqitadi. Bitta await
// qilinmagan promise (masalan fire-and-forget email/notification) hamma
// foydalanuvchilarni uzib qo'ymasligi uchun bu yerda tutib qolinadi va faqat
// logga yoziladi — jarayon davom etadi.
process.on('unhandledRejection', (reason) => {
  log.error('Ushlanmagan promise xatoligi (unhandledRejection)', { reason: reason?.stack || String(reason) });
});
// uncaughtException'dan keyin jarayon holati noaniq bo'lishi mumkin (Node
// hujjatlariga ko'ra) — shuning uchun bu yerda davom etilmaydi: logga yozib,
// aniq chiqiladi. railway.json'dagi restartPolicy (ON_FAILURE) darhol qayta
// ishga tushiradi.
process.on('uncaughtException', (err) => {
  log.error('Ushlanmagan istisno (uncaughtException) — server qayta ishga tushadi', { error: err?.stack || String(err) });
  process.exit(1);
});

const DATA_DIR = process.env.DATA_DIR || __dirname;
const PORT     = process.env.PORT || 3000;
const PUB      = path.join(__dirname, 'public');
const UPLOAD   = path.join(DATA_DIR, 'uploads');

console.log('📁 DATA_DIR:', DATA_DIR);
console.log('📁 PUB path:', PUB);
console.log('📁 UPLOAD path:', UPLOAD);

if (!fs.existsSync(UPLOAD)) fs.mkdirSync(UPLOAD, { recursive: true });

const MIME = {
  '.html':'text/html;charset=utf-8', '.css':'text/css', '.js':'application/javascript',
  '.json':'application/json',
  '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
  '.gif':'image/gif', '.webp':'image/webp', '.svg':'image/svg+xml', '.ico':'image/x-icon',
  // Audio/Video MIME types - required for browser playback
  '.mp3':'audio/mpeg', '.wav':'audio/wav', '.ogg':'audio/ogg',
  '.m4a':'audio/mp4', '.aac':'audio/aac',
  '.webm':'video/webm', '.mp4':'video/mp4', '.mov':'video/quicktime',
  '.avi':'video/x-msvideo', '.mkv':'video/x-matroska',
};

const server = http.createServer(async (req, res) => {
  const pname = url.parse(req.url).pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      ...corsHeaders(req),
      'Access-Control-Allow-Headers': 'Authorization,Content-Type',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    });
    return res.end();
  }

  if (pname.startsWith('/uploads/')) {
    const f = path.join(UPLOAD, path.basename(pname));
    if (fs.existsSync(f)) {
      const ext  = path.extname(f).toLowerCase();
      const mime = MIME[ext] || 'application/octet-stream';
      const stat = fs.statSync(f);
      const total = stat.size;

      // Range request support (needed for audio/video seeking in browser)
      const range = req.headers.range;
      if (range && (mime.startsWith('audio') || mime.startsWith('video'))) {
        const parts  = range.replace(/bytes=/, '').split('-');
        const start  = parseInt(parts[0], 10);
        const end    = parts[1] ? parseInt(parts[1], 10) : total - 1;
        const chunkSize = end - start + 1;
        const fileStream = fs.createReadStream(f, { start, end });
        res.writeHead(206, {
          ...SECURITY_HEADERS,
          'Content-Range':  `bytes ${start}-${end}/${total}`,
          'Accept-Ranges':  'bytes',
          'Content-Length': chunkSize,
          'Content-Type':   mime,
        });
        return fileStream.pipe(res);
      }

      res.writeHead(200, {
        ...SECURITY_HEADERS,
        'Content-Type':   mime,
        'Content-Length': total,
        'Accept-Ranges':  'bytes',
        'Cache-Control':  'public,max-age=31536000',
      });
      return fs.createReadStream(f).pipe(res);
    }
    res.writeHead(404); return res.end('Not found');
  }

  if (pname.startsWith('/api/')) {
    try {
      const handled = await route(req, res);
      if (handled === null) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'API topilmadi' }));
      }
    } catch (err) {
      log.error('API so\'rovida xatolik', { method: req.method, path: pname, error: err?.stack || String(err) });
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Server xatosi' }));
      }
    }
    return;
  }

  let fp = path.join(PUB, pname === '/' ? 'index.html' : pname);
  if (!fs.existsSync(fp)) fp = path.join(PUB, 'index.html');
  if (fs.existsSync(fp)) {
    const ext = path.extname(fp).toLowerCase();
    const headers = { ...SECURITY_HEADERS, 'Content-Type': MIME[ext] || 'text/plain' };
    // JS/CSS: never cache, so new deploys reach users immediately
    if (ext === '.js' || ext === '.css') headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
    res.writeHead(200, headers);
    return fs.createReadStream(fp).pipe(res);
  }
  res.writeHead(404); res.end('Not found');
});

server.on('upgrade', (req, socket) => {
  try {
    ws.handshake(req, socket);
    const m   = (req.url || '').match(/[?&]token=([^&]+)/);
    const decoded = m ? verifyToken(decodeURIComponent(m[1])) : null;
    const uid = decoded ? decoded.userId : null;
    const key = uid || `anon_${Date.now()}`;
    ws.add(key, socket);
    let buf = Buffer.alloc(0);
    socket.on('data', chunk => {
      buf = Buffer.concat([buf, chunk]);
      const f = ws.decode(buf);
      if (f) {
        buf = Buffer.alloc(0);
        if (f.close) { socket.destroy(); return; }
        // Forward WebRTC signaling messages from client
        if (f.data && f.data.type && uid) {
          const d = f.data;
          if (['call_offer','call_answer','ice_candidate','call_end','call_reject'].includes(d.type)) {
            if (d.to) ws.sendTo(d.to, { type: d.type, data: { ...d, from: uid } });
          }
        }
      }
    });
    socket.on('close', () => { if (uid) ws.remove(uid, socket); });
    socket.on('error', () => { try { socket.destroy(); } catch {} });
    socket.write(ws.encode({ type: 'connected', userId: uid }));
  } catch (err) {
    log.error('WebSocket upgrade xatoligi', { error: err?.stack || String(err) });
    try { socket.destroy(); } catch {}
  }
});

init()
  .then(() => migrate())
  .then(() => {
    startCron();
    startAiWorker();
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`\n  MindHub  →  http://localhost:${PORT}\n`);
    });
  })
  .catch(err => {
    console.error('❌ Server ishga tushmadi:', err.message);
    process.exit(1);
  });
