// ── WAITLIST EMAIL CAPTURE ──
// Saves email to Supabase waitlist table
// Falls back gracefully if Supabase not configured

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

  const { email, source } = body;
  if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Invalid email' }) };
  }

  const safeEmail = email.slice(0, 254).toLowerCase().trim();
  const safeSource = (source || 'homepage').slice(0, 50);

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.log('Waitlist signup (no DB):', safeEmail);
    return { statusCode: 200, headers: cors, body: JSON.stringify({ success: true }) };
  }

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/waitlist`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=ignore-duplicates',
      },
      body: JSON.stringify({ email: safeEmail, source: safeSource, signed_up_at: new Date().toISOString() }),
    });

    if (!res.ok && res.status !== 409) {
      const err = await res.text();
      console.error('Supabase waitlist error:', err);
    }

    return { statusCode: 200, headers: cors, body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error('Waitlist error:', err.message);
    return { statusCode: 200, headers: cors, body: JSON.stringify({ success: true }) };
  }
};
