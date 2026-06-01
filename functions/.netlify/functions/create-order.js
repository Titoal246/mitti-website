// ── RAZORPAY ORDER CREATION (Cloudflare Pages Function) ──
const ALLOWED_ORIGINS = [
  'https://mitti.in', 'https://www.mitti.in',
  'https://mitti-website.netlify.app', 'https://mitti-website.pages.dev',
];
const PLANS = {
  pro:    { amount: 29900, name: 'Mitti Pro — Monthly' },
  agency: { amount: 79900, name: 'Mitti Agency — Monthly' },
};

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

  const keyId  = env.RAZORPAY_KEY_ID;
  const secret = env.RAZORPAY_KEY_SECRET;

  if (!keyId || !secret) {
    return new Response(JSON.stringify({ error: 'Payments not configured yet. Contact hello@mitti.in' }), { status: 503, headers: cors });
  }

  let body;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: cors });
  }

  const { plan, fingerprint, email } = body;
  if (!PLANS[plan]) return new Response(JSON.stringify({ error: 'Invalid plan' }), { status: 400, headers: cors });
  if (!fingerprint || typeof fingerprint !== 'string' || fingerprint.length > 64) {
    return new Response(JSON.stringify({ error: 'Invalid request' }), { status: 400, headers: cors });
  }

  const planInfo = PLANS[plan];
  const receipt  = `mitti_${plan}_${Date.now()}`;

  try {
    const auth = btoa(`${keyId}:${secret}`);
    const res = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Basic ${auth}` },
      body: JSON.stringify({ amount: planInfo.amount, currency: 'INR', receipt, notes: { fingerprint, email: email || '', plan } }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.description || 'Razorpay error');

    return new Response(JSON.stringify({ orderId: data.id, amount: data.amount, currency: data.currency, keyId, planName: planInfo.name }), { status: 200, headers: cors });
  } catch (err) {
    console.error('Order error:', err.message);
    return new Response(JSON.stringify({ error: 'Could not create order. Please try again.' }), { status: 500, headers: cors });
  }
}
