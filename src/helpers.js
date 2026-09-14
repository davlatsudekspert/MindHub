'use strict';
const crypto = require('crypto');
const { SECRET } = require('./db');

function uid() { return crypto.randomUUID(); }
function now() { return Math.floor(Date.now() / 1000); }
function hashPass(p) { return crypto.createHmac('sha256', SECRET).update(p).digest('hex'); }

function makeToken(userId) {
  const pl = Buffer.from(JSON.stringify({ userId, exp: Date.now() + 14 * 864e5 })).toString('base64url');
  const sg = crypto.createHmac('sha256', SECRET).update(pl).digest('base64url');
  return `${pl}.${sg}`;
}

function verifyToken(tok) {
  if (!tok) return null;
  try {
    const [pl, sg] = tok.split('.');
    if (!pl || !sg) return null;
    if (crypto.createHmac('sha256', SECRET).update(pl).digest('base64url') !== sg) return null;
    const d = JSON.parse(Buffer.from(pl, 'base64url').toString());
    return Date.now() > d.exp ? null : d.userId;
  } catch { 
    return null; 
  }
}

function getAuth(req) {
  const h = req.headers['authorization'] || '';
  return verifyToken(h.startsWith('Bearer ') ? h.slice(7).trim() : '');
}

function timeAgo(ts) {
  const d = now() - ts;
  if (d < 60) return `${d}s`;
  if (d < 3600) return `${Math.floor(d / 60)}m`;
  if (d < 86400) return `${Math.floor(d / 3600)}h`;
  if (d < 604800) return `${Math.floor(d / 86400)}d`;
  if (d < 2592000) return `${Math.floor(d / 604800)}w`;
  return `${Math.floor(d / 2592000)}mo`;
}

function readBody(req) {
  return new Promise((res, rej) => {
    let b = '';
    req.on('data', c => { b += c; if (b.length > 4e6) req.destroy(); });
    req.on('end', () => { 
      try { 
        res(JSON.parse(b)); 
      } catch { 
        res({}); 
      } 
    });
    req.on('error', rej);
  });
}

function parseMultipart(req) {
  return new Promise(resolve => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const buf = Buffer.concat(chunks);
      const ct = req.headers['content-type'] || '';
      const bm = ct.match(/boundary=([^\s;]+)/);
      if (!bm) return resolve({ fields: {}, file: null });
      
      const boundary = '--' + bm[1].trim();
      const fields = {}; 
      let file = null;
      const parts = buf.toString('binary').split(boundary);
      
      for (const part of parts) {
        if (!part.trim() || part.trim() === '--') continue;
        const sep = part.indexOf('\r\n\r\n');
        if (sep < 0) continue;
        
        const hdrs = part.slice(0, sep);
        const content = part.slice(sep + 4).replace(/\r\n$/, '');
        const nm = hdrs.match(/name="([^"]+)"/);
        const fn = hdrs.match(/filename="([^"]+)"/);
        
        if (!nm) continue;
        
        if (fn) {
          const ext = require('path').extname(fn[1]).toLowerCase();
          if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
            file = { ext, data: Buffer.from(content, 'binary') };
          }
        } else {
          fields[nm[1]] = content.trim();
        }
      }
      resolve({ fields, file });
    });
  });
}

function json(res, data, status = 200) {
  // MUHIM: Agar data undefined bo'lsa, {} ga aylantirish
  if (data === undefined || data === null) {
    data = {};
  }
  
  const body = JSON.stringify(data);
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Content-Length': Buffer.byteLength(body, 'utf-8')
  };
  
  res.writeHead(status, headers);
  res.end(body);
}

const COLORS = ['#C8922A', '#4D8FFF', '#46C97A', '#9B6FD4', '#3AADCC', '#E8703A', '#FF5252', '#00BCD4'];

function randColor() { 
  return COLORS[Math.floor(Math.random() * COLORS.length)]; 
}

module.exports = { 
  uid, 
  now, 
  hashPass, 
  makeToken, 
  verifyToken, 
  getAuth, 
  timeAgo, 
  readBody, 
  parseMultipart, 
  json, 
  randColor 
};