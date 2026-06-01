// ── MITTI PROPOSALS — Multi-Model AI Router (Cloudflare Pages Function) ──
const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const GROQ_API      = 'https://api.groq.com/openai/v1/chat/completions';
const GEMINI_API    = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';

const ALLOWED_ORIGINS = [
  'https://mitti.in', 'https://www.mitti.in',
  'https://mitti-website.netlify.app', 'https://mitti-website.pages.dev',
];
const ALLOWED_DOC_TYPES = ['proposal', 'contract', 'nda', 'sow', 'retainer', 'followup'];
const ALLOWED_LANGUAGES = ['english', 'hindi', 'both'];
const MAX_FIELD_BYTES   = 8000;
const MAX_TOKENS_LIMIT  = 4000;

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  };
}

export async function onRequestOptions({ request }) {
  return new Response(null, { status: 200, headers: corsHeaders(request.headers.get('origin') || '') });
}

export async function onRequestPost({ request, env }) {
  const origin = request.headers.get('origin') || '';
  const cors = corsHeaders(origin);

  let body;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body.' }), { status: 400, headers: cors });
  }

  const { system, user, max_tokens, docType, language } = body;
  if (!system || !user)
    return new Response(JSON.stringify({ error: 'Missing system or user field.' }), { status: 400, headers: cors });

  const enc = new TextEncoder();
  if (typeof system !== 'string' || enc.encode(system).length > MAX_FIELD_BYTES)
    return new Response(JSON.stringify({ error: 'Invalid request.' }), { status: 400, headers: cors });
  if (typeof user !== 'string' || enc.encode(user).length > MAX_FIELD_BYTES)
    return new Response(JSON.stringify({ error: 'Invalid request.' }), { status: 400, headers: cors });
  if (docType && !ALLOWED_DOC_TYPES.includes(docType))
    return new Response(JSON.stringify({ error: 'Invalid document type.' }), { status: 400, headers: cors });
  if (language && !ALLOWED_LANGUAGES.includes(language))
    return new Response(JSON.stringify({ error: 'Invalid language.' }), { status: 400, headers: cors });

  const safeMaxTokens = Math.min(parseInt(max_tokens, 10) || 4000, MAX_TOKENS_LIMIT);
  const isHindi    = language === 'hindi';
  const isFollowup = docType === 'followup';

  let result;
  try {
    if (isHindi && env.GEMINI_API_KEY) {
      result = await callGemini(system, user, safeMaxTokens, env.GEMINI_API_KEY);
    } else if (isFollowup && env.GROQ_API_KEY) {
      result = await callGroq(system, user, safeMaxTokens, env.GROQ_API_KEY, env.ANTHROPIC_API_KEY);
    } else if (env.ANTHROPIC_API_KEY) {
      result = await callClaude(system, user, safeMaxTokens, env.ANTHROPIC_API_KEY);
    } else {
      return new Response(JSON.stringify({ error: 'No API keys configured on server.' }), { status: 500, headers: cors });
    }
  } catch (err) {
    return new Response(JSON.stringify({ error: humanError(err.message) }), { status: 500, headers: cors });
  }

  return new Response(JSON.stringify({ content: [{ text: result }] }), { status: 200, headers: cors });
}

async function callClaude(system, user, max_tokens, apiKey) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 55000);
  try {
    const res = await fetch(ANTHROPIC_API, {
      method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: max_tokens || 4000, system, messages: [{ role: 'user', content: user }] }),
    });
    clearTimeout(timer);
    const data = await res.json();
    if (!res.ok || data.type === 'error') throw new Error(data?.error?.message || 'Claude API error ' + res.status);
    return data.content?.[0]?.text || '';
  } catch (err) { clearTimeout(timer); throw err; }
}

async function callGroq(system, user, max_tokens, apiKey, claudeKey) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(GROQ_API, {
      method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ model: 'llama-3.3-70b-versatile', max_tokens: max_tokens || 2000, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
    });
    clearTimeout(timer);
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data?.error?.message || 'Groq API error ' + res.status);
    return data.choices?.[0]?.message?.content || '';
  } catch (err) {
    clearTimeout(timer);
    if (claudeKey) return callClaude(system, user, max_tokens, claudeKey);
    throw err;
  }
}

async function callGemini(system, user, max_tokens, apiKey) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 40000);
  try {
    const res = await fetch(GEMINI_API, {
      method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({ contents: [{ parts: [{ text: `${system}\n\n${user}` }] }], generationConfig: { maxOutputTokens: max_tokens || 4000 } }),
    });
    clearTimeout(timer);
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data?.error?.message || 'Gemini API error ' + res.status);
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  } catch (err) { clearTimeout(timer); throw err; }
}

function humanError(msg = '') {
  if (msg.includes('credit') || msg.includes('balance')) return 'Service temporarily unavailable. Please try again later.';
  if (msg.includes('invalid_api_key') || msg.includes('auth') || msg.includes('Unauthorized')) return 'Server configuration error. Please contact hello@mitti.in';
  if (msg.includes('rate') || msg.includes('limit') || msg.includes('429')) return 'Too many requests right now. Please wait a few seconds and try again.';
  if (msg.includes('abort') || msg.includes('timed out')) return 'Generation timed out. Please try again.';
  return 'Something went wrong. Please try again.';
}
