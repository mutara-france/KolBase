import { db } from "@/lib/db";
import { collabType } from "@/lib/projects";
import { complianceSettings, hospitalityRegime, remunerationRegime, type Regime } from "@/lib/compliance";
import type { ProjectStatus } from "@/generated/prisma/client";

export const REGISTER_STATUSES: ProjectStatus[] = ["VALIDE", "ORDRE", "SIGNATURE", "SIGNE", "TERMINE"];

export type RegisterRow = {
  kind: "remuneration" | "hospitalite";
  date: Date;
  lastName: string;
  firstName: string;
  rpps: string | null;
  city: string | null;
  subject: string;
  nature: string;
  amountCents: number;
  regime: Regime;
  reason: string;
  status: string;
  declared: boolean;
  declarationRef: string | null;
  href: string;
};

/** Registre des conventions : rémunérations (dossiers engagés) et hospitalités (événements), sur une année. */
export async function registerRows(orgId: string, year: number | null, rawSettings: unknown): Promise<RegisterRow[]> {
  const s = complianceSettings(rawSettings);
  const range = year ? { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) } : undefined;

  const links = await db.projectExpert.findMany({
    where: { project: { organizationId: orgId, status: { in: REGISTER_STATUSES }, ...(range ? { updatedAt: range } : {}) }, status: { not: "DECLINE" } },
    include: { project: true, practitioner: { include: { user: { select: { firstName: true, lastName: true } } } } },
    orderBy: { project: { updatedAt: "desc" } },
  });
  const regs = await db.registration.findMany({
    where: { event: { organizationId: orgId, ...(range ? { startsAt: range } : {}) }, profession: { not: null }, benefits: { some: {} } },
    include: { user: { include: { practitioner: true } }, event: true, benefits: { include: { benefit: true } } },
    orderBy: { event: { startsAt: "desc" } },
  });

  const rows: RegisterRow[] = [];
  for (const l of links) {
    const t = collabType(l.project.typeId);
    const r = remunerationRegime(s, l.feeCents, l.days, t?.unit ?? "");
    rows.push({
      kind: "remuneration", date: l.project.updatedAt, lastName: l.practitioner.user.lastName, firstName: l.practitioner.user.firstName,
      rpps: l.practitioner.rpps, city: l.practitioner.city, subject: l.project.title, nature: t?.label ?? l.project.typeId,
      amountCents: l.feeCents ?? 0, regime: r.regime, reason: r.reason, status: l.project.status,
      declared: l.project.declared, declarationRef: l.project.declarationRef, href: `/organisations/${orgId}/dossiers/${l.projectId}`,
    });
  }
  for (const g of regs) {
    const r = hospitalityRegime(s, g.benefits.map((b) => ({ catalogId: b.benefit.catalogId, valueCents: b.valueCents })));
    rows.push({
      kind: "hospitalite", date: g.event.startsAt, lastName: g.user.lastName, firstName: g.user.firstName,
      rpps: g.user.practitioner?.rpps ?? null, city: g.user.practitioner?.city ?? null, subject: g.event.title,
      nature: "Hospitalité : " + g.benefits.map((b) => b.benefit.label).join(", "),
      amountCents: g.benefits.reduce((x, b) => x + b.valueCents, 0), regime: r.regime, reason: r.reason, status: "",
      declared: g.declared, declarationRef: g.declarationRef, href: `/organisations/${orgId}/hospitalites`,
    });
  }
  return rows.sort((a, b) => b.date.getTime() - a.date.getTime());
}
