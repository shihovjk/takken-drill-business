-- Removes everything setup.sql creates, so setup.sql can be run again from scratch.
-- ONLY for the takken-drill-business project. It refuses to run if it finds the
-- production takken-drill tables (progress / memberships / inquiries).
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name in ('progress', 'memberships', 'inquiries')) then
    raise exception 'This looks like the production takken-drill project. Nothing was changed.';
  end if;
end $$;

drop function if exists public.demo_reset(uuid);
drop function if exists public.demo_shift_time(uuid);
drop table if exists public.messages, public.webhook_events, public.subscriptions, public.paypal_connections,
  public.payout_items, public.payout_batches, public.awards, public.ai_usage, public.ai_reports, public.evaluations,
  public.attempts, public.payees, public.consents, public.invitations, public.company_members, public.companies cascade;
drop function if exists public.is_admin(uuid);
drop function if exists public.is_member(uuid);
