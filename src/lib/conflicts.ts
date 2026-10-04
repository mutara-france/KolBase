import "server-only";
import { db } from "@/lib/db";
import { CUMUL_ALERT_EUR } from "@/lib/projects";
import { formatEUR } from "@/lib/events";

export type Conflict = { kind: "concurrent" | "beneficiaire" | "structure" | "cumul"; who: string; detail: string; severity: "warn" | "danger" | "info" };

const CLOSED = ["TERMINE", "DECLINE", "REFUS_ORDRE"] as const;
const ENGAGED = { notIn: ["ATT_EXPERTS", "DECLINE"] as ("ATT_EXPERTS" | "DECLINE")[] };

/** Détection des conflits d'intérêts et points d'attention d'un dossier (reprise de « detectConflicts » du prototype). */
export async function detectConflicts(projectId: string): Promise<Conflict[]> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    include: { experts: { where: { status: { not: "DECLINE" } }, include: { practitioner: { include: { user: true, structures: true } } } } },
  });
  if (!project) return [];
  const out: Conflict[] = [];
  const yearAgo = new Date(Date.now() - 365 * 864e5);

  for (const e of project.experts) {
    const name = `Dr ${e.practitioner.user.firstName} ${e.practitioner.user.lastName}`;

    // 1. Engagement simultané par une autre organisation dans le même domaine.
    if (project.therapeuticArea) {
      const others = await db.projectExpert.findMany({
        where: {
          practitionerId: e.practitionerId, status: ENGAGED,
          project: { id: { not: project.id }, organizationId: { not: project.organizationId }, therapeuticArea: project.therapeuticArea, status: { notIn: [...CLOSED] } },
        },
        include: { project: { include: { organization: { select: { name: true } } } } },
      });
      for (const o of others)
        out.push({ kind: "concurrent", who: name, severity: "warn", detail: `Engagé simultanément par ${o.project.organization.name} en ${project.therapeuticArea} (« ${o.project.title} »).` });
    }

    // 2. Structure bénéficiaire détenue majoritairement par le praticien.
    for (const s of e.practitioner.structures.filter((s) => s.isPayee && (s.sharePercent ?? 0) >= 50))
      out.push({ kind: "beneficiaire", who: name, severity: "info", detail: `Rémunération versée à ${s.name} (${s.legalForm}), détenue à ${s.sharePercent} % par le praticien.` });

    // 3. Cumul annuel avec la même organisation.
    const links = await db.projectExpert.findMany({
      where: { practitionerId: e.practitionerId, status: ENGAGED, project: { organizationId: project.organizationId, createdAt: { gte: yearAgo }, status: { notIn: ["DECLINE", "REFUS_ORDRE"] } } },
      select: { feeCents: true, projectId: true },
    });
    const total = links.reduce((s, l) => s + (l.feeCents ?? 0), 0) + (links.some((l) => l.projectId === project.id) ? 0 : e.feeCents ?? 0);
    if (total > CUMUL_ALERT_EUR * 100)
      out.push({ kind: "cumul", who: name, severity: "danger", detail: `Cumul sur 12 mois avec cette organisation : ${formatEUR(total)} HT (seuil d'alerte ${formatEUR(CUMUL_ALERT_EUR * 100)}).` });
  }

  // 4. Deux experts du dossier liés à une même structure.
  const byStructure = new Map<string, string[]>();
  for (const e of project.experts)
    for (const s of e.practitioner.structures) byStructure.set(s.name.toLowerCase(), [...(byStructure.get(s.name.toLowerCase()) ?? []), `Dr ${e.practitioner.user.lastName}`]);
  for (const [, who] of byStructure) if (who.length > 1) out.push({ kind: "structure", who: who.join(" et "), severity: "warn", detail: `${who.join(" et ")} sont tous deux liés à une même structure juridique.` });

  return out;
}
