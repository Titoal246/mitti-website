// ── CONTACT FORM (Cloudflare Pages Function) ──
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

  let body;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: cors });
  }

  const { name, email, message } = body;
  if (!email || !message || typeof email !== 'string' || typeof message !== 'string') {
    return new Response(JSON.stringify({ error: 'Missing fields' }), { status: 400, headers: cors });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return new Response(JSON.stringify({ error: 'Invalid email' }), { status: 400, headers: cors });
  }

  const payload = {
    name: (name || '').slice(0, 100).trim(),
    email: email.slice(0, 254).toLowerCase().trim(),
    message: message.slice(0, 2000).trim(),
    created_at: new Date().toISOString(),
  };

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    console.log('Contact (no DB):', payload.email);
    return new Response(JSON.stringify({ success: true }), { status: 200, headers: cors });
  }

  try {
    await fetch(`${env.SUPABASE_URL}/rest/v1/contacts`, {
      method: 'POST',
      headers: {
        'apikey': env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    return new Response(JSON.stringify({ success: true }), { status: 200, headers: cors });
  } catch (err) {
    console.error('Contact error:', err.message);
    return new Response(JSON.stringify({ success: true }), { status: 200, headers: cors });
  }
}
