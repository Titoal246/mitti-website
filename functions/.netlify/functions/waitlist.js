// ── WAITLIST EMAIL CAPTURE (Cloudflare Pages Function) ──
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

  const { email, source } = body;
  if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return new Response(JSON.stringify({ error: 'Invalid email' }), { status: 400, headers: cors });
  }

  const safeEmail  = email.slice(0, 254).toLowerCase().trim();
  const safeSource = (source || 'homepage').slice(0, 50);

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    console.log('Waitlist signup (no DB):', safeEmail);
    return new Response(JSON.stringify({ success: true }), { status: 200, headers: cors });
  }

  try {
    await fetch(`${env.SUPABASE_URL}/rest/v1/waitlist`, {
      method: 'POST',
      headers: {
        'apikey': env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=ignore-duplicates',
      },
      body: JSON.stringify({ email: safeEmail, source: safeSource, signed_up_at: new Date().toISOString() }),
    });
    return new Response(JSON.stringify({ success: true }), { status: 200, headers: cors });
  } catch (err) {
    console.error('Waitlist error:', err.message);
    return new Response(JSON.stringify({ success: true }), { status: 200, headers: cors });
  }
}
