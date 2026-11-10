import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { toCSV } from "@/lib/events";
import { STATS_ROLES } from "@/lib/org-stats";
import { hasMemberRole } from "@/lib/org-roles";
import { collabType, STATUS_LABEL } from "@/lib/projects";
import { drPrefix } from "@/lib/professions";
import { quoteTtc } from "@/lib/quotes";
import { plannedDate } from "@/lib/deadlines";
import { supplierCategoryLabel } from "@/lib/suppliers";

const day = (d: Date | null | undefined) => (d ? d.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" }) : "");
const eur = (c: number | null | undefined) => (c != null ? (c / 100).toFixed(2).replace(".", ",") : "");

/**
 * Export comptable d'une année : une ligne par engagement — honoraires de chaque expert engagé (avec bon de commande,
 * centre de coûts, structure facturée, note d'honoraires, paiement) et devis de prestataires retenus. Pensé pour être
 * rapproché dans l'ERP du service achats sans ressaisie : montants HT et TTC en colonnes séparées, dates au format
 * français, statuts en clair.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  const allowed = !!user && hasMemberRole(user, id, STATS_ROLES);
  const org = allowed ? await db.organization.findUnique({ where: { id }, select: { name: true, kind: true } }) : null;
  if (!org || org.kind === "PRESTATAIRE") return new Response("Introuvable.", { status: 404 });
  const now = new Date().getFullYear();
  const asked = Number(new URL(req.url).searchParams.get("annee"));
  const year = Number.isInteger(asked) && asked >= 2000 && asked <= now ? asked : now;
  const from = new Date(Date.UTC(year, 0, 1)), to = new Date(Date.UTC(year + 1, 0, 1));

  // Honoraires : experts engagés (accord donné) dont l'accord, la signature ou le paiement tombe dans l'année.
  const links = await db.projectExpert.findMany({
    where: {
      project: { organizationId: id },
      status: { notIn: ["ATT_EXPERTS", "DECLINE"] },
      OR: [{ respondedAt: { gte: from, lt: to } }, { paidAt: { gte: from, lt: to } }, { project: { plannedAt: { gte: from, lt: to } } }],
    },
    include: {
      project: { select: { id: true, title: true, typeId: true, status: true, plannedAt: true, purchaseOrder: true, costCenter: true, events: { select: { startsAt: true, cancelledAt: true } } } },
      practitioner: { select: { profession: true, rpps: true, user: { select: { firstName: true, lastName: true } } } },
      billingStructure: { select: { name: true, siren: true } },
      feeNote: { select: { number: true, issuedAt: true, amountCents: true, totalCents: true } },
      signature: { select: { completedAt: true } },
    },
    orderBy: [{ project: { title: "asc" } }, { createdAt: "asc" }],
  });
  // Prestataires : devis retenus sur les demandes de l'organisation, par date de prestation ou d'événement.
  const quotes = await db.quote.findMany({
    where: { status: "retained", rfq: { organizationId: id } },
    include: { supplier: { select: { name: true, siren: true } }, rfq: { select: { category: true, needs: true, serviceStart: true, event: { select: { title: true, startsAt: true, projectId: true, project: { select: { title: true, purchaseOrder: true, costCenter: true } } } } } } },
  });

  const rows: unknown[][] = [[
    "Nature", "Dossier", "Bon de commande", "Centre de coûts", "Bénéficiaire", "Identifiant", "Facturé par", "SIREN", "Type", "Statut du dossier",
    "Date d'engagement", "Date d'intervention", "Date de signature", "Montant HT (€)", "Montant TTC (€)", "Note d'honoraires", "Émise le", "Payé le", "Montant payé (€)",
  ]];
  for (const l of links) {
    const name = `${drPrefix(l.practitioner.profession)}${l.practitioner.user.firstName} ${l.practitioner.user.lastName}`;
    rows.push([
      "Honoraires d'expert", l.project.title, l.project.purchaseOrder ?? "", l.project.costCenter ?? "", name, l.practitioner.rpps ? `RPPS ${l.practitioner.rpps}` : "",
      l.billingStructure?.name ?? (l.billingSelf ? `${name} (nom propre)` : ""), l.billingStructure?.siren ?? "", collabType(l.project.typeId)?.label ?? l.project.typeId, STATUS_LABEL[l.project.status],
      day(l.respondedAt), day(plannedDate(l.project)), day(l.signature?.completedAt), eur(l.feeCents), eur(l.feeNote?.totalCents), l.feeNote?.number ?? "", day(l.feeNote?.issuedAt), day(l.paidAt), eur(l.paidCents),
    ]);
  }
  for (const q of quotes) {
    const when = q.rfq.serviceStart ?? q.rfq.event?.startsAt ?? null;
    if (when && (when < from || when >= to)) continue;
    const dossier = q.rfq.event?.project;
    rows.push([
      "Prestation", dossier?.title ?? q.rfq.event?.title ?? q.rfq.needs.slice(0, 80), dossier?.purchaseOrder ?? "", dossier?.costCenter ?? "", q.supplier.name, "", q.supplier.name, q.supplier.siren ?? "",
      supplierCategoryLabel(q.rfq.category), "Devis retenu", day(q.updatedAt), day(when), "", eur(q.amountCents), eur(quoteTtc(q)), "", "", "", "",
    ]);
  }
  return new Response(toCSV(rows), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="kolbase-comptabilite-${year}.csv"`, "Cache-Control": "private, no-store" },
  });
}
