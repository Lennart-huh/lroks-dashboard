-- Investering per product op een inkoopfactuur (in plaats van alleen de hele factuur).
-- Bestaande regels blijven gewone kosten: is_investering staat standaard uit.
alter table public.factuur_inkoop_regels
  add column if not exists is_investering boolean not null default false,
  add column if not exists afschrijf_jaren integer,
  add column if not exists restwaarde numeric(10,2),
  add column if not exists kia boolean not null default true;

comment on column public.factuur_inkoop_regels.is_investering is 'Dit product wordt afgeschreven in plaats van in één keer als kosten genomen';
comment on column public.factuur_inkoop_regels.afschrijf_jaren is 'Aantal jaren afschrijving, vanaf de maand van de factuurdatum';
comment on column public.factuur_inkoop_regels.restwaarde is 'Restwaarde aan het eind van de afschrijving (excl. btw)';
comment on column public.factuur_inkoop_regels.kia is 'false = telt niet mee voor de kleinschaligheidsinvesteringsaftrek';
