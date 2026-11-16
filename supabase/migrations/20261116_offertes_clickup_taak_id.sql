-- Koppeling offerte ↔ aanvraag in ClickUp (lijst "LRoks" van ChargeNow).
-- Uitgevoerd op 2026-11-16 na akkoord van Lennart.
alter table public.offertes add column if not exists clickup_taak_id text;
comment on column public.offertes.clickup_taak_id is 'ID van de ClickUp-taak (aanvraag van ChargeNow) waar deze offerte bij hoort';
