import { db } from "@/lib/db";
import { collabType, fmvCheck, isEngaged } from "@/lib/projects";
import { REGISTER_STATUSES } from "@/lib/compliance-data";
import { eventHospitality } from "@/lib/indicators";
import { eventEnded } from "@/lib/events";
import { cityKey, cityLabel, regionOf } from "@/lib/regions";
import { addWorkingDays } from "@/lib/deadlines";
import { complianceSettings } from "@/lib/compliance";

export { STATS_ROLES } from "@/lib/org-roles";

/** Dossiers à déclarer sur Transparence Santé : validés par la conformité ou au-delà. */
const VALIDATED = new Set<string>(REGISTER_STATUSES);
const DAY = 86400000;


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
 * Engagé : même définition que l'accueil et les dossiers (src/lib/indicators.ts) : l'expert a accepté la proposition
 * (accord de principe ou au-delà, dossier non abandonné). Budget engagé (HT) : honoraires des experts engagés à la date
 * de leur accord, logistique (devis retenus et dépenses saisies) à la date de l'événement. Hospitalités (TTC, absents
 * exclus après l'événement pointé) à part : jamais additionnées à des montants HT.
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
            practitioner: { select: { id: true, specialty: true, city: true, postalCode: true, country: true, user: { select: { firstName: true, lastName: true } } } },
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
    // Événements tenus ou à venir (un événement annulé n'a ni participants ni hospitalités).
    db.event.findMany({
      where: { organizationId: orgId, startsAt: { gte: start, lt: end }, cancelledAt: null },
      select: {
        id: true, title: true, startsAt: true, durationMinutes: true, capacity: true, internal: true, city: true, postalCode: true,
        registrations: {
          select: {
            kind: true, declared: true, profession: true, checkedInAt: true, benefits: { select: { valueCents: true } },
            user: { select: { practitioner: { select: { city: true, postalCode: true, country: true } } } },
          },
        },
        rfqs: { select: { quotes: { where: { status: "retained" }, select: { amountCents: true } } } },
        surveys: { select: { overall: true } },
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
  const validatedAt = (p: (typeof projects)[number]) => history.get(p.id)?.find((s) => s.to && VALIDATED.has(s.to))?.at ?? (VALIDATED.has(p.status) ? p.updatedAt : null);

  // ─── Budget par trimestre ───
  const quarters = [0, 1, 2, 3].map((q) => ({ label: `T${q + 1}`, fees: 0, logistics: 0, hospitality: 0 }));
  const byType = new Map<string, { label: string; cents: number; projects: number }>();
  const byExpert = new Map<string, { name: string; cents: number; specialty: string | null; place: Place }>();
  let engagedProjects = 0, fmvOver = 0, toDeclare = 0, declared = 0;
  for (const p of projects) {
    // Experts engagés (proposition acceptée), comptés à la date de leur accord.
    const engaged = p.experts.filter((e) => isEngaged(e.status) && inYear(e.respondedAt ?? e.createdAt, year));
    if (VALIDATED.has(p.status) && inYear(validatedAt(p), year)) {
      if (p.declared) declared++; else toDeclare++;
    }
    if (engaged.length === 0) continue;
    engagedProjects++;
    const t = collabType(p.typeId);
    let projectFees = 0;
    for (const e of engaged) {
      const fee = e.feeCents ?? 0;
      projectFees += fee;
      quarters[quarterOf(e.respondedAt ?? e.createdAt)].fees += fee;
      const key = e.practitioner.id;
      const cur = byExpert.get(key) ?? { name: `${e.practitioner.user.firstName} ${e.practitioner.user.lastName}`, cents: 0, specialty: e.practitioner.specialty, place: e.practitioner };
      cur.cents += fee;
      byExpert.set(key, cur);
      if (fmvCheck(p.typeId, e.feeCents, e.days)?.verdict === "above") fmvOver++;
    }
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

  // ─── Événements : participants, hospitalités, coût par présent ───
  // Même règle de présence que la fiche de l'événement : après l'événement pointé, absents exclus et effectif = présents.
  // Hospitalités (TTC) et prestataires (HT) rapportés à l'effectif séparément, jamais additionnés.
  const now = new Date();
  const eventRows = events.map((ev) => {
    const participants = ev.registrations.filter((r) => r.kind === "participant").length;
    const h = eventHospitality(ev.registrations, eventEnded(ev, now));
    const suppliers = ev.rfqs.reduce((s, r) => s + r.quotes.reduce((t, q) => t + q.amountCents, 0), 0);
    quarters[quarterOf(ev.startsAt)].hospitality += h.cents;
    return {
      id: ev.id, title: ev.title, date: ev.startsAt, past: ev.startsAt < now, internal: ev.internal, capacity: ev.capacity,
      registrations: ev.registrations.length, participants, hospitality: h.cents, suppliers,
      // Effectif : présents une fois la présence connue, inscrits sinon.
      headcount: h.headcount, presenceKnown: h.known,
      hospitalityPer: h.headcount ? Math.round(h.cents / h.headcount) : null,
      suppliersPer: h.headcount ? Math.round(suppliers / h.headcount) : null,
      fillRate: ev.capacity ? Math.round((ev.registrations.length / ev.capacity) * 100) : null,
      present: ev.registrations.filter((r) => r.checkedInAt).length,
      rating: ev.surveys.length ? ev.surveys.reduce((s, x) => s + x.overall, 0) / ev.surveys.length : null,
      responses: ev.surveys.length,
    };
  });

  // ─── Concentration des honoraires et spécialités ───
  const experts = [...byExpert.values()].filter((e) => e.cents > 0).sort((a, b) => b.cents - a.cents);
  const feesTotal = experts.reduce((s, e) => s + e.cents, 0);
  const top = experts.slice(0, 5).map((e) => ({ ...e, share: feesTotal ? e.cents / feesTotal : 0 }));
  const top5Share = feesTotal ? top.reduce((s, e) => s + e.cents, 0) / feesTotal : null;
  const specialties = new Map<string, number>();
  for (const e of byExpert.values()) specialties.set(e.specialty || "Non renseignée", (specialties.get(e.specialty || "Non renseignée") ?? 0) + 1);

  // ─── Répartition géographique : experts rémunérés (lieu d'exercice), participants (lieu d'exercice), événements (lieu) ───
  const geo = { regions: newGeo(), cities: newGeo() };
  const add = (bucket: "experts" | "participants" | "events", place: Place | null | undefined, cents = 0) => {
    const r = place && (!place.country || place.country === "FR") ? regionOf(place.postalCode, place.city) : null;
    const abroad = !!place?.country && place.country !== "FR";
    bump(geo.regions[bucket], r ?? (abroad ? "Hors de France" : "Non renseignée"), r ?? (abroad ? "Hors de France" : "Non renseignée"), cents);
    const ck = cityKey(place?.city);
    bump(geo.cities[bucket], ck ?? "", ck ? cityLabel(place?.city)! : "Non renseignée", cents);
  };
  for (const e of experts) add("experts", byExpertPlace(e), e.cents);
  for (const ev of events) {
    add("events", ev);
    for (const r of ev.registrations) if (r.kind === "participant") add("participants", r.user.practitioner);
  }

  // ─── Délais (médianes, en jours) ───
  const expertResponse: number[] = [];
  const compliance: number[] = [];
  // Examens tenus dans le délai interne de la conformité (jours ouvrés après la soumission).
  const reviewDays = complianceSettings((await db.organization.findUnique({ where: { id: orgId }, select: { complianceSettings: true } }))?.complianceSettings).reviewDays;
  let onTime = 0;
  const toSignature: number[] = [];
  for (const p of projects) {
    for (const e of p.experts) if (e.respondedAt && inYear(e.respondedAt, year)) expertResponse.push((e.respondedAt.getTime() - e.createdAt.getTime()) / DAY);
    const steps = history.get(p.id) ?? [];
    steps.forEach((s, i) => {
      if (s.to !== "EN_VALID") return;
      const next = steps.slice(i + 1).find((n) => n.from === "EN_VALID");
      if (next && inYear(next.at, year)) {
        compliance.push((next.at.getTime() - s.at.getTime()) / DAY);
        if (reviewDays > 0 && next.at <= addWorkingDays(s.at, reviewDays)) onTime++;
      }
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
    // Budget engagé : HT seulement (honoraires et logistique) ; les hospitalités (TTC) restent à part.
    totals: { ...totals, ht: totals.fees + totals.logistics },
    quarters,
    byType: [...byType.values()].sort((a, b) => b.cents - a.cents),
    engagedProjects,
    expertCount: experts.length,
    top,
    top5Share,
    specialties: [...specialties.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    geo: { regions: geoRows(geo.regions), cities: geoRows(geo.cities) },
    events: eventRows,
    participants: eventRows.reduce((s, e) => s + e.participants, 0),
    satisfaction: (() => {
      const all = events.flatMap((e) => e.surveys.map((x) => x.overall));
      return { average: all.length ? all.reduce((s, x) => s + x, 0) / all.length : null, responses: all.length };
    })(),
    delays: {
      expertResponse: { days: median(expertResponse), n: expertResponse.length },
      compliance: { days: median(compliance), n: compliance.length, onTime: compliance.length && reviewDays > 0 ? onTime / compliance.length : null, reviewDays },
      toSignature: { days: median(toSignature), n: toSignature.length },
    },
    compliance: { toDeclare, declared, blocked, fmvOver },
  };
}



/** Lieu d'exercice ou d'un événement : ville, code postal, pays (France par défaut). */
type Place = { city: string | null; postalCode: string | null; country?: string | null };
type GeoBucket = Map<string, { label: string; count: number; cents: number }>;
const newGeo = () => ({ experts: new Map() as GeoBucket, participants: new Map() as GeoBucket, events: new Map() as GeoBucket });
function bump(m: GeoBucket, key: string, label: string, cents: number) {
  const cur = m.get(key) ?? { label, count: 0, cents: 0 };
  cur.count++;
  cur.cents += cents;
  m.set(key, cur);
}
/** Lignes triées (effectif décroissant), « Non renseignée » et « Hors de France » en dernier. */
const geoRows = (g: ReturnType<typeof newGeo>) => {
  const rows = (m: GeoBucket) => [...m.values()].sort((a, b) => Number(isOther(a.label)) - Number(isOther(b.label)) || b.count - a.count || b.cents - a.cents || a.label.localeCompare(b.label));
  return { experts: rows(g.experts), participants: rows(g.participants), events: rows(g.events) };
};
const isOther = (label: string) => label === "Non renseignée" || label === "Hors de France";
const byExpertPlace = (e: { place: Place }) => e.place;
