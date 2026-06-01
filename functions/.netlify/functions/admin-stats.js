// ── MITTI ADMIN STATS (Cloudflare Pages Function) ──
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': 'https://mitti.in',
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Password',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  };
}

export async function onRequestOptions() {
  return new Response(null, { status: 200, headers: corsHeaders() });
}

export async function onRequestPost({ request, env }) {
  const cors = corsHeaders();

  const pw = request.headers.get('x-admin-password') || '';
  if (!env.ADMIN_PASSWORD || pw !== env.ADMIN_PASSWORD) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: cors });
  }

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    return new Response(JSON.stringify({ users: 0, waitlist: 0, pro_users: 0, agency_users: 0, docs_this_month: 0, revenue_est: 0 }), { status: 200, headers: cors });
  }

  const monthKey = new Date().toISOString().slice(0, 7);

  try {
    const [usageRes, waitlistRes, contactsRes, referralsRes] = await Promise.all([
      sbFetch(env, `/rest/v1/usage?month_key=eq.${monthKey}&select=fingerprint,plan,docs_used,email,payment_id,created_at`),
      sbFetch(env, '/rest/v1/waitlist?select=email,source,signed_up_at&order=signed_up_at.desc&limit=50'),
      sbFetch(env, '/rest/v1/contacts?select=name,email,message,created_at&order=created_at.desc&limit=20'),
      sbFetch(env, '/rest/v1/referrals?select=code,uses,fingerprint,created_at&order=uses.desc&limit=20'),
    ]);

    const usage     = await usageRes.json();
    const waitlist  = await waitlistRes.json();
    const contacts  = await contactsRes.json();
    const referrals = await referralsRes.json();

    const pro = usage.filter(u => u.plan === 'pro');
    const agency = usage.filter(u => u.plan === 'agency');
    const totalDocs = usage.reduce((sum, u) => sum + (u.docs_used || 0), 0);
    const totalReferralUses = Array.isArray(referrals) ? referrals.reduce((s, r) => s + (r.uses || 0), 0) : 0;
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const newThisWeek = Array.isArray(usage) ? usage.filter(u => u.created_at > sevenDaysAgo).length : 0;

    return new Response(JSON.stringify({
      month: monthKey,
      users: usage.length,
      new_this_week: newThisWeek,
      docs_this_month: totalDocs,
      avg_docs_per_user: usage.length ? (totalDocs / usage.length).toFixed(1) : 0,
      pro_users: pro.length,
      agency_users: agency.length,
      revenue_est: (pro.length * 299) + (agency.length * 799),
      waitlist_count: Array.isArray(waitlist) ? waitlist.length : 0,
      contacts_count: Array.isArray(contacts) ? contacts.length : 0,
      referrals_count: Array.isArray(referrals) ? referrals.length : 0,
      referral_uses_total: totalReferralUses,
      recent_waitlist: Array.isArray(waitlist) ? waitlist.slice(0, 10) : [],
      recent_contacts: Array.isArray(contacts) ? contacts.slice(0, 5) : [],
      top_referrals: Array.isArray(referrals) ? referrals.slice(0, 5) : [],
      paid_users: usage.filter(u => u.payment_id).map(u => ({ plan: u.plan, email: u.email, payment: u.payment_id })),
    }), { status: 200, headers: cors });
  } catch (err) {
    console.error('Admin stats error:', err.message);
    return new Response(JSON.stringify({ error: 'Stats unavailable' }), { status: 500, headers: cors });
  }
}

function sbFetch(env, path) {
  return fetch(`${env.SUPABASE_URL}${path}`, {
    headers: { 'apikey': env.SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' },
  });
}
