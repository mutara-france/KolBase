"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit, requireUser } from "@/lib/auth";
import { requireMembership } from "@/lib/orgs";
import { PROJECT_ROLES } from "@/lib/projects";
import { eurToCents, str } from "@/lib/form";
import { parisToday, parseParisDateTime } from "@/lib/events";
import { notifyFeePaid, notifyTransparencyIssue } from "@/lib/notifications";
import { blockedFor, hit } from "@/lib/rate-limit";
import { getT } from "@/lib/i18n/server";

export type FormState = { error?: string; ok?: string } | undefined;

// ─── Praticien ──────────────────────────────────────────────────────────────

/** Lien d'intérêts noué hors de KolBase, pour compléter la déclaration. */
export async function addDeclaredInterest(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const { t } = await getT();
  const p = user.practitioner;
  if (!p) return { error: t("Réservé aux praticiens.") };
  const organization = str(form, "organization").slice(0, 120);
  const nature = str(form, "nature").slice(0, 200);
  const year = new Date().getFullYear();
  const startYear = Number(str(form, "startYear"));
  const endRaw = str(form, "endYear");
  const endYear = endRaw ? Number(endRaw) : null;
  if (!organization || !nature) return { error: t("Indiquez l'organisation et la nature du lien.") };
  if (!Number.isInteger(startYear) || startYear < 1980 || startYear > year) return { error: t("Année de début invalide.") };
  if (endYear != null && (!Number.isInteger(endYear) || endYear < startYear || endYear > year)) return { error: t("Année de fin invalide.") };
  if ((await db.declaredInterest.count({ where: { practitionerId: p.id } })) >= 100) return { error: t("Trop de liens déclarés.") };
  const d = await db.declaredInterest.create({ data: { practitionerId: p.id, organization, nature, startYear, endYear } });
  await audit(user.id, "interest.add", "DeclaredInterest", d.id);
  revalidatePath("/revenus");
  return { ok: t("Lien ajouté.") };
}

export async function removeDeclaredInterest(form: FormData) {
  const user = await requireUser();
  if (!user.practitioner) return;
  const { count } = await db.declaredInterest.deleteMany({ where: { id: str(form, "id"), practitionerId: user.practitioner.id } });
  if (count) await audit(user.id, "interest.remove", "DeclaredInterest", str(form, "id"));
  revalidatePath("/revenus");
}

/** Signaler une erreur dans ce qu'une organisation déclare (ou va déclarer) à son nom sur Transparence Santé. */
export async function reportTransparencyIssue(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const { t } = await getT();
  const p = user.practitioner;
  if (!p) return { error: t("Réservé aux praticiens.") };
  const comment = str(form, "comment").slice(0, 2000);
  if (comment.length < 10) return { error: t("Décrivez l'erreur en quelques mots.") };
  const key = `transparence:${user.id}`;
  if (blockedFor(key, 10, 60 * 60 * 1000)) return { error: t("Trop de signalements : réessayez plus tard.") };
  const kind = str(form, "kind");
  const id = str(form, "id");
  let target: { orgId: string; label: string } | null = null;
  if (kind === "convention") {
    const l = await db.projectExpert.findFirst({ where: { id, practitionerId: p.id }, include: { project: true } });
    if (l) target = { orgId: l.project.organizationId, label: `Convention « ${l.project.title} »` };
  } else if (kind === "hospitalite") {
    const r = await db.registration.findFirst({ where: { id, userId: user.id }, include: { event: true } });
    if (r) target = { orgId: r.event.organizationId, label: `Hospitalités de l'événement « ${r.event.title} »` };
  }
  if (!target) return { error: t("Élément introuvable.") };
  hit(key);
  await audit(user.id, "transparency.report", kind === "convention" ? "ProjectExpert" : "Registration", id, { orgId: target.orgId });
  notifyTransparencyIssue(target.orgId, `${user.firstName} ${user.lastName}`, target.label, comment);
  return { ok: t("Signalement envoyé à l'équipe conformité de l'organisation.") };
}

// ─── Organisation ───────────────────────────────────────────────────────────

/** Honoraires payés (ou paiement annulé) : l'expert le voit dans « Mes revenus » et en est prévenu. */
export async function markExpertPaid(form: FormData) {
  const orgId = str(form, "orgId");
  const { user } = await requireMembership(orgId, PROJECT_ROLES);
  const link = await db.projectExpert.findFirst({ where: { id: str(form, "linkId"), project: { organizationId: orgId }, status: { in: ["SIGNE", "TERMINE"] } } });
  if (!link) return;
  if (form.get("undo") === "1") {
    await db.projectExpert.update({ where: { id: link.id }, data: { paidAt: null, paidCents: null } });
    await audit(user.id, "expert.unpaid", "ProjectExpert", link.id);
  } else {
    const cents = eurToCents(str(form, "amount"), { allowZero: false }) ?? link.feeCents;
    // Paiement daté du jour : l'heure courante (midi à Paris serait « dans le futur » le matin).
    const now = new Date();
    const dateRaw = str(form, "date");
    if (dateRaw > parisToday(now)) return;
    const date = !dateRaw || dateRaw === parisToday(now) ? now : parseParisDateTime(`${dateRaw}T12:00`);
    if (!cents || !date) return;
    await db.projectExpert.update({ where: { id: link.id }, data: { paidAt: date, paidCents: cents } });
    await audit(user.id, "expert.paid", "ProjectExpert", link.id, { cents });
    notifyFeePaid(link.id);
  }
  revalidatePath(`/organisations/${orgId}/dossiers/${link.projectId}`);
}
