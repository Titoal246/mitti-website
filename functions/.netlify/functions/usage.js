// ── MITTI USAGE TRACKER (Cloudflare Pages Function) ──
const FREE_LIMIT = 3;
const ALLOWED_ORIGINS = [
  'https://mitti.in', 'https://www.mitti.in',
  'https://mitti-website.netlify.app', 'https://mitti-website.pages.dev',
];

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

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    return new Response(JSON.stringify({ allowed: true, remaining: 99, plan: 'free' }), { status: 200, headers: cors });
  }

  let body;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: cors });
  }

  const { fingerprint, action } = body;
  if (!fingerprint || typeof fingerprint !== 'string' || fingerprint.length > 64) {
    return new Response(JSON.stringify({ error: 'Invalid request' }), { status: 400, headers: cors });
  }

  const monthKey = new Date().toISOString().slice(0, 7);

  try {
    const getRes = await sbFetch(env, `/rest/v1/usage?fingerprint=eq.${encodeURIComponent(fingerprint)}&month_key=eq.${monthKey}&select=*`);
    const rows = await getRes.json();
    if (!getRes.ok) throw new Error('Supabase fetch error');

    let row = rows[0];
    if (!row) {
      const createRes = await sbFetch(env, '/rest/v1/usage', 'POST', { fingerprint, month_key: monthKey, plan: 'free', docs_used: 0 });
      if (!createRes.ok) throw new Error('Failed to create usage record');
      const created = await createRes.json();
      row = Array.isArray(created) ? created[0] : created;
    }

    const plan = row.plan || 'free';
    const used = row.docs_used || 0;
    const bonus = row.bonus_docs || 0;
    const effectiveLimit = plan === 'pro' || plan === 'agency' ? Infinity : FREE_LIMIT + bonus;
    const allowed = used < effectiveLimit;
    const remaining = plan === 'pro' || plan === 'agency' ? 999 : Math.max(0, effectiveLimit - used);

    if (action === 'check') {
      return new Response(JSON.stringify({ allowed, remaining, plan, used }), { status: 200, headers: cors });
    }

    if (action === 'increment') {
      if (!allowed) {
        return new Response(JSON.stringify({ allowed: false, remaining: 0, plan, used }), { status: 200, headers: cors });
      }
      const rpcRes = await sbFetch(env, '/rest/v1/rpc/increment_doc_usage', 'POST', { fp: fingerprint, mk: monthKey });
      if (!rpcRes.ok) {
        await sbFetch(env, `/rest/v1/usage?fingerprint=eq.${encodeURIComponent(fingerprint)}&month_key=eq.${monthKey}`, 'PATCH', { docs_used: used + 1 });
        return new Response(JSON.stringify({ allowed: true, remaining: Math.max(0, remaining - 1), plan, used: used + 1 }), { status: 200, headers: cors });
      }
      const rpcData = await rpcRes.json();
      return new Response(JSON.stringify(rpcData), { status: 200, headers: cors });
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400, headers: cors });
  } catch (err) {
    console.error('Usage error:', err.message);
    return new Response(JSON.stringify({ allowed: true, remaining: 99, plan: 'free', error: 'fallback' }), { status: 200, headers: cors });
  }
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
