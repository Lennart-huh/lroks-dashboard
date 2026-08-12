// Proxy tussen het LRoks-dashboard en de Anthropic API.
//
// Waarom: de PDF-inlezer riep Anthropic rechtstreeks vanuit de browser aan, en
// daarvoor moest de API-sleutel mee naar de browser. Nu woont de sleutel hier,
// als secret op de server, en komt hij de browser nooit meer in.
//
// Supabase controleert zelf of de aanroeper een geldige login van dit project
// heeft (verify_jwt), dus alleen wie op het dashboard kan inloggen komt hier
// binnen. Zonder die controle zou iedereen die de URL kent op jouw rekening
// kunnen stoken.

const TOEGESTANE_ORIGINS = [
  "https://lennart-huh.github.io",
  "http://localhost:3000",
];

/* Bovengrens op wat één aanroep mag kosten. Een factuur inlezen zit ver onder
   deze grens; hij is er om een tikfout of een vastgelopen lus af te vangen. */
const MAX_TOKENS_PLAFOND = 64000;

function corsHeaders(origin: string | null): Record<string, string> {
  const toegestaan = origin && TOEGESTANE_ORIGINS.includes(origin) ? origin : TOEGESTANE_ORIGINS[0];
  return {
    "access-control-allow-origin": toegestaan,
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "POST, OPTIONS",
    "vary": "origin",
  };
}

function json(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "content-type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (req.method !== "POST") {
    return json({ error: { message: "Alleen POST" } }, 405, origin);
  }

  const sleutel = Deno.env.get("ANTHROPIC_API_KEY");
  if (!sleutel) {
    return json(
      { error: { message: "ANTHROPIC_API_KEY ontbreekt in de secrets van deze functie" } },
      500,
      origin,
    );
  }

  let verzoek: Record<string, unknown>;
  try {
    verzoek = await req.json();
  } catch {
    return json({ error: { message: "Ongeldige JSON in het verzoek" } }, 400, origin);
  }

  /* Plafond afdwingen, ongeacht wat de browser meestuurt. */
  const gevraagd = Number(verzoek.max_tokens ?? 0);
  verzoek.max_tokens = gevraagd > 0 ? Math.min(gevraagd, MAX_TOKENS_PLAFOND) : 4096;

  let antwoord: Response;
  try {
    antwoord = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": sleutel,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(verzoek),
    });
  } catch (fout) {
    return json(
      { error: { message: "Anthropic niet bereikbaar: " + (fout as Error).message } },
      502,
      origin,
    );
  }

  /* Het antwoord van Anthropic ongewijzigd doorgeven — ook bij een foutstatus,
     zodat het dashboard de echte foutmelding kan tonen. */
  return new Response(await antwoord.text(), {
    status: antwoord.status,
    headers: { ...corsHeaders(origin), "content-type": "application/json" },
  });
});
