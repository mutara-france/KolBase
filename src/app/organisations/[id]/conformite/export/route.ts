import { requireMembership } from "@/lib/orgs";
import { COMPLIANCE_ROLES, formatDate, toCSV } from "@/lib/events";
import { REGIME_LABEL } from "@/lib/compliance";
import { registerRows } from "@/lib/compliance-data";
import { STATUS_LABEL } from "@/lib/projects";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { org } = await requireMembership(id, COMPLIANCE_ROLES);
  const url = new URL(req.url);
  const type = url.searchParams.get("type") === "transparence" ? "transparence" : "registre";
  const annee = url.searchParams.get("annee");
  const year = annee === "toutes" ? null : Number(annee) || new Date().getFullYear();

  let rows = await registerRows(id, year, org.complianceSettings);
  if (type === "transparence") rows = rows.filter((r) => r.kind === "remuneration" && ["SIGNE", "TERMINE"].includes(r.status));

  const out: unknown[][] = [[
    "Entreprise", "Type", "Date", "Nom", "Prénom", "RPPS", "Ville", "Objet", "Nature", "Montant (€)", "Régime", "Motif", "Statut", "Publié", "Référence",
  ]];
  for (const r of rows) {
    out.push([
      org.name, r.kind === "remuneration" ? "Convention de rémunération" : "Convention d'hospitalité", formatDate(r.date),
      r.lastName, r.firstName, r.rpps, r.city, r.subject, r.nature, (r.amountCents / 100).toFixed(2).replace(".", ","),
      REGIME_LABEL[r.regime], r.reason, r.status ? STATUS_LABEL[r.status as keyof typeof STATUS_LABEL] : "", r.declared ? "oui" : "non", r.declarationRef,
    ]);
  }
  return new Response(toCSV(out), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${type}-${year ?? "toutes"}.csv"` },
  });
}
