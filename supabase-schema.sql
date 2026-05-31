-- ══════════════════════════════════════════════════════════════
-- MITTI SUPABASE SCHEMA
-- Run this in Supabase SQL Editor to set up all required tables
-- Dashboard → SQL Editor → New query → paste → Run
-- ══════════════════════════════════════════════════════════════

-- 1. USAGE TRACKING (core — required for free tier limits + payments)
create table if not exists usage (
  id          uuid primary key default gen_random_uuid(),
  fingerprint text not null,
  month_key   text not null,          -- format: "2026-05"
  plan        text not null default 'free', -- free | pro | agency
  docs_used   int  not null default 0,
  bonus_docs  int  not null default 0, -- from referrals
  email       text,                   -- set when user pays
  payment_id  text,                   -- Razorpay payment ID
  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),
  unique(fingerprint, month_key)
);

-- Auto-update updated_at
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
create trigger usage_updated_at before update on usage
  for each row execute function update_updated_at();

-- 2. WAITLIST
create table if not exists waitlist (
  id           uuid primary key default gen_random_uuid(),
  email        text not null unique,
  source       text default 'homepage',
  signed_up_at timestamptz default now()
);

-- 3. CONTACTS
create table if not exists contacts (
  id         uuid primary key default gen_random_uuid(),
  name       text,
  email      text not null,
  message    text not null,
  created_at timestamptz default now()
);

-- 4. REFERRALS
create table if not exists referrals (
  id          uuid primary key default gen_random_uuid(),
  fingerprint text not null unique,
  code        text not null unique,
  uses        int  not null default 0,
  created_at  timestamptz default now()
);

-- 5. REFERRAL CLAIMS (prevent double-claiming)
create table if not exists referral_claims (
  id          uuid primary key default gen_random_uuid(),
  fingerprint text not null,
  ref_code    text not null,
  claimed_at  timestamptz default now(),
  unique(fingerprint, ref_code)
);

-- ── ROW LEVEL SECURITY ──
-- Enable RLS so Supabase service key bypasses it, anon cannot read
alter table usage          enable row level security;
alter table waitlist       enable row level security;
alter table contacts       enable row level security;
alter table referrals      enable row level security;
alter table referral_claims enable row level security;

-- Service role (used by Netlify functions) bypasses RLS automatically.
-- No additional policies needed — service key has full access.

-- ── INDEXES ──
create index if not exists idx_usage_fingerprint_month on usage(fingerprint, month_key);
create index if not exists idx_referrals_code on referrals(code);
create index if not exists idx_referral_claims_fp on referral_claims(fingerprint);

-- ── ATOMIC INCREMENT RPC (prevents race condition) ──
-- Returns: { allowed, used, remaining, plan }
create or replace function increment_doc_usage(fp text, mk text)
returns jsonb language plpgsql security definer as $$
declare
  rec usage%rowtype;
  eff_limit int;
  new_used  int;
begin
  -- Upsert to ensure row exists
  insert into usage (fingerprint, month_key, plan, docs_used, bonus_docs)
  values (fp, mk, 'free', 0, 0)
  on conflict (fingerprint, month_key) do nothing;

  -- Lock row for atomic update
  select * into rec from usage where fingerprint = fp and month_key = mk for update;

  eff_limit := case
    when rec.plan in ('pro', 'agency') then 2147483647
    else 3 + coalesce(rec.bonus_docs, 0)
  end;

  if rec.docs_used >= eff_limit then
    return jsonb_build_object(
      'allowed', false,
      'used', rec.docs_used,
      'remaining', 0,
      'plan', rec.plan
    );
  end if;

  new_used := rec.docs_used + 1;
  update usage set docs_used = new_used where fingerprint = fp and month_key = mk;

  return jsonb_build_object(
    'allowed', true,
    'used', new_used,
    'remaining', case when rec.plan in ('pro','agency') then 999 else greatest(0, eff_limit - new_used) end,
    'plan', rec.plan
  );
end;
$$;

-- ══════════════════════════════════════════════════════════════
-- DONE. Your Mitti database is ready.
-- Add these to Netlify environment variables:
--   SUPABASE_URL      = https://YOUR_PROJECT.supabase.co
--   SUPABASE_SERVICE_KEY = your-service-role-key (Settings → API)
--   ANTHROPIC_API_KEY = your-key
--   RAZORPAY_KEY_ID   = rzp_live_...
--   RAZORPAY_KEY_SECRET = your-secret
--   RESEND_API_KEY    = re_... (optional, for payment email alerts)
--   ADMIN_PASSWORD    = choose-a-strong-password
-- ══════════════════════════════════════════════════════════════
