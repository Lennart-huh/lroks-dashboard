-- Offertes uit ClickUp: een nieuwe taak in de gekoppelde ClickUp-lijst wordt
-- door de edge function 'clickup-offerte' uitgerekend en als concept-offerte
-- klaargezet.

-- Bij de offerte zelf: uit welke taak hij komt, en hoe de prijs is opgebouwd.
alter table public.offertes
  add column if not exists clickup_task_id text,
  add column if not exists clickup_url text,
  add column if not exists ai_onderbouwing text;

-- Eén offerte per taak: ClickUp stuurt een melding soms twee keer.
create unique index if not exists offertes_clickup_task
  on public.offertes (clickup_task_id) where clickup_task_id is not null;

-- De koppeling zelf (altijd precies één rij). Hier staat het geheim waarmee
-- ClickUp zijn meldingen ondertekent, dus deze tabel is met opzet NIET
-- leesbaar vanuit het dashboard: row level security aan en geen enkele
-- policy. Alleen de edge function (service role) komt erbij. Er hangt ook
-- geen logboek-trigger aan, zodat het geheim niet in het logboek belandt.
create table if not exists public.clickup_koppeling (
  id int primary key default 1 check (id = 1),
  team_id text,
  lijst_id text,
  lijst_naam text,
  webhook_id text,
  webhook_secret text,
  gekoppeld_op timestamptz,
  laatste_fout text,
  laatste_fout_op timestamptz
);
alter table public.clickup_koppeling enable row level security;
revoke all on public.clickup_koppeling from anon, authenticated;
