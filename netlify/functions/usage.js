// ── MITTI USAGE TRACKER ──
// Checks and increments doc usage per user via Supabase
// Free plan: 3 docs/month. Pro: unlimited.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

const FREE_LIMIT = 3;

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

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    // Supabase not configured — allow unlimited (dev mode)
    return { statusCode: 200, headers: cors, body: JSON.stringify({ allowed: true, remaining: 99, plan: 'free' }) };
  }

  let body;
  try { body = JSON.parse(event.body); } catch {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { fingerprint, action } = body;
  if (!fingerprint || typeof fingerprint !== 'string' || fingerprint.length > 64) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Invalid request' }) };
  }

  const monthKey = new Date().toISOString().slice(0, 7); // "2026-05"

  try {
    // Fetch or create user record
    const getRes = await sbFetch(`/rest/v1/usage?fingerprint=eq.${encodeURIComponent(fingerprint)}&month_key=eq.${monthKey}&select=*`);
    const rows = await getRes.json();

    if (!getRes.ok) throw new Error('Supabase fetch error');

    let row = rows[0];

    if (!row) {
      // Create new record
      const createRes = await sbFetch('/rest/v1/usage', 'POST', {
        fingerprint,
        month_key: monthKey,
        plan: 'free',
        docs_used: 0,
      });
      if (!createRes.ok) throw new Error('Failed to create usage record');
      const created = await createRes.json();
      row = Array.isArray(created) ? created[0] : created;
    }

    const plan = row.plan || 'free';
    const used = row.docs_used || 0;
    const limit = plan === 'pro' || plan === 'agency' ? Infinity : FREE_LIMIT;
    const allowed = used < limit;
    const remaining = plan === 'pro' || plan === 'agency' ? 999 : Math.max(0, FREE_LIMIT - used);

    if (action === 'check') {
      return { statusCode: 200, headers: cors, body: JSON.stringify({ allowed, remaining, plan, used }) };
    }

    if (action === 'increment') {
      if (!allowed) {
        return { statusCode: 200, headers: cors, body: JSON.stringify({ allowed: false, remaining: 0, plan, used }) };
      }
      // Increment
      await sbFetch(
        `/rest/v1/usage?fingerprint=eq.${encodeURIComponent(fingerprint)}&month_key=eq.${monthKey}`,
        'PATCH',
        { docs_used: used + 1 }
      );
      return { statusCode: 200, headers: cors, body: JSON.stringify({ allowed: true, remaining: Math.max(0, remaining - 1), plan, used: used + 1 }) };
    }

    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Unknown action' }) };

  } catch (err) {
    console.error('Usage error:', err.message);
    // On error, allow — never block users due to infra issues
    return { statusCode: 200, headers: cors, body: JSON.stringify({ allowed: true, remaining: 99, plan: 'free', error: 'fallback' }) };
  }
};

function sbFetch(path, method = 'GET', body) {
  return fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': method === 'POST' ? 'return=representation' : '',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}
