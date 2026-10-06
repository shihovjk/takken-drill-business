-- The study app records three kinds of answers:
--   four : a 4-choice question in the drill (timed per question)
--   ox   : one true/false statement (about 30 s each, so not compared with 4-choice speed)
--   mock : a question in a 2-hour mock exam (no per-question time)
alter table public.attempts add column mode text not null default 'four' check (mode in ('four', 'ox', 'mock'));
alter table public.attempts alter column ms drop not null;
grant insert (mode) on public.attempts to authenticated;
