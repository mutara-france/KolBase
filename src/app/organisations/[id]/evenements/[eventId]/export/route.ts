import { db } from "@/lib/db";
import { requireMembership } from "@/lib/orgs";
import { EVENT_MANAGER_ROLES, eventEnded, eventScope, formatDate, formatTime, toCSV } from "@/lib/events";
import { dietLabel } from "@/lib/registration-needs";

export async function GET(_: Request, { params }: { params: Promise<{ id: string; eventId: string }> }) {
  const { id, eventId } = await params;
  const { user, roles } = await requireMembership(id, [...EVENT_MANAGER_ROLES, "CONFORMITE"]);
  // La conformité lit tous les événements de l'organisation ; une agence, ceux qui lui sont confiés.
  const readOnly = !roles.some((r) => EVENT_MANAGER_ROLES.includes(r));
  const event = await db.event.findFirst({
    where: { id: eventId, organizationId: id, ...(readOnly ? {} : eventScope(user, roles)) },
    include: { registrations: { include: { user: true, benefits: { include: { benefit: true } } }, orderBy: { createdAt: "asc" } } },
  });
  if (!event) return new Response("Introuvable", { status: 404 });
  // Présence d'après le pointage : « absent » seulement après la fin d'un événement pointé (même règle que le bilan).
  const pointed = event.registrations.some((r) => r.checkedInAt);
  const ended = eventEnded(event);
  const presence = (r: (typeof event.registrations)[number]) => (r.checkedInAt ? "présent" : ended && pointed ? "absent" : "");
  // Besoins (régime, allergies, accessibilité) : réservés à l'équipe qui organise, pas à la conformité seule.
  const withNeeds = !readOnly;
  const rows: unknown[][] = [["Nom", "Prénom", "E-mail", "Profession", "Structure", "Prestations acceptées", "Valeur (€)", "Inscrit le", "Présence", "Arrivée", "Déclaré", "Référence", ...(withNeeds ? ["Régime", "Allergies", "Accessibilité"] : [])]];
  for (const r of event.registrations) {
    rows.push([
      r.user.lastName, r.user.firstName, r.user.email, r.profession, r.structure,
      r.benefits.map((b) => b.benefit.label).join(" + "),
      (r.benefits.reduce((s, b) => s + b.valueCents, 0) / 100).toFixed(2).replace(".", ","),
      formatDate(r.createdAt), presence(r), r.checkedInAt ? `${formatDate(r.checkedInAt)} ${formatTime(r.checkedInAt)}` : "",
      r.declared ? "oui" : "non", r.declarationRef,
      ...(withNeeds ? [dietLabel(r.diet) ?? "", r.allergies ?? "", r.needs ?? ""] : []),
    ]);
  }
  return new Response(toCSV(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="inscrits-${eventId}.csv"`,
    },
  });
}
