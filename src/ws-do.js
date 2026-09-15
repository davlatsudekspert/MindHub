'use strict';
// Cloudflare Durable Object — WebSocket "hub". Node versiyasida (src/ws.js
// eski varianti) bitta process ichidagi xom TCP socketlar Map'da saqlanardi
// (bitta server instance = bitta "hub"). Workers'da bunday doimiy, umumiy
// jarayon yo'q — har so'rov o'z izolyatida ishlaydi. Shuning uchun barcha
// WebSocket ulanishlari va ularni foydalanuvchi ID bo'yicha yo'naltirish BITTA
// Durable Object instansi (singleton, "hub" nomli id) ichida to'planadi —
// worker/index.js WebSocket so'rovlarini shu DO'ga proksi qiladi, routes.js
// esa xabar yuborish uchun shu DO'ga so'rov yuboradi (src/ws.js orqali).
//
// Hibernatable WebSockets API (state.acceptWebSocket) ishlatiladi — bu bilan
// DO faol emasligida "uyquga ketadi" (xotira/CPU sarflamaydi), lekin ulanish
// ochiq qoladi va yangi xabar kelganda avtomatik uyg'onadi.
class WsHub {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    const url = new URL(request.url);

    // worker/index.js dan ichki chaqiruv: xabar yuborish (HTTP orqali, DO'lar
    // orasida bog'lanishning yagona usuli shu — to'g'ridan-to'g'ri funksiya
    // chaqirish emas, chunki DO alohida joylashuvda ishlashi mumkin).
    if (url.pathname === '/send') {
      const { userId, payload, broadcast } = await request.json();
      const targets = this.state.getWebSockets(broadcast ? undefined : userId);
      for (const ws of targets) {
        try { ws.send(JSON.stringify(payload)); } catch {}
      }
      return new Response('ok');
    }
    if (url.pathname === '/online') {
      const userId = url.searchParams.get('userId');
      const sockets = this.state.getWebSockets(userId);
      return new Response(JSON.stringify({ online: sockets.length > 0 }), { headers: { 'content-type': 'application/json' } });
    }

    // Haqiqiy WebSocket upgrade so'rovi.
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Kutilgan: WebSocket upgrade', { status: 426 });
    }
    const userId = url.searchParams.get('userId') || `anon_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    // "tags" — getWebSockets(tag) shu userId bilan filtrlash imkonini beradi
    // (bitta user bir nechta qurilmadan/tabdan ulangan bo'lishi mumkin).
    this.state.acceptWebSocket(server, [userId]);
    server.serializeAttachment({ userId });
    return new Response(null, { status: 101, webSocket: client });
  }

  // Hibernatable WebSockets API — DO uyg'onganda shu handlerlar chaqiriladi.
  async webSocketMessage(ws, message) {
    let data;
    try { data = JSON.parse(message); } catch { return; }
    const { userId } = ws.deserializeAttachment() || {};
    if (!userId || !data?.type) return;
    // WebRTC signalizatsiya xabarlarini boshqa foydalanuvchiga forward qilish
    // (server.js'dagi eski 'upgrade' handlerining ekvivalenti).
    if (['call_offer', 'call_answer', 'ice_candidate', 'call_end', 'call_reject'].includes(data.type)) {
      if (data.to) {
        const targets = this.state.getWebSockets(data.to);
        const out = JSON.stringify({ type: data.type, data: { ...data, from: userId } });
        for (const t of targets) { try { t.send(out); } catch {} }
      }
    }
  }

  async webSocketClose(ws, code, reason, wasClean) {
    try { ws.close(code, reason); } catch {}
  }

  async webSocketError(ws) {
    try { ws.close(); } catch {}
  }
}

module.exports = { WsHub };
