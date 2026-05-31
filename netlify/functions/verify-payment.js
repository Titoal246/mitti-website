// ── RAZORPAY PAYMENT VERIFICATION ──
// Verifies signature, then upgrades user plan in Supabase

const crypto = require('crypto');

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

  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, fingerprint, plan, email } = body;

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !fingerprint) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Missing payment fields' }) };
  }

  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret) return { statusCode: 503, headers: cors, body: JSON.stringify({ error: 'Server misconfigured' }) };

  // Verify HMAC signature
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');

  const sigValid = (() => {
    try {
      return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(razorpay_signature, 'hex'));
    } catch { return false; }
  })();
  if (!sigValid) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Payment verification failed' }) };
  }

  // Send email notification (fire-and-forget)
  const planLabel = plan === 'agency' ? 'Agency ₹799' : 'Pro ₹299';
  notifyOwner(planLabel, email || 'anonymous', razorpay_payment_id).catch(() => {});

  // Upgrade plan in Supabase
  if (SUPABASE_URL && SUPABASE_KEY) {
    try {
      const monthKey = new Date().toISOString().slice(0, 7);
      await sbFetch(
        `/rest/v1/usage?fingerprint=eq.${encodeURIComponent(fingerprint)}&month_key=eq.${monthKey}`,
        'PATCH',
        { plan: plan || 'pro', email: email || null, payment_id: razorpay_payment_id }
      );
    } catch (err) {
      console.error('Supabase upgrade error:', err.message);
      // Payment verified — don't fail; handle manually if DB update fails
    }
  }

  return {
    statusCode: 200,
    headers: cors,
    body: JSON.stringify({ success: true, plan: plan || 'pro' }),
  };
};

async function notifyOwner(plan, customerEmail, paymentId) {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return;
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Mitti Payments <payments@mitti.in>',
      to: ['hello@mitti.in'],
      subject: `💰 New ${plan} subscription — Mitti`,
      html: `<h2>New payment received!</h2>
<p><strong>Plan:</strong> ${plan}</p>
<p><strong>Customer email:</strong> ${customerEmail}</p>
<p><strong>Payment ID:</strong> ${paymentId}</p>
<p><strong>Time:</strong> ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST</p>
<hr>
<p style="color:#888">Mitti · mitti.in</p>`,
    }),
  });
}

function sbFetch(path, method = 'GET', body) {
  return fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}
