import { requireMembership } from "@/lib/orgs";
import { COMPLIANCE_ROLES, toCSV } from "@/lib/events";
import { audit } from "@/lib/auth";
import { COLUMNS, declarationRows, parseSemester, semesterKey, semesterOf } from "@/lib/transparence";

/** Fichier de déclaration Transparence Santé d'un semestre (CSV, libellés de la plateforme). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user } = await requireMembership(id, COMPLIANCE_ROLES);
  const url = new URL(req.url);
  const s = parseSemester(url.searchParams.get("periode")) ?? semesterOf(new Date());
  const report = await declarationRows(id, s, { includeDeclared: url.searchParams.get("tout") === "1" });
  await audit(user.id, "transparence.export", "Organization", id, { periode: semesterKey(s), lignes: report.rows.length });
  const out: unknown[][] = [[...COLUMNS], ...report.rows.map((r) => COLUMNS.map((c) => r[c]))];
  return new Response(toCSV(out), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="transparence-sante-${semesterKey(s)}.csv"`, "Cache-Control": "private, no-store" },
  });
}
