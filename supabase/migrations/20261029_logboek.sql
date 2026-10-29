-- Logboek: elke toevoeging, wijziging en verwijdering in public.* komt hier
-- automatisch in, via triggers. De app kan alleen lezen; schrijven doet
-- uitsluitend de triggerfunctie (security definer). Gaat het loggen mis,
-- dan gaat het opslaan in de app gewoon door (alleen een waarschuwing).
create table public.logboek (
  id bigint generated always as identity primary key,
  tijd timestamptz not null default now(),
  tabel text not null,
  actie text not null,          -- toegevoegd | gewijzigd | verwijderd
  rij_id text,
  label text,                   -- leesbare naam van de rij (product, klant, leverancier…)
  oud jsonb,                    -- bij wijzigen: alleen de velden die veranderden
  nieuw jsonb,
  bron text,                    -- 'app' = via het dashboard; anders de databaserol (beheer)
  apparaat text                 -- user-agent van de aanroeper, ingekort
);
create index logboek_tijd on public.logboek (tijd desc);
create index logboek_rij on public.logboek (tabel, rij_id);

alter table public.logboek enable row level security;
create policy eigenaar_lezen on public.logboek for select to authenticated
  using (auth.uid() = '7257b449-c71c-4813-8541-f974acf0dda2'::uuid);
create policy eigenaar_met_code on public.logboek as restrictive for all to authenticated
  using ((auth.uid() = '7257b449-c71c-4813-8541-f974acf0dda2'::uuid) and ((auth.jwt() ->> 'aal') = 'aal2'))
  with check ((auth.uid() = '7257b449-c71c-4813-8541-f974acf0dda2'::uuid) and ((auth.jwt() ->> 'aal') = 'aal2'));
revoke insert, update, delete, truncate on public.logboek from anon, authenticated;

create or replace function public.log_wijziging() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  o jsonb; n jsonb; heel jsonb; k text;
  oo jsonb := '{}'::jsonb; nn jsonb := '{}'::jsonb;
  v_label text; v_rij text; v_bron text; v_ua text; hdr text;
begin
  begin
    if TG_OP in ('UPDATE','DELETE') then o := to_jsonb(OLD) - 'betaal_qr'; end if;
    if TG_OP in ('INSERT','UPDATE') then n := to_jsonb(NEW) - 'betaal_qr'; end if;
    heel := coalesce(n, o);
    v_rij := coalesce(heel->>'id', heel->>'sleutel');

    if TG_OP = 'UPDATE' then
      for k in select jsonb_object_keys(n) loop
        if (o->k) is distinct from (n->k) then
          oo := oo || jsonb_build_object(k, o->k);
          nn := nn || jsonb_build_object(k, n->k);
        end if;
      end loop;
      if nn = '{}'::jsonb then return null; end if;   -- niets veranderd
      o := oo; n := nn;
    end if;

    if heel ? 'product_id' and heel->>'product_id' is not null then
      select p.naam into v_label from producten p where p.id = (heel->>'product_id')::uuid;
    end if;
    v_label := coalesce(v_label, heel->>'naam', heel->>'omschrijving',
      nullif(trim(coalesce(heel->>'leverancier','') || ' ' || coalesce(nullif(heel->>'nummer','-'),'')), ''),
      heel->>'nummer', heel->>'tegenpartij', heel->>'sleutel');

    hdr := current_setting('request.headers', true);
    if hdr is not null and hdr <> '' then v_ua := left(hdr::jsonb->>'user-agent', 300); end if;
    v_bron := case when auth.uid() is not null then 'app'
                   else coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), current_user) end;

    insert into logboek (tabel, actie, rij_id, label, oud, nieuw, bron, apparaat)
    values (TG_TABLE_NAME,
            case TG_OP when 'INSERT' then 'toegevoegd' when 'UPDATE' then 'gewijzigd' else 'verwijderd' end,
            v_rij, left(v_label, 200), o, n, v_bron, v_ua);
  exception when others then
    raise warning 'logboek overgeslagen voor %: %', TG_TABLE_NAME, sqlerrm;
  end;
  return null;
end;
$$;
revoke execute on function public.log_wijziging() from public, anon, authenticated;

do $$
declare t text;
begin
  for t in select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace
           where s.nspname = 'public' and c.relkind = 'r' and c.relname <> 'logboek'
  loop
    execute format('create trigger logboek_wijziging after insert or update or delete on public.%I
                    for each row execute function public.log_wijziging()', t);
  end loop;
end $$;
