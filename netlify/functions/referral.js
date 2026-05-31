// ── MITTI REFERRAL TRACKING ──
// Track referral links to reward both referrer and referee with bonus docs
// GET /?ref=CODE → returns referral stats
// POST { action: 'create', fingerprint } → creates referral code
// POST { action: 'claim', ref_code, fingerprint } → claims referral bonus

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
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    // No DB — return mock data so UI works
    return { statusCode: 200, headers: cors, body: JSON.stringify({ code: 'DEMO123', uses: 0, bonus: 0 }) };
  }

  if (event.httpMethod === 'GET') {
    const code = event.queryStringParameters?.ref;
    if (!code) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Missing ref code' }) };
    try {
      const res = await sbFetch(`/rest/v1/referrals?code=eq.${encodeURIComponent(code)}&select=*`);
      const rows = await res.json();
      if (!rows[0]) return { statusCode: 404, headers: cors, body: JSON.stringify({ error: 'Invalid referral code' }) };
      return { statusCode: 200, headers: cors, body: JSON.stringify({ code: rows[0].code, uses: rows[0].uses || 0 }) };
    } catch { return { statusCode: 200, headers: cors, body: JSON.stringify({ code, uses: 0 }) }; }
  }

  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'Method not allowed' }) };

  let body;
  try { body = JSON.parse(event.body); } catch {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { action, fingerprint, ref_code } = body;
  if (!fingerprint || typeof fingerprint !== 'string' || fingerprint.length > 64) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Invalid request' }) };
  }

  if (action === 'create') {
    // Create or get existing referral code for this fingerprint
    try {
      const existing = await sbFetch(`/rest/v1/referrals?fingerprint=eq.${encodeURIComponent(fingerprint)}&select=code`);
      const rows = await existing.json();
      if (rows[0]) return { statusCode: 200, headers: cors, body: JSON.stringify({ code: rows[0].code }) };

      // Generate unique code: first 4 chars of fingerprint + 4 random chars
      const code = (fingerprint.replace(/[^a-z0-9]/gi, '').slice(2, 6) + Math.random().toString(36).slice(2, 6)).toUpperCase();
      await sbFetch('/rest/v1/referrals', 'POST', { fingerprint, code, uses: 0, created_at: new Date().toISOString() });
      return { statusCode: 200, headers: cors, body: JSON.stringify({ code }) };
    } catch (err) {
      return { statusCode: 200, headers: cors, body: JSON.stringify({ code: null, error: 'Could not create code' }) };
    }
  }

  if (action === 'claim') {
    if (!ref_code || typeof ref_code !== 'string' || ref_code.length > 20) {
      return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Invalid code' }) };
    }
    try {
      // Check referral code is valid and doesn't belong to claimant
      const refRes = await sbFetch(`/rest/v1/referrals?code=eq.${encodeURIComponent(ref_code.toUpperCase())}&select=*`);
      const refRows = await refRes.json();
      if (!refRows[0]) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Invalid referral code' }) };
      if (refRows[0].fingerprint === fingerprint) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Cannot use your own referral code' }) };

      // Check not already claimed by this fingerprint
      const claimCheck = await sbFetch(`/rest/v1/referral_claims?fingerprint=eq.${encodeURIComponent(fingerprint)}&ref_code=eq.${encodeURIComponent(ref_code.toUpperCase())}&select=id`);
      const claims = await claimCheck.json();
      if (claims[0]) return { statusCode: 200, headers: cors, body: JSON.stringify({ already_claimed: true, bonus: 1 }) };

      const monthKey = new Date().toISOString().slice(0, 7);

      // Record claim
      await sbFetch('/rest/v1/referral_claims', 'POST', {
        fingerprint, ref_code: ref_code.toUpperCase(), claimed_at: new Date().toISOString()
      });

      // Give referee +1 doc bonus (patch usage)
      await sbFetch(
        `/rest/v1/usage?fingerprint=eq.${encodeURIComponent(fingerprint)}&month_key=eq.${monthKey}`,
        'PATCH', { bonus_docs: 1 }
      );

      // Increment referrer uses count
      await sbFetch(
        `/rest/v1/referrals?code=eq.${encodeURIComponent(ref_code.toUpperCase())}`,
        'PATCH', { uses: (refRows[0].uses || 0) + 1 }
      );

      return { statusCode: 200, headers: cors, body: JSON.stringify({ success: true, bonus: 1 }) };
    } catch (err) {
      console.error('Referral claim error:', err.message);
      return { statusCode: 200, headers: cors, body: JSON.stringify({ success: true, bonus: 1 }) };
    }
  }

  return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Unknown action' }) };
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
