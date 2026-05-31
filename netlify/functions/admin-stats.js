// ── MITTI ADMIN STATS ──
// Password-protected endpoint that returns usage, waitlist, and revenue stats
// Set ADMIN_PASSWORD in Netlify environment variables

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

exports.handler = async function (event) {
  const cors = {
    'Access-Control-Allow-Origin': 'https://mitti.in',
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Password',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'Method not allowed' }) };

  // Auth check
  const pw = event.headers?.['x-admin-password'] || '';
  if (!ADMIN_PASSWORD || pw !== ADMIN_PASSWORD) {
    return { statusCode: 401, headers: cors, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return { statusCode: 200, headers: cors, body: JSON.stringify({
      users: 0, waitlist: 0, pro_users: 0, agency_users: 0,
      docs_this_month: 0, revenue_est: 0, contacts: 0
    }) };
  }

  const monthKey = new Date().toISOString().slice(0, 7);

  try {
    const [usageRes, waitlistRes, contactsRes] = await Promise.all([
      sbFetch(`/rest/v1/usage?month_key=eq.${monthKey}&select=fingerprint,plan,docs_used,email,payment_id`),
      sbFetch('/rest/v1/waitlist?select=email,source,signed_up_at&order=signed_up_at.desc&limit=50'),
      sbFetch('/rest/v1/contacts?select=name,email,message,created_at&order=created_at.desc&limit=20'),
    ]);

    const usage = await usageRes.json();
    const waitlist = await waitlistRes.json();
    const contacts = await contactsRes.json();

    const pro = usage.filter(u => u.plan === 'pro');
    const agency = usage.filter(u => u.plan === 'agency');
    const totalDocs = usage.reduce((sum, u) => sum + (u.docs_used || 0), 0);
    const revenueEst = (pro.length * 299) + (agency.length * 799);

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({
        month: monthKey,
        users: usage.length,
        docs_this_month: totalDocs,
        pro_users: pro.length,
        agency_users: agency.length,
        revenue_est: revenueEst,
        waitlist_count: Array.isArray(waitlist) ? waitlist.length : 0,
        contacts_count: Array.isArray(contacts) ? contacts.length : 0,
        recent_waitlist: Array.isArray(waitlist) ? waitlist.slice(0, 10) : [],
        recent_contacts: Array.isArray(contacts) ? contacts.slice(0, 5) : [],
        paid_users: usage.filter(u => u.payment_id).map(u => ({
          plan: u.plan, email: u.email, payment: u.payment_id
        })),
      }),
    };
  } catch (err) {
    console.error('Admin stats error:', err.message);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'Stats unavailable' }) };
  }
};

function sbFetch(path) {
  return fetch(`${SUPABASE_URL}${path}`, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
  });
}
