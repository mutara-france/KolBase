"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/auth";
import { requireMembership } from "@/lib/orgs";
import { COMPLIANCE_ROLES } from "@/lib/events";
import { SETTING_FIELDS, complianceSettings, legalBound } from "@/lib/compliance";
import { declarationRows, parseSemester, semesterKey } from "@/lib/transparence";
import { str } from "@/lib/form";
import { getT } from "@/lib/i18n/server";

export type ActionState = { error?: string; ok?: string } | undefined;

export async function updateComplianceSettings(_: ActionState, form: FormData): Promise<ActionState> {
  const { t } = await getT();
  const orgId = str(form, "orgId");
  const { user } = await requireMembership(orgId, COMPLIANCE_ROLES);
  const raw: Record<string, number> = {};
  for (const f of SETTING_FIELDS) {
    const v = Number(str(form, f.key).replace(",", "."));
    if (!Number.isFinite(v) || v < 0) return { error: t("Valeur invalide : {label}.", { label: f.label }) };
    const bound = legalBound(f.key);
    if (bound?.max != null && v > bound.max) return { error: t("{label} : {max} {unit} au maximum (seuil réglementaire, qui ne peut qu'être abaissé).", { label: f.label, max: bound.max, unit: f.unit }) };
    if (bound?.min != null && v < bound.min) return { error: t("{label} : {min} {unit} au minimum (délai réglementaire, qui ne peut qu'être allongé).", { label: f.label, min: bound.min, unit: f.unit }) };
    raw[f.key] = v;
  }
  const settings = complianceSettings(raw);
  await db.organization.update({ where: { id: orgId }, data: { complianceSettings: settings } });
  await audit(user.id, "compliance.settings", "Organization", orgId, settings);
  revalidatePath(`/organisations/${orgId}/conformite`);
  return { ok: t("Paramètres enregistrés.") };
}

/** Marque la publication Transparence Santé d'un dossier (convention et rémunérations). */
export async function markProjectPublished(form: FormData) {
  const orgId = str(form, "orgId");
  const { user } = await requireMembership(orgId, COMPLIANCE_ROLES);
  const projectId = str(form, "projectId");
  const undo = form.get("undo") === "1";
  // Seule une convention signée se publie sur Transparence Santé ; l'annulation reste toujours possible.
  const { count } = await db.project.updateMany({
    where: { id: projectId, organizationId: orgId, ...(undo ? {} : { status: { in: ["SIGNE", "TERMINE"] } }) },
    data: undo ? { declared: false, declarationRef: null, declaredAt: null } : { declared: true, declarationRef: str(form, "ref") || null, declaredAt: new Date() },
  });
  if (!count) return;
  await audit(user.id, undo ? "project.unpublish" : "project.publish", "Project", projectId, { ref: str(form, "ref") || undefined });
  revalidatePath(`/organisations/${orgId}/conformite`);
}

/** Toutes les déclarations du fichier d'un semestre marquées publiées (après dépôt sur la plateforme). */
export async function markSemesterPublished(form: FormData) {
  const orgId = str(form, "orgId");
  const { user } = await requireMembership(orgId, COMPLIANCE_ROLES);
  const s = parseSemester(str(form, "periode"));
  if (!s) return;
  const r = await declarationRows(orgId, s);
  const ref = str(form, "ref").slice(0, 80) || null;
  const now = new Date();
  await db.project.updateMany({ where: { id: { in: r.projectIds }, organizationId: orgId }, data: { declared: true, declarationRef: ref, declaredAt: now } });
  await db.registration.updateMany({ where: { id: { in: r.registrationIds }, event: { organizationId: orgId } }, data: { declared: true, declarationRef: ref } });
  await audit(user.id, "transparence.publish", "Organization", orgId, { periode: semesterKey(s), dossiers: r.projectIds.length, hospitalites: r.registrationIds.length, ref: ref ?? undefined });
  revalidatePath(`/organisations/${orgId}/conformite`);
  revalidatePath(`/organisations/${orgId}/hospitalites`);
}
