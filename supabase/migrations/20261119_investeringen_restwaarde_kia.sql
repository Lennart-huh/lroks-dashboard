-- Tabblad Investeringen: restwaarde en KIA per investering (inkoopfactuur met is_investering).
-- Bestaande rijen blijven zoals ze zijn: restwaarde leeg = € 0, kia standaard aan.
alter table public.facturen
  add column if not exists restwaarde numeric(10,2),
  add column if not exists kia boolean not null default true;

comment on column public.facturen.restwaarde is 'Restwaarde van een investering (excl. btw); afschrijving = (bedrag_excl - restwaarde) over afschrijf_jaren, vanaf de maand van aankoop';
comment on column public.facturen.kia is 'false = investering telt niet mee voor de kleinschaligheidsinvesteringsaftrek (bv. personenauto)';
