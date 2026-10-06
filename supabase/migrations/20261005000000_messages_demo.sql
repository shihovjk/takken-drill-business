-- Follow-up messages from the admin, the PayPal webhook ID per company, and demo upkeep

create table public.messages (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade, -- recipient
  sender_id uuid references auth.users (id),
  body text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
alter table public.messages enable row level security;
revoke all on public.messages from anon, authenticated;
grant select on public.messages to authenticated;
grant update (read_at) on public.messages to authenticated;
create policy "read own messages, admins read all" on public.messages for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin(company_id));
create policy "mark own messages read" on public.messages for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Webhook registered on the company's own PayPal app by paypal-connect
alter table public.paypal_connections add column webhook_id text;

-- The public demo company: kept fresh and resettable
alter table public.companies add column is_demo boolean not null default false;

-- Slide the demo's study log so its newest answer is "now" (the demo runs for weeks after seeding)
create function public.demo_shift_time(cid uuid) returns void
language sql security definer set search_path = '' as $$
  update public.attempts a
  set answered_at = a.answered_at + (now() - m.latest) - interval '20 minutes'
  from (select max(answered_at) as latest from public.attempts where company_id = cid) m
  where a.company_id = cid and (select is_demo from public.companies where id = cid);
$$;

-- Put the demo back to "before anyone clicked": seed rows are marked provider = 'seed' / 'seed-%'
create function public.demo_reset(cid uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not (select is_demo from public.companies where id = cid) then raise exception 'not a demo company'; end if;
  delete from public.payout_items i using public.payout_batches b
    where i.batch_id = b.id and b.company_id = cid and b.sender_batch_id not like 'seed-%';
  delete from public.payout_batches where company_id = cid and sender_batch_id not like 'seed-%';
  delete from public.awards where company_id = cid and coalesce(provider, '') <> 'seed';
  delete from public.ai_reports where company_id = cid;
  delete from public.messages where company_id = cid;
  delete from public.ai_usage where company_id = cid;
end $$;
revoke execute on function public.demo_shift_time(uuid), public.demo_reset(uuid) from public, anon, authenticated;

-- The Edge Functions use the service role. Grant it explicitly so the schema also works when
-- "Automatically expose new tables" is turned off for the project (recommended).
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on function public.demo_shift_time(uuid), public.demo_reset(uuid) to service_role;
-- Signed-in users read through RLS, which calls these helpers
grant usage on schema public to authenticated;
grant execute on function public.is_member(uuid), public.is_admin(uuid) to authenticated;
