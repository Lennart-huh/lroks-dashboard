// Koppeling tussen het LRoks-dashboard en ClickUp — ALLEEN LEZEN.
//
// ChargeNow zet offerteaanvragen in hun eigen ClickUp-workspace, in de lijst
// "LRoks" die met Lennart gedeeld is. Het dashboard haalt die aanvragen hier
// op (lijst, één aanvraag met reacties, en de foto's), zodat Claude in het
// offertescherm ermee kan rekenen.
//
// Bewust zo beperkt mogelijk:
// - alleen GET-verzoeken naar ClickUp: deze functie kan niets plaatsen,
//   wijzigen of verwijderen (afspraak met Lennart: niets in ClickUp zetten);
// - alleen taken uit die ene lijst;
// - de ClickUp-sleutel staat als secret CLICKUP_API_TOKEN op de server en
//   komt nooit in de browser;
// - net als anthropic-proxy: alleen voor wie ingelogd is mét authenticator.

const TOEGESTANE_ORIGINS = [
  "https://lennart-huh.github.io",
  "http://localhost:3000",
];

const LIJST_ID = "1200630000003590"; // lijst "LRoks" in de workspace van ChargeNow
const CLICKUP = "https://api.clickup.com/api/v2";
const MAX_BIJLAGE = 20 * 1024 * 1024; // foto's van een telefoon zijn een paar MB

function corsHeaders(origin: string | null): Record<string, string> {
  const toegestaan = origin && TOEGESTANE_ORIGINS.includes(origin) ? origin : TOEGESTANE_ORIGINS[0];
  return {
    "access-control-allow-origin": toegestaan,
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "POST, OPTIONS",
    "vary": "origin",
  };
}

function aalVan(authorization: string | null): string | null {
  try {
    const deel = (authorization || "").replace(/^Bearer\s+/i, "").split(".")[1];
    const b64 = deel.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(deel.length / 4) * 4, "=");
    return JSON.parse(atob(b64)).aal ?? null;
  } catch {
    return null;
  }
}

function json(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "content-type": "application/json" },
  });
}

class Fout extends Error {
  constructor(public status: number, message: string, public code = "fout") {
    super(message);
  }
}

// deno-lint-ignore no-explicit-any
type Obj = Record<string, any>;

async function cu(pad: string, sleutel: string): Promise<Obj> {
  const antwoord = await fetch(CLICKUP + pad, { headers: { authorization: sleutel } });
  const tekst = await antwoord.text();
  let data: Obj = {};
  try { data = JSON.parse(tekst); } catch { /* geen JSON */ }
  if (antwoord.status === 401) {
    throw new Fout(502, "ClickUp accepteert de sleutel niet (CLICKUP_API_TOKEN). Maak een nieuwe aan en zet die in Supabase.", "sleutel_fout");
  }
  if (!antwoord.ok) {
    throw new Fout(502, "ClickUp gaf een fout (" + antwoord.status + "): " + (data.err || tekst.slice(0, 200)));
  }
  return data;
}

const adresVan = (t: Obj): string | null => {
  const veld = (t.custom_fields || []).find((f: Obj) => String(f.name || "").toLowerCase() === "adres");
  return veld && veld.value ? String(veld.value) : null;
};

// Taak ophalen en controleren dat hij echt in de gedeelde lijst staat.
async function taakUitLijst(taakId: string, sleutel: string): Promise<Obj> {
  if (!/^[a-z0-9]{6,20}$/i.test(taakId)) throw new Fout(400, "Ongeldig taak-id");
  const t = await cu("/task/" + encodeURIComponent(taakId) + "?include_markdown_description=true", sleutel);
  if (!t.list || String(t.list.id) !== LIJST_ID) throw new Fout(403, "Deze taak staat niet in de lijst LRoks");
  return t;
}

// Eenvoudige weergave van custom fields (tekst, getal, dropdown).
function veldWaarde(f: Obj): unknown {
  if (f.value === undefined || f.value === null || f.value === "") return null;
  if (f.type === "drop_down" && f.type_config && Array.isArray(f.type_config.options)) {
    const o = f.type_config.options.find((x: Obj) => x.id === f.value || x.orderindex === f.value);
    return o ? o.name : f.value;
  }
  if (typeof f.value === "object") return JSON.stringify(f.value).slice(0, 500);
  return f.value;
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (req.method !== "POST") {
    return json({ error: { message: "Alleen POST" } }, 405, origin);
  }
  if (aalVan(req.headers.get("authorization")) !== "aal2") {
    return json({ error: { message: "Log opnieuw in met je authenticator-code" } }, 401, origin);
  }

  const sleutel = Deno.env.get("CLICKUP_API_TOKEN");
  if (!sleutel) {
    return json({ error: { code: "geen_sleutel", message: "De ClickUp-sleutel staat nog niet in Supabase (secret CLICKUP_API_TOKEN)." } }, 500, origin);
  }

  let verzoek: Obj;
  try {
    verzoek = await req.json();
  } catch {
    return json({ error: { message: "Ongeldige JSON in het verzoek" } }, 400, origin);
  }

  try {
    if (verzoek.actie === "lijst") {
      const data = await cu("/list/" + LIJST_ID + "/task?include_closed=true&subtasks=false&order_by=created&page=0", sleutel);
      const taken = (data.tasks || []).map((t: Obj) => ({
        id: t.id,
        naam: t.name,
        status: t.status ? t.status.status : null,
        status_type: t.status ? t.status.type : null,
        aangemaakt: Number(t.date_created) || null,
        bijgewerkt: Number(t.date_updated) || null,
        gesloten: Number(t.date_closed) || null,
        adres: adresVan(t),
        maker: t.creator ? t.creator.username : null,
        toegewezen: (t.assignees || []).map((a: Obj) => a.username),
        url: t.url,
      }));
      return json({ taken }, 200, origin);
    }

    if (verzoek.actie === "taak") {
      const t = await taakUitLijst(String(verzoek.taak_id || ""), sleutel);
      const r = await cu("/task/" + encodeURIComponent(t.id) + "/comment", sleutel);
      const reacties = (r.comments || [])
        .map((c: Obj) => ({ tekst: c.comment_text, door: c.user ? c.user.username : null, datum: Number(c.date) || null }))
        .sort((a: Obj, b: Obj) => (a.datum || 0) - (b.datum || 0));
      return json({
        id: t.id,
        naam: t.name,
        status: t.status ? t.status.status : null,
        url: t.url,
        aangemaakt: Number(t.date_created) || null,
        bijgewerkt: Number(t.date_updated) || null,
        maker: t.creator ? t.creator.username : null,
        adres: adresVan(t),
        beschrijving: t.markdown_description || t.text_content || t.description || "",
        velden: (t.custom_fields || [])
          .map((f: Obj) => ({ naam: f.name, waarde: veldWaarde(f) }))
          .filter((f: Obj) => f.waarde !== null),
        bijlagen: (t.attachments || []).map((b: Obj) => ({
          id: b.id, titel: b.title, extensie: b.extension, mimetype: b.mimetype || null,
          grootte: b.size || null, datum: Number(b.date) || null,
        })),
        reacties,
      }, 200, origin);
    }

    if (verzoek.actie === "bijlage") {
      const t = await taakUitLijst(String(verzoek.taak_id || ""), sleutel);
      const b = (t.attachments || []).find((x: Obj) => x.id === verzoek.bijlage_id);
      if (!b) throw new Fout(404, "Bijlage niet gevonden bij deze taak");
      const soort = String(b.mimetype || "");
      if (!/^image\//.test(soort) && !/^(jpe?g|png|gif|webp|heic)$/i.test(String(b.extension || ""))) {
        throw new Fout(400, "Alleen foto's kunnen worden opgehaald");
      }
      if (!verzoek.klein && b.size && Number(b.size) > MAX_BIJLAGE) throw new Fout(400, "Foto is te groot");
      // klein = voorbeeldje voor het scherm (ClickUp maakt die zelf), anders de hele foto
      const adressen: string[] = [];
      if (verzoek.klein) adressen.push(b.thumbnail_large, b.thumbnail_medium);
      adressen.push(b.url, b.url_w_query);
      let antwoord: Response | null = null;
      let laatste = 0;
      // eerst met de sleutel (nodig bij privé-bijlagen), anders zonder
      for (const adres of [...new Set(adressen.filter(Boolean))]) {
        for (const kop of [{ authorization: sleutel }, {}]) {
          const a = await fetch(adres, { headers: kop });
          // een inlogpagina of foutmelding (html/json) is geen foto
          if (a.ok && !/^(text\/|application\/json)/.test(a.headers.get("content-type") || "")) { antwoord = a; break; }
          laatste = a.status;
          await a.body?.cancel();
        }
        if (antwoord) break;
      }
      if (!antwoord) throw new Fout(502, "Foto ophalen bij ClickUp mislukt (" + laatste + ")");
      const bytes = new Uint8Array(await antwoord.arrayBuffer());
      if (bytes.length > MAX_BIJLAGE) throw new Fout(400, "Foto is te groot");
      const type = antwoord.headers.get("content-type") || "";
      return new Response(bytes, {
        status: 200,
        headers: { ...corsHeaders(origin), "content-type": /^image\//.test(type) ? type : (soort || "image/jpeg"), "cache-control": "private, max-age=600" },
      });
    }

    return json({ error: { message: "Onbekende actie" } }, 400, origin);
  } catch (e) {
    const f = e instanceof Fout ? e : new Fout(502, "ClickUp niet bereikbaar: " + (e as Error).message);
    return json({ error: { code: f.code, message: f.message } }, f.status, origin);
  }
});
