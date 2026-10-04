import "server-only";
import { db } from "@/lib/db";
import { collabType, fmvCheck, STATUS_LABEL } from "@/lib/projects";
import { eventTypeLabel } from "@/lib/events";
import type { CollabConventionInput, HospitalityConventionInput } from "@/lib/convention-pdf";

/** Données d'une convention de collaboration (un expert d'un dossier). */
export async function loadCollabConvention(linkId: string, where: { organizationId?: string; expertUserId?: string }): Promise<CollabConventionInput | null> {
  const link = await db.projectExpert.findFirst({
    where: {
      id: linkId,
      ...(where.organizationId ? { project: { organizationId: where.organizationId } } : {}),
      ...(where.expertUserId ? { practitioner: { userId: where.expertUserId } } : {}),
    },
    include: {
      project: { include: { organization: true } },
      practitioner: { include: { user: true, structures: { where: { isPayee: true }, take: 1 } } },
    },
  });
  if (!link || link.status === "ATT_EXPERTS" || link.status === "DECLINE") return null;
  const p = link.project;
  const type = collabType(p.typeId);
  const fmv = fmvCheck(p.typeId, link.feeCents, link.days);
  const s = link.practitioner.structures[0];
  return {
    ref: `KB-${p.id.slice(-6).toUpperCase()}-${link.id.slice(-4).toUpperCase()}`,
    statusLabel: STATUS_LABEL[p.status],
    org: { name: p.organization.name, headquarters: p.organization.headquarters, contactEmail: p.organization.contactEmail, policy: p.organization.policy },
    expert: {
      firstName: link.practitioner.user.firstName, lastName: link.practitioner.user.lastName, email: link.practitioner.user.email,
      profession: link.practitioner.profession, rpps: link.practitioner.rpps, city: link.practitioner.city,
      structure: s ? { name: s.name, legalForm: s.legalForm, siren: s.siren } : null,
    },
    project: { title: p.title, typeLabel: type?.label ?? p.typeId, unit: type?.unit ?? "unité", therapeuticArea: p.therapeuticArea, description: p.description, ordreRef: p.ordreRef },
    link: { units: link.days, feeCents: link.feeCents },
    fmv: fmv ? { min: fmv.min, max: fmv.max, perUnit: fmv.perUnit, verdict: fmv.verdict } : null,
  };
}

/** Données d'une convention d'hospitalité (une inscription avec avantages). */
export async function loadHospitalityConvention(registrationId: string, organizationId: string): Promise<HospitalityConventionInput | null> {
  const r = await db.registration.findFirst({
    where: { id: registrationId, event: { organizationId }, benefits: { some: {} } },
    include: { user: { include: { practitioner: true } }, event: { include: { organization: true } }, benefits: { include: { benefit: true } } },
  });
  if (!r) return null;
  return {
    ref: `KB-H-${r.id.slice(-8).toUpperCase()}`,
    org: { name: r.event.organization.name, headquarters: r.event.organization.headquarters },
    beneficiary: { firstName: r.user.firstName, lastName: r.user.lastName, email: r.user.email, profession: r.profession, rpps: r.user.practitioner?.rpps ?? null, structure: r.structure },
    event: { title: r.event.title, startsAt: r.event.startsAt, city: r.event.city, venue: r.event.venue, typeLabel: eventTypeLabel(r.event.typeId) },
    benefits: r.benefits.map((b) => ({ label: b.benefit.label, valueCents: b.valueCents })),
    declared: r.declared,
    declarationRef: r.declarationRef,
  };
}
