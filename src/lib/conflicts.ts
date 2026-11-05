import "server-only";
import { db } from "@/lib/db";
import { complianceSettings } from "@/lib/compliance";
import { fmtEur, makeT, type Locale, type T } from "@/lib/i18n";

export type Conflict = { kind: "concurrent" | "beneficiaire" | "structure" | "cumul"; who: string; detail: string; severity: "warn" | "danger" | "info" };

const CLOSED = ["TERMINE", "DECLINE", "REFUS_ORDRE"] as const;
const ENGAGED = { notIn: ["ATT_EXPERTS", "DECLINE"] as ("ATT_EXPERTS" | "DECLINE")[] };

/** Détection des conflits d'intérêts et points d'attention d'un dossier (reprise de « detectConflicts » du prototype). */
export async function detectConflicts(projectId: string, t: T = makeT("fr"), locale: Locale = "fr"): Promise<Conflict[]> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    include: {
      organization: { select: { complianceSettings: true } },
      experts: { where: { status: { not: "DECLINE" } }, include: { practitioner: { include: { user: true, structures: true } } } },
    },
  });
  if (!project) return [];
  const out: Conflict[] = [];
  const CUMUL_ALERT_EUR = complianceSettings(project.organization.complianceSettings).cumulAlert;
  const yearAgo = new Date(Date.now() - 365 * 864e5);

  // Les deux recherches de chaque expert sont lancées ensemble, pour tous les experts du dossier.
  const perExpert = await Promise.all(
    project.experts.map((e) =>
      Promise.all([
        project.therapeuticArea
          ? db.projectExpert.findMany({
              where: {
                practitionerId: e.practitionerId, status: ENGAGED,
                project: { id: { not: project.id }, organizationId: { not: project.organizationId }, therapeuticArea: project.therapeuticArea, status: { notIn: [...CLOSED] } },
              },
              select: { project: { select: { organizationId: true } } },
            })
          : Promise.resolve([]),
        db.projectExpert.findMany({
          where: { practitionerId: e.practitionerId, status: ENGAGED, project: { organizationId: project.organizationId, createdAt: { gte: yearAgo }, status: { notIn: ["DECLINE", "REFUS_ORDRE"] } } },
          select: { feeCents: true, projectId: true },
        }),
      ]),
    ),
  );

  for (const [i, e] of project.experts.entries()) {
    const name = `Dr ${e.practitioner.user.firstName} ${e.practitioner.user.lastName}`;
    const [others, links] = perExpert[i];

    // 1. Engagement simultané par une autre organisation dans le même domaine. Les dossiers des autres
    // organisations sont confidentiels : seul un signal anonyme est donné (ni nom, ni titre, ni montant).
    if (project.therapeuticArea) {
      const orgs = new Set(others.map((o) => o.project.organizationId)).size;
      if (orgs > 0)
        out.push({
          kind: "concurrent", who: name, severity: "warn",
          detail: t(orgs > 1 ? "Collaboration en cours avec {n} autres organisations en {area}. Les détails restent confidentiels : demandez à l'expert de déclarer ses liens d'intérêts." : "Collaboration en cours avec une autre organisation en {area}. Les détails restent confidentiels : demandez à l'expert de déclarer ses liens d'intérêts.", { n: orgs, area: t(project.therapeuticArea) }),
        });
    }

    // 2. Structure bénéficiaire détenue majoritairement par le praticien.
    for (const s of e.practitioner.structures.filter((s) => s.isPayee && (s.sharePercent ?? 0) >= 50))
      out.push({ kind: "beneficiaire", who: name, severity: "info", detail: t("Rémunération versée à {name} ({form}), détenue à {share} % par le praticien.", { name: s.name, form: t(s.legalForm), share: s.sharePercent ?? 0 }) });

    // 3. Cumul annuel avec la même organisation.
    const total = links.reduce((s, l) => s + (l.feeCents ?? 0), 0) + (links.some((l) => l.projectId === project.id) ? 0 : e.feeCents ?? 0);
    if (total > CUMUL_ALERT_EUR * 100)
      out.push({ kind: "cumul", who: name, severity: "danger", detail: t("Cumul sur 12 mois avec cette organisation : {total} HT (seuil d'alerte {max}).", { total: fmtEur(locale, total), max: fmtEur(locale, CUMUL_ALERT_EUR * 100) }) });
  }

  // 4. Deux experts du dossier liés à une même structure.
  const byStructure = new Map<string, string[]>();
  for (const e of project.experts)
    for (const s of e.practitioner.structures) byStructure.set(s.name.toLowerCase(), [...(byStructure.get(s.name.toLowerCase()) ?? []), `Dr ${e.practitioner.user.lastName}`]);
  for (const [, who] of byStructure) if (who.length > 1) out.push({ kind: "structure", who: who.join(t(" et ")), severity: "warn", detail: t("{who} sont tous deux liés à une même structure juridique.", { who: who.join(t(" et ")) }) });

  return out;
}
