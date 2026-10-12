-- The monthly fee is charged per employee: PayPal bills unit_price x quantity (employees at sign-up)
alter table public.subscriptions add column quantity integer;
alter table public.subscriptions add column unit_price integer;
-- A quantity change PayPal is waiting for the admin to approve (after the employee count changed)
alter table public.subscriptions add column pending_quantity integer;
alter table public.subscriptions add column approve_url text;
