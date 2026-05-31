// ── CONTACT FORM ──
// Saves contact messages to Supabase

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

const ALLOWED_ORIGINS = [
  'https://mitti.in',
  'https://www.mitti.in',
  'https://mitti-website.netlify.app',
];

exports.handler = async function (event) {
  const origin = event.headers?.origin || '';
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

  const cors = {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'Method not allowed' }) };

  let body;
  try { body = JSON.parse(event.body); } catch {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { name, email, message } = body;
  if (!email || !message || typeof email !== 'string' || typeof message !== 'string') {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Missing fields' }) };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Invalid email' }) };
  }

  const payload = {
    name: (name || '').slice(0, 100).trim(),
    email: email.slice(0, 254).toLowerCase().trim(),
    message: message.slice(0, 2000).trim(),
    created_at: new Date().toISOString(),
  };

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.log('Contact (no DB):', payload.email, payload.message.slice(0, 80));
    return { statusCode: 200, headers: cors, body: JSON.stringify({ success: true }) };
  }

  try {
    await fetch(`${SUPABASE_URL}/rest/v1/contacts`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    return { statusCode: 200, headers: cors, body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error('Contact error:', err.message);
    return { statusCode: 200, headers: cors, body: JSON.stringify({ success: true }) };
  }
};
