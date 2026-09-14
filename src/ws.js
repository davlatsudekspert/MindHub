'use strict';
const crypto = require('crypto');
const clients = new Map();

function handshake(req, sock) {
  const acc = crypto.createHash('sha1')
    .update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + acc + '\r\n\r\n');
}
function encode(obj) {
  const d = Buffer.from(JSON.stringify(obj));
  const l = d.length;
  let h;
  if (l < 126) { h = Buffer.alloc(2); h[0] = 0x81; h[1] = l; }
  else if (l < 65536) { h = Buffer.alloc(4); h[0] = 0x81; h[1] = 126; h.writeUInt16BE(l, 2); }
  else { h = Buffer.alloc(10); h[0] = 0x81; h[1] = 127; h.writeBigUInt64BE(BigInt(l), 2); }
  return Buffer.concat([h, d]);
}
function decode(buf) {
  if (buf.length < 2) return null;
  if ((buf[0] & 0x0f) === 0x8) return { close: true };
  const masked = !!(buf[1] & 0x80);
  let l = buf[1] & 0x7f, off = 2;
  if (l === 126) { l = buf.readUInt16BE(2); off = 4; }
  else if (l === 127) { l = Number(buf.readBigUInt64BE(2)); off = 10; }
  if (masked) {
    const mk = buf.slice(off, off + 4); off += 4;
    const p = Buffer.alloc(l);
    for (let i = 0; i < l; i++) p[i] = buf[off + i] ^ mk[i % 4];
    try { return { data: JSON.parse(p.toString()) }; } catch { return null; }
  }
  try { return { data: JSON.parse(buf.slice(off, off + l).toString()) }; } catch { return null; }
}
function add(id, sock) { if (!clients.has(id)) clients.set(id, new Set()); clients.get(id).add(sock); }
function remove(id, sock) { if (!clients.has(id)) return; clients.get(id).delete(sock); if (!clients.get(id).size) clients.delete(id); }
function sendTo(id, obj) { const s = clients.get(id); if (!s) return; const f = encode(obj); for (const sk of s) { try { sk.write(f); } catch {} } }
function sendAll(obj) { const f = encode(obj); for (const [, s] of clients) for (const sk of s) { try { sk.write(f); } catch {} } }
function isOnline(id) { return clients.has(id) && clients.get(id).size > 0; }

module.exports = { handshake, encode, decode, add, remove, sendTo, sendAll, isOnline };
