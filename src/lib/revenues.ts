import "server-only";
import { db } from "@/lib/db";
import { collabType } from "@/lib/projects";
import { pointedPastEvents } from "@/lib/checkin";
import { isAbsent } from "@/lib/indicators";

/**
 * « Mes revenus » d'un praticien : honoraires des collaborations engagées, hospitalités reçues,
 * liens d'intérêts (KolBase + déclarés à la main) et état des déclarations Transparence Santé.
 * Données visibles du seul praticien. Une hospitalité d'un absent au pointage (non consommée) est signalée
 * « absent : non déclaré » et ne compte ni dans les totaux ni dans les liens d'intérêts.
 */
const SIGNED = ["SIGNE", "TERMINE"] as const;
export const INTEREST_YEARS = 5;

export async function practitionerLedger(userId: string, practitionerId: string) {
  const [links, regs, declared] = await Promise.all([
    db.projectExpert.findMany({
      where: { practitionerId, status: { notIn: ["ATT_EXPERTS", "DECLINE"] } },
      include: { project: { include: { organization: { select: { id: true, name: true } } } }, feeNote: { select: { id: true, number: true, issuedAt: true, totalCents: true } } },
      orderBy: { createdAt: "desc" },
    }),
    db.registration.findMany({
      where: { userId, benefits: { some: {} } },
      include: { event: { include: { organization: { select: { id: true, name: true } } } }, benefits: { include: { benefit: true } } },
      orderBy: { event: { startsAt: "desc" } },
    }),
    db.declaredInterest.findMany({ where: { practitionerId }, orderBy: [{ startYear: "desc" }, { createdAt: "desc" }] }),
  ]);
  const now = new Date();
  const pointed = await pointedPastEvents(regs.filter((r) => r.event.startsAt < now).map((r) => r.eventId), now);
  // Année de rattachement : celle du paiement, sinon celle de l'accord de l'expert.
  const fees = links.map((l) => {
    const date = l.paidAt ?? l.respondedAt ?? l.createdAt;
    return {
      id: l.id, date, year: date.getFullYear(), org: l.project.organization, projectId: l.projectId, title: l.project.title,
      type: collabType(l.project.typeId)?.label ?? l.project.typeId, status: l.status, feeCents: l.feeCents ?? 0,
      paidAt: l.paidAt, paidCents: l.paidCents, signed: (SIGNED as readonly string[]).includes(l.status),
      declared: l.project.declared, declarationRef: l.project.declarationRef, note: l.feeNote,
    };
  });
  const hospitality = regs
    .filter((r) => r.event.startsAt < now)
    .map((r) => ({
      id: r.id, date: r.event.startsAt, year: r.event.startsAt.getFullYear(), org: r.event.organization, eventId: r.eventId, title: r.event.title,
      items: r.benefits.map((b) => b.benefit.label), valueCents: r.benefits.reduce((s, b) => s + b.valueCents, 0),
      declared: r.declared, declarationRef: r.declarationRef,
      // Déjà déclarée par l'organisation : elle reste comptée, même sans pointage.
      absent: !r.declared && isAbsent(r, pointed.has(r.eventId)),
    }));
  return { fees, hospitality, declared };
}

export type InterestLine = { org: string; natures: string[]; source: "kolbase" | "declare" };

/** Liens d'intérêts des cinq dernières années, regroupés par organisation. */
export function interestLines(ledger: Awaited<ReturnType<typeof practitionerLedger>>, now = new Date()): InterestLine[] {
  const since = now.getFullYear() - INTEREST_YEARS + 1;
  const map = new Map<string, InterestLine>();
  const add = (org: string, nature: string, source: InterestLine["source"]) => {
    const key = org.trim().toLowerCase();
    const line = map.get(key) ?? { org: org.trim(), natures: [], source };
    if (!line.natures.includes(nature)) line.natures.push(nature);
    if (source === "kolbase") line.source = "kolbase";
    map.set(key, line);
  };
  for (const f of ledger.fees) if (f.signed && f.year >= since) add(f.org.name, `${f.type} (${f.year})`, "kolbase");
  for (const h of ledger.hospitality) if (h.year >= since && !h.absent) add(h.org.name, `Hospitalité lors de « ${h.title} » (${h.year})`, "kolbase");
  for (const d of ledger.declared)
    if ((d.endYear ?? now.getFullYear()) >= since) add(d.organization, `${d.nature} (${d.startYear}${d.endYear ? (d.endYear === d.startYear ? "" : `–${d.endYear}`) : " – en cours"})`, "declare");
  return [...map.values()].sort((a, b) => a.org.localeCompare(b.org, "fr"));
}
