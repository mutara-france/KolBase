import { db } from "@/lib/db";
import { requireMembership } from "@/lib/orgs";
import { COMPLIANCE_ROLES, formatDate, toCSV } from "@/lib/events";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { org } = await requireMembership(id, COMPLIANCE_ROLES);
  const statut = new URL(req.url).searchParams.get("statut");
  const regs = await db.registration.findMany({
    where: {
      event: { organizationId: id },
      profession: { not: null },
      benefits: { some: {} },
      ...(statut === "declarees" ? { declared: true } : statut === "a-declarer" ? { declared: false } : {}),
    },
    include: { user: { include: { practitioner: true } }, event: true, benefits: { include: { benefit: true } } },
    orderBy: [{ event: { startsAt: "asc" } }, { createdAt: "asc" }],
  });
  // Une ligne par avantage : format proche de la déclaration Transparence Santé.
  const rows: unknown[][] = [["Entreprise", "Nom", "Prénom", "Profession", "RPPS", "Ville", "Événement", "Date événement", "Nature de l'avantage", "Montant (€ TTC)", "Déclaré", "Référence"]];
  for (const r of regs) {
    for (const b of r.benefits) {
      rows.push([
        org.name, r.user.lastName, r.user.firstName, r.profession, r.user.practitioner?.rpps, r.user.practitioner?.city,
        r.event.title, formatDate(r.event.startsAt), b.benefit.label,
        (b.valueCents / 100).toFixed(2).replace(".", ","), r.declared ? "oui" : "non", r.declarationRef,
      ]);
    }
  }
  return new Response(toCSV(rows), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="hospitalites-${statut ?? "toutes"}.csv"` },
  });
}
