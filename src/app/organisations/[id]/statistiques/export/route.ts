import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { toCSV } from "@/lib/events";
import { orgStats, STATS_ROLES } from "@/lib/org-stats";

/** Export CSV des statistiques d'une année : budget par trimestre, types, experts, spécialités, événements, délais. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  const allowed = user?.memberships.some((m) => m.organizationId === id && STATS_ROLES.includes(m.role));
  const org = allowed ? await db.organization.findUnique({ where: { id }, select: { name: true, kind: true } }) : null;
  if (!org || org.kind === "PRESTATAIRE") return new Response("Introuvable.", { status: 404 });
  const now = new Date().getFullYear();
  const asked = Number(new URL(req.url).searchParams.get("annee"));
  const year = Number.isInteger(asked) && asked >= 2000 && asked <= now ? asked : now;
  const s = await orgStats(id, year);
  const eur = (c: number | null) => (c != null ? (c / 100).toFixed(2).replace(".", ",") : "");
  const num = (d: number | null) => (d != null ? d.toFixed(1).replace(".", ",") : "");
  const rows: unknown[][] = [["Rubrique", "Libellé", "Valeur", "Unité", "Détail"]];
  for (const q of s.quarters) {
    rows.push(["Budget par trimestre", `${q.label} ${year} — honoraires`, eur(q.fees), "€ HT", ""]);
    rows.push(["Budget par trimestre", `${q.label} ${year} — logistique`, eur(q.logistics), "€ HT", "devis retenus et dépenses"]);
    rows.push(["Budget par trimestre", `${q.label} ${year} — hospitalités`, eur(q.hospitality), "€ TTC", "valeur déclarée, absents exclus"]);
  }
  for (const t of s.byType) rows.push(["Honoraires par type", t.label, eur(t.cents), "€ HT", `${t.projects} dossier(s)`]);
  for (const e of s.top) rows.push(["Experts les mieux rémunérés", e.name, eur(e.cents), "€ HT", `${Math.round(e.share * 100)} % des honoraires`]);
  for (const x of s.specialties) rows.push(["Experts par spécialité", x.label, x.count, "experts", ""]);
  for (const e of s.events)
    rows.push(["Événements", e.title, e.registrations, "inscrits", `${e.date.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" })} ; hospitalités ${eur(e.hospitality)} € TTC ; prestataires ${eur(e.suppliers)} € HT ; hospitalités par ${e.presenceKnown ? "présent" : "inscrit"} ${eur(e.hospitalityPer)} € TTC ; prestataires par ${e.presenceKnown ? "présent" : "inscrit"} ${eur(e.suppliersPer)} € HT ; présents ${e.present} ; note ${e.rating != null ? e.rating.toFixed(1).replace(".", ",") : "—"}/5 (${e.responses} avis)`]);
  rows.push(["Satisfaction", "Note globale moyenne", s.satisfaction.average != null ? s.satisfaction.average.toFixed(2).replace(".", ",") : "", "sur 5", `${s.satisfaction.responses} avis`]);
  rows.push(["Délais", "Réponse des experts (médiane)", num(s.delays.expertResponse.days), "jours", `${s.delays.expertResponse.n} sollicitation(s)`]);
  rows.push(["Délais", "Validation conformité (médiane)", num(s.delays.compliance.days), "jours", `${s.delays.compliance.n} examen(s)`]);
  rows.push(["Délais", "Création → signature (médiane)", num(s.delays.toSignature.days), "jours", `${s.delays.toSignature.n} dossier(s)`]);
  rows.push(["Conformité", "Dossiers déclarés sur Transparence Santé", s.compliance.declared, "dossiers", `sur ${s.compliance.declared + s.compliance.toDeclare}`]);
  rows.push(["Conformité", "Honoraires au-dessus de la fourchette", s.compliance.fmvOver, "experts", ""]);
  rows.push(["Conformité", "Dossiers bloqués", s.compliance.blocked, "dossiers", ""]);
  return new Response(toCSV(rows), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="kolbase-statistiques-${year}.csv"`, "Cache-Control": "private, no-store" },
  });
}
