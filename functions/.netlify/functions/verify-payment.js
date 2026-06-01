// ── RAZORPAY PAYMENT VERIFICATION (Cloudflare Pages Function) ──
// Uses Web Crypto API (no Node.js crypto module)
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

  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, fingerprint, plan, email } = body;
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !fingerprint) {
    return new Response(JSON.stringify({ error: 'Missing payment fields' }), { status: 400, headers: cors });
  }

  const secret = env.RAZORPAY_KEY_SECRET;
  if (!secret) return new Response(JSON.stringify({ error: 'Server misconfigured' }), { status: 503, headers: cors });

  // Verify HMAC-SHA256 using Web Crypto API
  const sigValid = await verifyHmac(secret, `${razorpay_order_id}|${razorpay_payment_id}`, razorpay_signature);
  if (!sigValid) {
    return new Response(JSON.stringify({ error: 'Payment verification failed' }), { status: 400, headers: cors });
  }

  // Notify owner (fire-and-forget)
  const planLabel = plan === 'agency' ? 'Agency ₹799' : 'Pro ₹299';
  notifyOwner(env, planLabel, email || 'anonymous', razorpay_payment_id).catch(() => {});

  // Upgrade plan in Supabase
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY) {
    try {
      const monthKey = new Date().toISOString().slice(0, 7);
      await sbUpsert(env, '/rest/v1/usage', { fingerprint, month_key: monthKey, plan: plan || 'pro', docs_used: 0, bonus_docs: 0, email: email || null, payment_id: razorpay_payment_id });
    } catch (err) { console.error('Supabase upgrade error:', err.message); }
  }

  return new Response(JSON.stringify({ success: true, plan: plan || 'pro' }), { status: 200, headers: cors });
}

async function verifyHmac(secret, message, signature) {
  try {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const sigBytes = hexToBytes(signature);
    return crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(message));
  } catch { return false; }
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  return bytes;
}

async function notifyOwner(env, plan, customerEmail, paymentId) {
  if (!env.RESEND_API_KEY) return;
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Mitti Payments <payments@mitti.in>',
      to: ['hello@mitti.in'],
      subject: `💰 New ${plan} subscription — Mitti`,
      html: `<h2>New payment received!</h2><p><strong>Plan:</strong> ${plan}</p><p><strong>Customer email:</strong> ${customerEmail}</p><p><strong>Payment ID:</strong> ${paymentId}</p><p><strong>Time:</strong> ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST</p><hr><p style="color:#888">Mitti · mitti.in</p>`,
    }),
  });
}

function sbUpsert(env, path, body) {
  return fetch(`${env.SUPABASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'apikey': env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates',
    },
    body: JSON.stringify(body),
  });
}
