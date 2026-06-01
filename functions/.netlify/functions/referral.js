// ── MITTI REFERRAL TRACKING (Cloudflare Pages Function) ──
const ALLOWED_ORIGINS = [
  'https://mitti.in', 'https://www.mitti.in',
  'https://mitti-website.netlify.app', 'https://mitti-website.pages.dev',
];

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  };
}

export async function onRequestOptions({ request }) {
  return new Response(null, { status: 200, headers: corsHeaders(request.headers.get('origin') || '') });
}

export async function onRequestGet({ request, env }) {
  const origin = request.headers.get('origin') || '';
  const cors = corsHeaders(origin);

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    return new Response(JSON.stringify({ code: 'DEMO123', uses: 0 }), { status: 200, headers: cors });
  }

  const url = new URL(request.url);
  const code = url.searchParams.get('ref');
  if (!code) return new Response(JSON.stringify({ error: 'Missing ref code' }), { status: 400, headers: cors });

  try {
    const res = await sbFetch(env, `/rest/v1/referrals?code=eq.${encodeURIComponent(code)}&select=*`);
    const rows = await res.json();
    if (!rows[0]) return new Response(JSON.stringify({ error: 'Invalid referral code' }), { status: 404, headers: cors });
    return new Response(JSON.stringify({ code: rows[0].code, uses: rows[0].uses || 0 }), { status: 200, headers: cors });
  } catch {
    return new Response(JSON.stringify({ code, uses: 0 }), { status: 200, headers: cors });
  }
}

export async function onRequestPost({ request, env }) {
  const origin = request.headers.get('origin') || '';
  const cors = corsHeaders(origin);

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    return new Response(JSON.stringify({ code: 'DEMO123', uses: 0, bonus: 0 }), { status: 200, headers: cors });
  }

  let body;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: cors });
  }

  const { action, fingerprint, ref_code } = body;
  if (!fingerprint || typeof fingerprint !== 'string' || fingerprint.length > 64) {
    return new Response(JSON.stringify({ error: 'Invalid request' }), { status: 400, headers: cors });
  }

  if (action === 'create') {
    try {
      const existing = await sbFetch(env, `/rest/v1/referrals?fingerprint=eq.${encodeURIComponent(fingerprint)}&select=code`);
      const rows = await existing.json();
      if (rows[0]) return new Response(JSON.stringify({ code: rows[0].code }), { status: 200, headers: cors });

      const code = (fingerprint.replace(/[^a-z0-9]/gi, '').slice(2, 6) + Math.random().toString(36).slice(2, 6)).toUpperCase();
      await sbFetch(env, '/rest/v1/referrals', 'POST', { fingerprint, code, uses: 0, created_at: new Date().toISOString() });
      return new Response(JSON.stringify({ code }), { status: 200, headers: cors });
    } catch {
      return new Response(JSON.stringify({ code: null, error: 'Could not create code' }), { status: 200, headers: cors });
    }
  }

  if (action === 'claim') {
    if (!ref_code || typeof ref_code !== 'string' || ref_code.length > 20) {
      return new Response(JSON.stringify({ error: 'Invalid code' }), { status: 400, headers: cors });
    }
    try {
      const refRes = await sbFetch(env, `/rest/v1/referrals?code=eq.${encodeURIComponent(ref_code.toUpperCase())}&select=*`);
      const refRows = await refRes.json();
      if (!refRows[0]) return new Response(JSON.stringify({ error: 'Invalid referral code' }), { status: 400, headers: cors });
      if (refRows[0].fingerprint === fingerprint) return new Response(JSON.stringify({ error: 'Cannot use your own referral code' }), { status: 400, headers: cors });

      const claimCheck = await sbFetch(env, `/rest/v1/referral_claims?fingerprint=eq.${encodeURIComponent(fingerprint)}&ref_code=eq.${encodeURIComponent(ref_code.toUpperCase())}&select=id`);
      const claims = await claimCheck.json();
      if (claims[0]) return new Response(JSON.stringify({ already_claimed: true, bonus: 1 }), { status: 200, headers: cors });

      const monthKey = new Date().toISOString().slice(0, 7);
      await sbFetch(env, '/rest/v1/referral_claims', 'POST', { fingerprint, ref_code: ref_code.toUpperCase(), claimed_at: new Date().toISOString() });
      await sbFetch(env, `/rest/v1/usage?fingerprint=eq.${encodeURIComponent(fingerprint)}&month_key=eq.${monthKey}`, 'PATCH', { bonus_docs: 1 });
      await sbFetch(env, `/rest/v1/referrals?code=eq.${encodeURIComponent(ref_code.toUpperCase())}`, 'PATCH', { uses: (refRows[0].uses || 0) + 1 });

      return new Response(JSON.stringify({ success: true, bonus: 1 }), { status: 200, headers: cors });
    } catch (err) {
      console.error('Referral claim error:', err.message);
      return new Response(JSON.stringify({ success: true, bonus: 1 }), { status: 200, headers: cors });
    }
  }

  return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400, headers: cors });
}

function sbFetch(env, path, method = 'GET', body) {
  return fetch(`${env.SUPABASE_URL}${path}`, {
    method,
    headers: {
      'apikey': env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': method === 'POST' ? 'return=representation' : '',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}
