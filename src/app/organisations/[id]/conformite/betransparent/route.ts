import { requireMembership } from "@/lib/orgs";
import { COMPLIANCE_ROLES, toCSV } from "@/lib/events";
import { audit } from "@/lib/auth";
import { BE_COLUMNS, belgianRows } from "@/lib/betransparent";

/** Préparation de la publication betransparent.be d'une année (CSV) : praticiens exerçant en Belgique. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user } = await requireMembership(id, COMPLIANCE_ROLES);
  const raw = Number(new URL(req.url).searchParams.get("annee"));
  const now = new Date().getUTCFullYear();
  const year = Number.isInteger(raw) && raw >= 2020 && raw <= now + 1 ? raw : now - 1;
  const report = await belgianRows(id, year);
  await audit(user.id, "betransparent.export", "Organization", id, { annee: year, lignes: report.rows.length });
  const out: unknown[][] = [[...BE_COLUMNS], ...report.rows.map((r) => BE_COLUMNS.map((c) => r[c]))];
  return new Response(toCSV(out), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="betransparent-${year}.csv"`, "Cache-Control": "private, no-store" },
  });
}
