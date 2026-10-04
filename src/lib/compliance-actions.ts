"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/auth";
import { requireMembership } from "@/lib/orgs";
import { COMPLIANCE_ROLES } from "@/lib/events";
import { SETTING_FIELDS, complianceSettings } from "@/lib/compliance";

export type ActionState = { error?: string; ok?: string } | undefined;
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

export async function updateComplianceSettings(_: ActionState, form: FormData): Promise<ActionState> {
  const orgId = str(form, "orgId");
  const { user } = await requireMembership(orgId, COMPLIANCE_ROLES);
  const raw: Record<string, number> = {};
  for (const f of SETTING_FIELDS) {
    const v = Number(str(form, f.key).replace(",", "."));
    if (!Number.isFinite(v) || v < 0) return { error: `Valeur invalide : ${f.label}.` };
    raw[f.key] = v;
  }
  const settings = complianceSettings(raw);
  await db.organization.update({ where: { id: orgId }, data: { complianceSettings: settings } });
  await audit(user.id, "compliance.settings", "Organization", orgId, settings);
  revalidatePath(`/organisations/${orgId}/conformite`);
  return { ok: "Paramètres enregistrés." };
}

/** Marque la publication Transparence Santé d'un dossier (convention et rémunérations). */
export async function markProjectPublished(form: FormData) {
  const orgId = str(form, "orgId");
  const { user } = await requireMembership(orgId, COMPLIANCE_ROLES);
  const projectId = str(form, "projectId");
  const undo = form.get("undo") === "1";
  await db.project.updateMany({
    where: { id: projectId, organizationId: orgId },
    data: undo ? { declared: false, declarationRef: null, declaredAt: null } : { declared: true, declarationRef: str(form, "ref") || null, declaredAt: new Date() },
  });
  await audit(user.id, undo ? "project.unpublish" : "project.publish", "Project", projectId, { ref: str(form, "ref") || undefined });
  revalidatePath(`/organisations/${orgId}/conformite`);
}
