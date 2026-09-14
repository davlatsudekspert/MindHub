'use strict';
// AI provayder abstraksiyasi. AI_PROVIDER env orqali tanlanadi.
// AI_PROVIDER o'rnatilmagan bo'lsa, butun AI qismi jim o'chadi (feature flag) —
// ilova baribir to'liq ishlaydi, faqat klasterlash/embedding funksiyalari
// no-op qaytaradi.
//
// Interfeys:
//   embed(texts: string[]) -> Promise<number[][]>
//   chat(systemPrompt, userPrompt, opts) -> Promise<string>
//
// Variantlar:
//   'cloudflare' — Workers AI REST API. Embedding: @cf/baai/bge-m3 (1024 o'lchov,
//     ko'p tilli, o'zbek tili uchun yaxshi natija beradi). Chat: @cf/meta/llama-3.1-8b-instruct
//   'openai'     — text-embedding-3-small (1536) + gpt-4o-mini
//
// Env: AI_PROVIDER, AI_API_KEY, CF_ACCOUNT_ID, AI_EMBED_MODEL, AI_CHAT_MODEL

const PROVIDER = (process.env.AI_PROVIDER || '').toLowerCase();
const AI_API_KEY = process.env.AI_API_KEY;
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const EMBED_MODEL = process.env.AI_EMBED_MODEL;
const CHAT_MODEL = process.env.AI_CHAT_MODEL;

const enabled = !!PROVIDER;

async function withRetry(fn, { retries = 3, timeoutMs = 20000, label = 'ai' } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const result = await fn(controller.signal);
      clearTimeout(timer);
      return result;
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      console.error(`[ai:${label}] urinish ${attempt}/${retries} muvaffaqiyatsiz:`, e.message);
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 500 * Math.pow(2, attempt - 1)));
      }
    }
  }
  throw lastErr;
}

/* ── Cloudflare Workers AI ── */
async function cfEmbed(texts) {
  const model = EMBED_MODEL || '@cf/baai/bge-m3';
  return withRetry(async (signal) => {
    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/${model}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${AI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: texts }),
      signal,
    });
    const data = await r.json();
    if (!r.ok || !data.success) throw new Error(`Cloudflare embed xatosi: ${JSON.stringify(data.errors || data)}`);
    // Workers AI bge-m3 javobi: { result: { data: [[...],[...]] } | { shape, data } }
    const vectors = data.result?.data || data.result?.embeddings || data.result;
    console.log(`[ai:embed] ${texts.length} matn, model=${model}`);
    return vectors;
  }, { label: 'cf-embed' });
}

async function cfChat(systemPrompt, userPrompt) {
  const model = CHAT_MODEL || '@cf/meta/llama-3.1-8b-instruct';
  return withRetry(async (signal) => {
    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/${model}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${AI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
      signal,
    });
    const data = await r.json();
    if (!r.ok || !data.success) throw new Error(`Cloudflare chat xatosi: ${JSON.stringify(data.errors || data)}`);
    console.log(`[ai:chat] model=${model}`);
    return (data.result?.response || '').trim();
  }, { label: 'cf-chat' });
}

/* ── OpenAI ── */
async function openaiEmbed(texts) {
  const model = EMBED_MODEL || 'text-embedding-3-small';
  return withRetry(async (signal) => {
    const r = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${AI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input: texts }),
      signal,
    });
    const data = await r.json();
    if (!r.ok) throw new Error(`OpenAI embed xatosi: ${JSON.stringify(data.error || data)}`);
    console.log(`[ai:embed] ${texts.length} matn, model=${model}`);
    return data.data.map(d => d.embedding);
  }, { label: 'openai-embed' });
}

async function openaiChat(systemPrompt, userPrompt) {
  const model = CHAT_MODEL || 'gpt-4o-mini';
  return withRetry(async (signal) => {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${AI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
      signal,
    });
    const data = await r.json();
    if (!r.ok) throw new Error(`OpenAI chat xatosi: ${JSON.stringify(data.error || data)}`);
    console.log(`[ai:chat] model=${model}`);
    return (data.choices?.[0]?.message?.content || '').trim();
  }, { label: 'openai-chat' });
}

/* ── Anthropic (faqat chat) ── */
async function anthropicChat(systemPrompt, userPrompt) {
  const model = CHAT_MODEL || 'claude-haiku-4-5-20251001';
  return withRetry(async (signal) => {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': AI_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 512,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
      signal,
    });
    const data = await r.json();
    if (!r.ok) throw new Error(`Anthropic chat xatosi: ${JSON.stringify(data.error || data)}`);
    console.log(`[ai:chat] model=${model}`);
    return (data.content?.[0]?.text || '').trim();
  }, { label: 'anthropic-chat' });
}

async function embed(texts) {
  if (!enabled) return null;
  if (PROVIDER === 'cloudflare') return cfEmbed(texts);
  if (PROVIDER === 'openai') return openaiEmbed(texts);
  throw new Error(`AI_PROVIDER='${PROVIDER}' embedding'ni qo'llab-quvvatlamaydi (faqat 'cloudflare' yoki 'openai')`);
}

async function chat(systemPrompt, userPrompt, opts) {
  if (!enabled) return null;
  if (PROVIDER === 'cloudflare') return cfChat(systemPrompt, userPrompt, opts);
  if (PROVIDER === 'openai') return openaiChat(systemPrompt, userPrompt, opts);
  if (PROVIDER === 'anthropic') return anthropicChat(systemPrompt, userPrompt, opts);
  throw new Error(`Noma'lum AI_PROVIDER: '${PROVIDER}'`);
}

module.exports = { enabled, provider: PROVIDER, embed, chat };
