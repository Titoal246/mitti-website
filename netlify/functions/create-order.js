// ── RAZORPAY ORDER CREATION ──
// Creates a Razorpay order for plan upgrades

const ALLOWED_ORIGINS = [
  'https://mitti.in',
  'https://www.mitti.in',
  'https://mitti-website.netlify.app',
];

const PLANS = {
  pro:    { amount: 29900, name: 'Mitti Pro — Monthly' },    // ₹299 in paise
  agency: { amount: 79900, name: 'Mitti Agency — Monthly' }, // ₹799
};

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

  const keyId  = process.env.RAZORPAY_KEY_ID;
  const secret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !secret) {
    return { statusCode: 503, headers: cors, body: JSON.stringify({ error: 'Payments not configured yet. Contact hello@mitti.in' }) };
  }

  let body;
  try { body = JSON.parse(event.body); } catch {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { plan, fingerprint, email } = body;
  if (!PLANS[plan]) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Invalid plan' }) };
  if (!fingerprint || typeof fingerprint !== 'string' || fingerprint.length > 64) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Invalid request' }) };
  }

  const planInfo = PLANS[plan];
  const receipt = `mitti_${plan}_${Date.now()}`;

  try {
    const auth = Buffer.from(`${keyId}:${secret}`).toString('base64');
    const res = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${auth}`,
      },
      body: JSON.stringify({
        amount: planInfo.amount,
        currency: 'INR',
        receipt,
        notes: { fingerprint, email: email || '', plan },
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.description || 'Razorpay error');

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({
        orderId: data.id,
        amount: data.amount,
        currency: data.currency,
        keyId,
        planName: planInfo.name,
      }),
    };
  } catch (err) {
    console.error('Order error:', err.message);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'Could not create order. Please try again.' }) };
  }
};
