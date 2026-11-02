import { db } from "@/lib/db";
import { collabType, fmvCheck } from "@/lib/projects";
import { REGISTER_STATUSES } from "@/lib/compliance-data";
import type { ProjectStatus } from "@/generated/prisma/client";

export { STATS_ROLES } from "@/lib/org-roles";

const ENGAGED = new Set<string>(REGISTER_STATUSES);
const DAY = 86400000;

export type StatsSeries = "fees" | "logistics" | "hospitality";
export type OrgStats = Awaited<ReturnType<typeof orgStats>>;

const median = (xs: number[]) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const quarterOf = (d: Date) => Math.floor(d.getUTCMonth() / 3);
const inYear = (d: Date | null | undefined, y: number) => !!d && d.getUTCFullYear() === y;

/**
 * Statistiques d'une organisation sur une année civile.
 * Budget engagé : honoraires des dossiers engagés (validés ou au-delà) à la date d'engagement,
 * logistique (devis retenus et dépenses saisies, HT) et hospitalités (valeur déclarée, TTC) à la date de l'événement.
 */
export async function orgStats(orgId: string, year: number) {
  const start = new Date(Date.UTC(year, 0, 1));
  const end = new Date(Date.UTC(year + 1, 0, 1));

  const projects = await db.project.findMany({
      where: { organizationId: orgId },
      select: {
        id: true, title: true, typeId: true, status: true, createdAt: true, updatedAt: true, declared: true,
        experts: {
          where: { status: { notIn: ["DECLINE"] } },
          select: {
            id: true, feeCents: true, days: true, status: true, createdAt: true, respondedAt: true,
            practitioner: { select: { id: true, specialty: true, user: { select: { firstName: true, lastName: true } } } },
          },
        },
      },
    });
  const [logs, quotes, expenses, events] = await Promise.all([
    db.auditLog.findMany({
      where: { entityType: "Project", action: { startsWith: "project." }, entityId: { in: projects.map((p) => p.id) } },
      select: { entityId: true, action: true, data: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    db.quote.findMany({
      where: { status: "retained", rfq: { organizationId: orgId } },
      select: { amountCents: true, updatedAt: true, rfq: { select: { createdAt: true, eventId: true, event: { select: { startsAt: true } } } } },
    }),
    db.expense.findMany({ where: { project: { organizationId: orgId }, status: { not: "draft" } }, select: { amountCents: true, date: true } }),
    db.event.findMany({
      where: { organizationId: orgId, startsAt: { gte: start, lt: end } },
      select: {
        id: true, title: true, startsAt: true, capacity: true, internal: true,
        registrations: { select: { kind: true, declared: true, profession: true, benefits: { select: { valueCents: true } } } },
        rfqs: { select: { quotes: { where: { status: "retained" }, select: { amountCents: true } } } },
      },
      orderBy: { startsAt: "asc" },
    }),
  ]);
  const first = projects.reduce<Date | null>((m, p) => (!m || p.createdAt < m ? p.createdAt : m), null);

  // Historique des statuts par dossier (journal d'audit).
  type Step = { action: string; from: string | null; to: string | null; at: Date };
  const history = new Map<string, Step[]>();
  for (const l of logs) {
    const d = (l.data ?? {}) as { from?: string; to?: string };
    const list = history.get(l.entityId) ?? [];
    list.push({ action: l.action, from: d.from ?? null, to: d.to ?? null, at: l.createdAt });
    history.set(l.entityId, list);
  }
  const engagedAt = (p: (typeof projects)[number]) => history.get(p.id)?.find((s) => s.to && ENGAGED.has(s.to))?.at ?? (ENGAGED.has(p.status) ? p.updatedAt : null);

  // ─── Budget par trimestre ───
  const quarters = [0, 1, 2, 3].map((q) => ({ label: `T${q + 1}`, fees: 0, logistics: 0, hospitality: 0 }));
  const byType = new Map<string, { label: string; cents: number; projects: number }>();
  const byExpert = new Map<string, { name: string; cents: number; specialty: string | null }>();
  let engagedProjects = 0, fmvOver = 0, toDeclare = 0, declared = 0;
  for (const p of projects) {
    const at = engagedAt(p);
    if (!inYear(at, year)) continue;
    engagedProjects++;
    if (p.declared) declared++; else toDeclare++;
    const t = collabType(p.typeId);
    let projectFees = 0;
    for (const e of p.experts) {
      const fee = e.feeCents ?? 0;
      projectFees += fee;
      const key = e.practitioner.id;
      const cur = byExpert.get(key) ?? { name: `${e.practitioner.user.firstName} ${e.practitioner.user.lastName}`, cents: 0, specialty: e.practitioner.specialty };
      cur.cents += fee;
      byExpert.set(key, cur);
      if (fmvCheck(p.typeId, e.feeCents, e.days)?.verdict === "above") fmvOver++;
    }
    quarters[quarterOf(at!)].fees += projectFees;
    const ty = byType.get(p.typeId) ?? { label: t?.label ?? p.typeId, cents: 0, projects: 0 };
    ty.cents += projectFees;
    ty.projects++;
    byType.set(p.typeId, ty);
  }
  for (const q of quotes) {
    const at = q.rfq.event?.startsAt ?? q.rfq.createdAt;
    if (inYear(at, year)) quarters[quarterOf(at)].logistics += q.amountCents;
  }
  for (const e of expenses) if (inYear(e.date, year)) quarters[quarterOf(e.date)].logistics += e.amountCents;

  // ─── Événements : participants, hospitalités, coût par participant ───
  const now = new Date();
  const eventRows = events.map((ev) => {
    const participants = ev.registrations.filter((r) => r.kind === "participant").length;
    const hospitality = ev.registrations.reduce((s, r) => s + r.benefits.reduce((t, b) => t + b.valueCents, 0), 0);
    const suppliers = ev.rfqs.reduce((s, r) => s + r.quotes.reduce((t, q) => t + q.amountCents, 0), 0);
    quarters[quarterOf(ev.startsAt)].hospitality += hospitality;
    return {
      id: ev.id, title: ev.title, date: ev.startsAt, past: ev.startsAt < now, internal: ev.internal, capacity: ev.capacity,
      registrations: ev.registrations.length, participants, hospitality, suppliers,
      perParticipant: ev.registrations.length ? Math.round((hospitality + suppliers) / ev.registrations.length) : null,
      fillRate: ev.capacity ? Math.round((ev.registrations.length / ev.capacity) * 100) : null,
    };
  });

  // ─── Concentration des honoraires et spécialités ───
  const experts = [...byExpert.values()].filter((e) => e.cents > 0).sort((a, b) => b.cents - a.cents);
  const feesTotal = experts.reduce((s, e) => s + e.cents, 0);
  const top = experts.slice(0, 5).map((e) => ({ ...e, share: feesTotal ? e.cents / feesTotal : 0 }));
  const top5Share = feesTotal ? top.reduce((s, e) => s + e.cents, 0) / feesTotal : null;
  const specialties = new Map<string, number>();
  for (const e of byExpert.values()) specialties.set(e.specialty || "Non renseignée", (specialties.get(e.specialty || "Non renseignée") ?? 0) + 1);

  // ─── Délais (médianes, en jours) ───
  const expertResponse: number[] = [];
  const compliance: number[] = [];
  const toSignature: number[] = [];
  for (const p of projects) {
    for (const e of p.experts) if (e.respondedAt && inYear(e.respondedAt, year)) expertResponse.push((e.respondedAt.getTime() - e.createdAt.getTime()) / DAY);
    const steps = history.get(p.id) ?? [];
    steps.forEach((s, i) => {
      if (s.to !== "EN_VALID") return;
      const next = steps.slice(i + 1).find((n) => n.from === "EN_VALID");
      if (next && inYear(next.at, year)) compliance.push((next.at.getTime() - s.at.getTime()) / DAY);
    });
    const signed = steps.find((s) => s.to === "SIGNE");
    if (signed && inYear(signed.at, year)) toSignature.push((signed.at.getTime() - p.createdAt.getTime()) / DAY);
  }
  const blocked = [...history.values()].flat().filter((s) => s.to === "BLOQUE" && inYear(s.at, year)).length;

  const totals = quarters.reduce((s, q) => ({ fees: s.fees + q.fees, logistics: s.logistics + q.logistics, hospitality: s.hospitality + q.hospitality }), { fees: 0, logistics: 0, hospitality: 0 });
  const firstYear = first ? first.getUTCFullYear() : year;
  return {
    year,
    years: Array.from({ length: Math.max(1, now.getUTCFullYear() - Math.min(firstYear, now.getUTCFullYear()) + 1) }, (_, i) => now.getUTCFullYear() - i),
    totals: { ...totals, all: totals.fees + totals.logistics + totals.hospitality },
    quarters,
    byType: [...byType.values()].sort((a, b) => b.cents - a.cents),
    engagedProjects,
    expertCount: experts.length,
    top,
    top5Share,
    specialties: [...specialties.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    events: eventRows,
    participants: eventRows.reduce((s, e) => s + e.participants, 0),
    delays: {
      expertResponse: { days: median(expertResponse), n: expertResponse.length },
      compliance: { days: median(compliance), n: compliance.length },
      toSignature: { days: median(toSignature), n: toSignature.length },
    },
    compliance: { toDeclare, declared, blocked, fmvOver },
  };
}

/** Statuts pris en compte dans le budget engagé, pour l'aide en bas de page. */
export const ENGAGED_STATUSES: ProjectStatus[] = REGISTER_STATUSES;
