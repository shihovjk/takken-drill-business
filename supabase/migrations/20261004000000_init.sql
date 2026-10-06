-- Takken Drill for Business: schema and row-level security
-- The browser only reads (and writes its own answers, rules, invitations).
-- Everything that touches money or AI goes through Edge Functions with the service-role key.

-- ---------- Companies and people ----------
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- Award rules (see supabase/functions/_shared/core/award.ts AwardRules)
  rules jsonb not null default '{"currency":"JPY","examFee":8200,"passBonus":30000,"minSeriousness":60,"minMinutes":600}',
  -- Which payout module pays approved awards: paypal_payouts | payroll_csv
  payout_provider text not null default 'paypal_payouts' check (payout_provider in ('paypal_payouts', 'payroll_csv')),
  ai_enabled boolean not null default false, -- AI runs only for companies switched on (the demo company)
  created_at timestamptz not null default now()
);

create table public.company_members (
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('admin', 'employee')),
  display_name text not null,
  department text,
  exam_result text not null default 'pending' check (exam_result in ('pending', 'passed', 'failed')),
  joined_at timestamptz not null default now(),
  primary key (company_id, user_id)
);
create index on public.company_members (user_id);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  email text not null,
  role text not null default 'employee' check (role in ('admin', 'employee')),
  display_name text not null,
  department text,
  token uuid not null unique default gen_random_uuid(),
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz
);

-- Consent to share study data with the employer. Answers are not recorded without it.
create table public.consents (
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  version text not null,
  agreed_at timestamptz not null default now(),
  primary key (company_id, user_id)
);

-- Where an employee receives money. Filled by "Log in with PayPal" (verified payer ID).
create table public.payees (
  user_id uuid primary key references auth.users (id) on delete cascade,
  paypal_payer_id text,
  paypal_email text,
  verified_at timestamptz
);

-- ---------- Study log ----------
-- One row per answered question: the source of the accuracy and speed figures
create table public.attempts (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  question_id text not null,
  category text not null check (category in ('gyoho', 'kenri', 'seigen', 'zei')),
  choice smallint not null,
  correct boolean not null,
  ms integer not null check (ms >= 0),
  answered_at timestamptz not null default now()
);
create index on public.attempts (company_id, user_id, answered_at);

-- ---------- AI ----------
-- One AI judgement of one employee. Same input hash = reuse the result instead of calling the API again.
create table public.evaluations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  period_start timestamptz not null,
  period_end timestamptz not null,
  metrics jsonb not null,
  input_hash text not null,
  model text not null,
  result jsonb, -- seriousness, pass_probability, flags, proposed_award, reasons, one_liner, follow_up_message
  error text,
  created_at timestamptz not null default now(),
  unique (company_id, user_id, input_hash)
);

-- Company-wide AI report written in the same run
create table public.ai_reports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  body jsonb not null, -- { summary_ja, summary_en, follow_ups: [{ user_id, reason_ja, reason_en }] }
  model text not null,
  input_hash text not null,
  created_at timestamptz not null default now()
);

-- AI runs per company per day (the "Judge with AI" button has a daily cap)
create table public.ai_usage (
  company_id uuid not null references public.companies (id) on delete cascade,
  day date not null,
  runs integer not null default 0,
  primary key (company_id, day)
);

-- ---------- Awards and payouts ----------
-- The approval flow lives here and does not depend on how money is sent.
-- proposed (AI suggests paying) | follow_up (AI flagged, needs a human look) | self_pay (AI suggests no exam-fee support)
-- -> approved (admin confirmed an amount) -> processing -> paid | failed | exported
create table public.awards (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  cycle text not null, -- exam year, e.g. '2026'
  evaluation_id uuid references public.evaluations (id),
  ai_exam_fee integer not null default 0, -- what the AI proposed (after clamping to the rules)
  ai_pass_bonus integer not null default 0,
  -- Copy of the AI judgement the employee is allowed to see once confirmed:
  -- { seriousness, pass_probability, one_liner_ja/en, reason_ja/en, flags }
  ai jsonb,
  exam_fee integer not null default 0, -- what will be / was paid
  pass_bonus integer not null default 0,
  currency text not null default 'JPY',
  status text not null default 'proposed'
    check (status in ('proposed', 'follow_up', 'self_pay', 'approved', 'processing', 'paid', 'failed', 'exported')),
  edited_note text, -- why the admin changed the AI amount
  confirmed_by uuid references auth.users (id),
  confirmed_at timestamptz, -- employees can see their award (and the AI reasons) only after this
  provider text,
  paid_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (company_id, user_id, cycle)
);

create table public.payout_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  provider text not null,
  sender_batch_id text not null unique, -- idempotency key sent to PayPal
  provider_batch_id text,
  status text not null default 'created',
  total integer not null,
  currency text not null,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create table public.payout_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.payout_batches (id) on delete cascade,
  award_id uuid not null references public.awards (id),
  amount integer not null,
  provider_item_id text,
  status text not null default 'pending',
  error text,
  updated_at timestamptz not null default now()
);

-- ---------- PayPal ----------
-- The company's own PayPal REST app. The secret is AES-GCM encrypted with a key that only the
-- Edge Functions know (PAYPAL_CRED_KEY). Never readable from the browser.
create table public.paypal_connections (
  company_id uuid primary key references public.companies (id) on delete cascade,
  client_id text not null,
  secret_enc text not null,
  merchant_email text,
  verified_at timestamptz
);

-- The company's subscription to this app (PayPal Subscriptions)
create table public.subscriptions (
  company_id uuid primary key references public.companies (id) on delete cascade,
  paypal_subscription_id text unique,
  plan_id text,
  status text not null default 'none',
  next_billing_at timestamptz,
  updated_at timestamptz not null default now()
);

-- Webhook events already handled (PayPal can send the same event more than once)
create table public.webhook_events (
  id text primary key,
  type text not null,
  received_at timestamptz not null default now()
);

-- ---------- Access rules ----------
create function public.is_member(cid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.company_members m where m.company_id = cid and m.user_id = (select auth.uid()))
$$;
create function public.is_admin(cid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.company_members m where m.company_id = cid and m.user_id = (select auth.uid()) and m.role = 'admin')
$$;

alter table public.companies enable row level security;
alter table public.company_members enable row level security;
alter table public.invitations enable row level security;
alter table public.consents enable row level security;
alter table public.payees enable row level security;
alter table public.attempts enable row level security;
alter table public.evaluations enable row level security;
alter table public.ai_reports enable row level security;
alter table public.ai_usage enable row level security;
alter table public.awards enable row level security;
alter table public.payout_batches enable row level security;
alter table public.payout_items enable row level security;
alter table public.paypal_connections enable row level security;
alter table public.subscriptions enable row level security;
alter table public.webhook_events enable row level security;

revoke all on all tables in schema public from anon, authenticated;
grant select on public.companies, public.company_members, public.invitations, public.consents, public.payees,
  public.attempts, public.evaluations, public.ai_reports, public.awards, public.payout_batches, public.payout_items,
  public.subscriptions to authenticated;
grant update (name, rules, payout_provider) on public.companies to authenticated;
grant update (exam_result, department, display_name) on public.company_members to authenticated;
grant insert, delete on public.invitations to authenticated;
grant insert on public.consents to authenticated;
grant insert (company_id, user_id, question_id, category, choice, correct, ms, answered_at) on public.attempts to authenticated;

create policy "members read their company" on public.companies for select to authenticated using (public.is_member(id));
create policy "admins edit their company" on public.companies for update to authenticated
  using (public.is_admin(id)) with check (public.is_admin(id));

create policy "read own membership, admins read all" on public.company_members for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin(company_id));
create policy "admins edit members" on public.company_members for update to authenticated
  using (public.is_admin(company_id)) with check (public.is_admin(company_id));

create policy "admins manage invitations" on public.invitations for all to authenticated
  using (public.is_admin(company_id)) with check (public.is_admin(company_id));

create policy "read own consent, admins read all" on public.consents for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin(company_id));
create policy "give own consent" on public.consents for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_member(company_id));

create policy "read own payee, admins see colleagues" on public.payees for select to authenticated
  using (user_id = (select auth.uid()) or exists (
    select 1 from public.company_members m where m.user_id = payees.user_id and public.is_admin(m.company_id)));

create policy "read own answers, admins read all" on public.attempts for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin(company_id));
create policy "record own answers after consent" on public.attempts for insert to authenticated
  with check (user_id = (select auth.uid()) and exists (
    select 1 from public.consents c where c.company_id = attempts.company_id and c.user_id = (select auth.uid())));

-- AI output is for admins until an award is confirmed; employees then see it through their award
create policy "admins read evaluations" on public.evaluations for select to authenticated using (public.is_admin(company_id));
create policy "admins read reports" on public.ai_reports for select to authenticated using (public.is_admin(company_id));

create policy "admins read awards, employees read their confirmed award" on public.awards for select to authenticated
  using (public.is_admin(company_id) or (user_id = (select auth.uid()) and confirmed_at is not null));

create policy "admins read batches" on public.payout_batches for select to authenticated using (public.is_admin(company_id));
create policy "admins read payout items" on public.payout_items for select to authenticated
  using (exists (select 1 from public.payout_batches b where b.id = batch_id and public.is_admin(b.company_id)));
create policy "admins read subscription" on public.subscriptions for select to authenticated using (public.is_admin(company_id));
-- paypal_connections, ai_usage, webhook_events: no policies = no browser access at all
