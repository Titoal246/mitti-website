// ── MITTI PROPOSALS — Multi-Model AI Router ──
// Proposals/Contracts → Claude Haiku (best structured Indian English)
// Follow-up Emails   → Groq Llama (free tier, fast, great for short content)
// Hindi language      → Gemini Flash (best South Asian multilingual)

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const GROQ_API      = 'https://api.groq.com/openai/v1/chat/completions';
const GEMINI_API    = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';

exports.handler = async function (event) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Invalid JSON body.' }) };
  }

  const { system, user, max_tokens, docType, language } = body;
  if (!system || !user) {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Missing system or user field.' }) };
  }

  // ── ROUTE TO BEST MODEL ──
  const isHindi   = language === 'hindi';
  const isFollowup = docType === 'followup';

  let result;
  try {
    if (isHindi && process.env.GEMINI_API_KEY) {
      result = await callGemini(system, user, max_tokens, process.env.GEMINI_API_KEY);
    } else if (isFollowup && process.env.GROQ_API_KEY) {
      result = await callGroq(system, user, max_tokens, process.env.GROQ_API_KEY);
    } else if (process.env.ANTHROPIC_API_KEY) {
      result = await callClaude(system, user, max_tokens, process.env.ANTHROPIC_API_KEY);
    } else {
      return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'No API keys configured on server.' }) };
    }
  } catch (err) {
    const msg = humanError(err.message);
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: msg }) };
  }

  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({ content: [{ text: result }] }),
  };
};

// ── CLAUDE HAIKU — Proposals & Contracts ──
async function callClaude(system, user, max_tokens, apiKey) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 55000);
  try {
    const res = await fetch(ANTHROPIC_API, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: max_tokens || 4000,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    });
    clearTimeout(timer);
    const data = await res.json();
    if (!res.ok || data.type === 'error') {
      throw new Error(data?.error?.message || 'Claude API error ' + res.status);
    }
    return data.content?.[0]?.text || '';
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

// ── GROQ LLAMA — Follow-up Emails (free tier) ──
async function callGroq(system, user, max_tokens, apiKey) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(GROQ_API, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: max_tokens || 2000,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
    clearTimeout(timer);
    const data = await res.json();
    if (!res.ok || data.error) {
      throw new Error(data?.error?.message || 'Groq API error ' + res.status);
    }
    return data.choices?.[0]?.message?.content || '';
  } catch (err) {
    clearTimeout(timer);
    // Groq failed — fall back to Claude if key exists
    if (process.env.ANTHROPIC_API_KEY) {
      return callClaude(system, user, max_tokens, process.env.ANTHROPIC_API_KEY);
    }
    throw err;
  }
}

// ── GEMINI FLASH — Hindi content ──
async function callGemini(system, user, max_tokens, apiKey) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 40000);
  try {
    const res = await fetch(`${GEMINI_API}?key=${apiKey}`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${system}\n\n${user}` }] }],
        generationConfig: { maxOutputTokens: max_tokens || 4000 },
      }),
    });
    clearTimeout(timer);
    const data = await res.json();
    if (!res.ok || data.error) {
      throw new Error(data?.error?.message || 'Gemini API error ' + res.status);
    }
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  } catch (err) {
    clearTimeout(timer);
    // Gemini failed — fall back to Claude
    if (process.env.ANTHROPIC_API_KEY) {
      return callClaude(system, user, max_tokens, process.env.ANTHROPIC_API_KEY);
    }
    throw err;
  }
}

// ── HUMAN READABLE ERRORS ──
function humanError(msg = '') {
  if (msg.includes('credit') || msg.includes('balance'))
    return 'Service temporarily unavailable. Please try again later.';
  if (msg.includes('invalid_api_key') || msg.includes('auth') || msg.includes('Unauthorized'))
    return 'Server configuration error. Please contact hello@mitti.in';
  if (msg.includes('rate') || msg.includes('limit') || msg.includes('429'))
    return 'Too many requests right now. Please wait a few seconds and try again.';
  if (msg.includes('abort') || msg.includes('timed out'))
    return 'Generation timed out. Please try again — it usually works on the second attempt.';
  if (msg.includes('not_found') || msg.includes('model'))
    return 'Server configuration error. Please contact hello@mitti.in';
  return 'Something went wrong. Please try again.';
}
