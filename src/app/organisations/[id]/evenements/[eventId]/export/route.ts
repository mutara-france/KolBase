import { db } from "@/lib/db";
import { requireMembership } from "@/lib/orgs";
import { EVENT_MANAGER_ROLES, formatDate, toCSV } from "@/lib/events";

export async function GET(_: Request, { params }: { params: Promise<{ id: string; eventId: string }> }) {
  const { id, eventId } = await params;
  await requireMembership(id, EVENT_MANAGER_ROLES);
  const event = await db.event.findFirst({
    where: { id: eventId, organizationId: id },
    include: { registrations: { include: { user: true, benefits: { include: { benefit: true } } }, orderBy: { createdAt: "asc" } } },
  });
  if (!event) return new Response("Introuvable", { status: 404 });
  const rows: unknown[][] = [["Nom", "Prénom", "E-mail", "Profession", "Structure", "Prestations acceptées", "Valeur (€)", "Inscrit le", "Déclaré", "Référence"]];
  for (const r of event.registrations) {
    rows.push([
      r.user.lastName, r.user.firstName, r.user.email, r.profession, r.structure,
      r.benefits.map((b) => b.benefit.label).join(" + "),
      (r.benefits.reduce((s, b) => s + b.valueCents, 0) / 100).toFixed(2).replace(".", ","),
      formatDate(r.createdAt), r.declared ? "oui" : "non", r.declarationRef,
    ]);
  }
  return new Response(toCSV(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="inscrits-${eventId}.csv"`,
    },
  });
}
