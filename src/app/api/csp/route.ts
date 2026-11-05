/**
 * Rapports de la CSP en observation (voir src/proxy.ts) : journalisés en une ligne, sans l'adresse complète de la page
 * (seulement son chemin), pour décider quand la rendre bloquante.
 */
export async function POST(req: Request) {
  const raw = (await req.text()).slice(0, 4000);
  try {
    const body = JSON.parse(raw) as Record<string, unknown>;
    const reports = Array.isArray(body) ? body.map((r) => (r as { body?: Record<string, unknown> }).body ?? {}) : [(body["csp-report"] as Record<string, unknown>) ?? {}];
    for (const r of reports) {
      const page = String(r["document-uri"] ?? r.documentURL ?? "");
      console.warn(JSON.stringify({
        level: "warn", at: new Date().toISOString(), csp: true,
        directive: r["violated-directive"] ?? r.effectiveDirective, blocked: r["blocked-uri"] ?? r.blockedURL,
        page: page ? (URL.canParse(page) ? new URL(page).pathname : page.slice(0, 200)) : undefined,
      }));
    }
  } catch {
    // Rapport illisible : ignoré.
  }
  return new Response(null, { status: 204 });
}
