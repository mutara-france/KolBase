"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit, requireUser } from "@/lib/auth";
import { requireMembership } from "@/lib/orgs";
import { dayOrNull, eurToCents, str, unitsOrNull } from "@/lib/form";
import { PROJECT_ROLES } from "@/lib/projects";
import { deleteObject, matchesType, MAX_UPLOAD_BYTES, putObject, safeFileName, storageEnabled } from "@/lib/storage";
import { getT } from "@/lib/i18n/server";
import { EXPENSE_MAX_CENTS, expensesOpen, frameworkStart, frameworkUsage, isExpenseCategory, missionError } from "@/lib/expert-costs";
import { hasBooking, readTravel } from "@/lib/travel";
import { notifyExpertExpenseDecided, notifyExpertExpenseSubmitted, notifyExpertTravel } from "@/lib/notifications";

export type ActionState = { error?: string; ok?: string } | undefined;

/** Justificatifs acceptés : PDF, photo (JPEG, PNG). */
const PROOF_TYPES = ["application/pdf", "image/jpeg", "image/png"];
/** Nombre de notes de frais par collaboration (garde-fou). */
const MAX_EXPENSES_PER_LINK = 60;

const refresh = (orgId: string, projectId: string, linkId: string) => {
  revalidatePath(`/organisations/${orgId}/dossiers/${projectId}`);
  revalidatePath(`/sollicitations/${linkId}`);
};

/** Note de frais déposée par l'expert sur sa collaboration (convention en signature, signée ou prestation réalisée). */
export async function submitExpertExpense(_: ActionState, form: FormData): Promise<ActionState> {
  const { t } = await getT();
  const user = await requireUser();
  const link = await db.projectExpert.findFirst({ where: { id: str(form, "linkId"), practitioner: { userId: user.id } }, include: { project: { select: { id: true, organizationId: true, status: true } } } });
  if (!link) return { error: t("Collaboration introuvable.") };
  if (!expensesOpen(link.status, link.project.status)) return { error: t("Les notes de frais s'ouvrent avec la signature de la convention.") };
  if ((await db.expertExpense.count({ where: { projectExpertId: link.id } })) >= MAX_EXPENSES_PER_LINK) return { error: t("Nombre maximal de notes de frais atteint pour cette collaboration : écrivez à l'organisation.") };
  const category = str(form, "category");
  if (!isExpenseCategory(category)) return { error: t("Nature du frais invalide.") };
  const label = str(form, "label", 160);
  if (!label) return { error: t("Décrivez le frais (trajet, hôtel, repas…).") };
  const date = dayOrNull(str(form, "date"));
  if (!date) return { error: t("Indiquez la date du frais.") };
  const now = Date.now();
  if (date.getTime() > now + 86400e3 || date.getTime() < now - 366 * 86400e3) return { error: t("Date du frais invalide : dans l'année écoulée.") };
  const amountCents = eurToCents(str(form, "amount"), { allowZero: false });
  if (!amountCents || amountCents > EXPENSE_MAX_CENTS) return { error: t("Montant invalide : de 0,01 € à 5 000 € TTC.") };

  // Justificatif : obligatoire dès que le stockage des documents est configuré.
  const file = form.get("proof");
  const hasFile = file instanceof File && file.size > 0;
  if (storageEnabled() && !hasFile) return { error: t("Joignez le justificatif (PDF ou photo).") };
  let documentId: string | null = null;
  if (hasFile && storageEnabled()) {
    if (file.size > MAX_UPLOAD_BYTES) return { error: t("Fichier trop lourd : 10 Mo au maximum.") };
    if (!PROOF_TYPES.includes(file.type)) return { error: t("Justificatif : PDF, JPEG ou PNG.") };
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!matchesType(file.type, bytes)) return { error: t("Justificatif : PDF, JPEG ou PNG.") };
    const key = `dossiers/${link.projectId}/frais-${randomBytes(8).toString("hex")}-${safeFileName(file.name)}`;
    await putObject(key, bytes, file.type);
    const doc = await db.document.create({
      data: { projectId: link.projectId, projectExpertId: link.id, kind: "JUSTIFICATIF", name: file.name.slice(0, 200), contentType: file.type, size: file.size, storageKey: key, uploadedById: user.id },
    });
    documentId = doc.id;
  }
  const e = await db.expertExpense.create({ data: { projectExpertId: link.id, category, label, date, amountCents, documentId } });
  await audit(user.id, "expert_expense.submit", "ProjectExpert", link.id, { expenseId: e.id, amount: amountCents, category });
  notifyExpertExpenseSubmitted(e.id);
  refresh(link.project.organizationId, link.projectId, link.id);
  return { ok: t("Note de frais envoyée : l'organisation l'examine.") };
}

/** Retrait d'une note de frais par l'expert, tant qu'elle n'a pas été examinée. */
export async function withdrawExpertExpense(form: FormData) {
  const user = await requireUser();
  const e = await db.expertExpense.findFirst({ where: { id: str(form, "expenseId"), status: "submitted", projectExpert: { practitioner: { userId: user.id } } }, include: { projectExpert: { select: { id: true, projectId: true, project: { select: { organizationId: true } } } } } });
  if (!e) return;
  await db.expertExpense.delete({ where: { id: e.id } });
  if (e.documentId) {
    const doc = await db.document.findUnique({ where: { id: e.documentId } });
    if (doc) {
      await db.document.delete({ where: { id: doc.id } });
      await deleteObject(doc.storageKey).catch((err) => console.error("[stockage] suppression impossible", doc.storageKey, err));
    }
  }
  await audit(user.id, "expert_expense.withdraw", "ProjectExpert", e.projectExpertId, { expenseId: e.id });
  refresh(e.projectExpert.project.organizationId, e.projectExpert.projectId, e.projectExpert.id);
}

/** Frais d'un dossier de l'organisation (équipe Projets). */
async function orgExpense(orgId: string, expenseId: string) {
  const { user } = await requireMembership(orgId, PROJECT_ROLES);
  const e = await db.expertExpense.findFirst({ where: { id: expenseId, projectExpert: { project: { organizationId: orgId } } }, include: { projectExpert: { select: { id: true, projectId: true } } } });
  return { user, e };
}

/** Examen d'une note de frais : acceptée (à rembourser) ou refusée avec un motif, transmis à l'expert. */
export async function decideExpertExpense(_: ActionState, form: FormData): Promise<ActionState> {
  const { t } = await getT();
  const orgId = str(form, "orgId");
  const { user, e } = await orgExpense(orgId, str(form, "expenseId"));
  if (!e || e.status !== "submitted") return { error: t("Note de frais introuvable ou déjà examinée.") };
  const decision = str(form, "decision");
  const note = str(form, "note", 500) || null;
  if (decision !== "approve" && decision !== "reject") return { error: t("Décision invalide.") };
  if (decision === "reject" && !note) return { error: t("Indiquez le motif du refus : il est transmis à l'expert.") };
  const status = decision === "approve" ? "approved" : "rejected";
  await db.expertExpense.update({ where: { id: e.id }, data: { status, decidedById: user.id, decidedAt: new Date(), decisionNote: note } });
  await audit(user.id, `expert_expense.${status}`, "ProjectExpert", e.projectExpertId, { expenseId: e.id, amount: e.amountCents, note });
  notifyExpertExpenseDecided(e.id);
  refresh(orgId, e.projectExpert.projectId, e.projectExpertId);
  return { ok: status === "approved" ? t("Note de frais acceptée : à rembourser.") : t("Note de frais refusée : l'expert est prévenu.") };
}

/** Remboursement effectué (virement) : le frais rejoint les avantages à déclarer avec la convention. */
export async function markExpertExpensePaid(form: FormData) {
  const orgId = str(form, "orgId");
  const { user, e } = await orgExpense(orgId, str(form, "expenseId"));
  if (!e || e.status !== "approved") return;
  await db.expertExpense.update({ where: { id: e.id }, data: { status: "paid", paidAt: new Date() } });
  await audit(user.id, "expert_expense.paid", "ProjectExpert", e.projectExpertId, { expenseId: e.id, amount: e.amountCents });
  notifyExpertExpenseDecided(e.id);
  refresh(orgId, e.projectExpert.projectId, e.projectExpertId);
}

/** Billets et hébergement réservés pour un expert ; envoyés par e-mail si demandé (et visibles dans son espace). */
export async function saveExpertTravel(_: ActionState, form: FormData): Promise<ActionState> {
  const { t } = await getT();
  const orgId = str(form, "orgId");
  const { user } = await requireMembership(orgId, PROJECT_ROLES);
  const link = await db.projectExpert.findFirst({ where: { id: str(form, "linkId"), project: { organizationId: orgId }, status: { notIn: ["ATT_EXPERTS", "DECLINE"] } }, select: { id: true, projectId: true } });
  if (!link) return { error: t("Expert introuvable sur ce dossier.") };
  const data = readTravel(form);
  if ("error" in data) return { error: t(data.error) };
  const send = form.get("send") === "on" && hasBooking(data);
  await db.expertTravel.upsert({ where: { projectExpertId: link.id }, create: { projectExpertId: link.id, ...data, sentAt: send ? new Date() : null }, update: { ...data, ...(send ? { sentAt: new Date() } : {}) } });
  await audit(user.id, "expert_travel.save", "ProjectExpert", link.id, { sent: send });
  if (send) notifyExpertTravel(link.id);
  refresh(orgId, link.projectId, link.id);
  return { ok: send ? t("Voyage enregistré et envoyé à l'expert.") : t("Voyage enregistré : visible dans l'espace de l'expert.") };
}

/** Mission réalisée dans le cadre d'un contrat-cadre signé : date, objet, unités (dans la limite de la convention). */
export async function addFrameworkMission(_: ActionState, form: FormData): Promise<ActionState> {
  const { t } = await getT();
  const orgId = str(form, "orgId");
  const { user } = await requireMembership(orgId, PROJECT_ROLES);
  const link = await db.projectExpert.findFirst({
    where: { id: str(form, "linkId"), project: { organizationId: orgId }, status: { notIn: ["ATT_EXPERTS", "DECLINE"] } },
    include: { project: { select: { id: true, framework: true, periodEnd: true, plannedAt: true, createdAt: true, status: true } }, missions: { select: { units: true } } },
  });
  if (!link) return { error: t("Expert introuvable sur ce dossier.") };
  if (!link.project.framework || !link.project.periodEnd) return { error: t("Ce dossier n'est pas un contrat-cadre.") };
  if (link.project.status !== "SIGNE") return { error: t("Les missions se consignent une fois le contrat-cadre signé, jusqu'à sa clôture.") };
  const date = dayOrNull(str(form, "date"));
  if (!date) return { error: t("Indiquez la date de la mission.") };
  const label = str(form, "label", 200);
  if (!label) return { error: t("Indiquez l'objet de la mission.") };
  const units = unitsOrNull(str(form, "units"));
  if (units == null) return { error: t("Nombre d'unités invalide.") };
  const usage = frameworkUsage(link.days, link.missions);
  const err = missionError({ date, units }, { start: frameworkStart(link.project), end: link.project.periodEnd }, usage.remaining);
  if (err) return { error: t(err) };
  const m = await db.frameworkMission.create({ data: { projectExpertId: link.id, date, label, units, createdById: user.id } });
  await audit(user.id, "framework.mission", "ProjectExpert", link.id, { missionId: m.id, units, label });
  refresh(orgId, link.projectId, link.id);
  return { ok: t("Mission consignée.") };
}

export async function removeFrameworkMission(form: FormData) {
  const orgId = str(form, "orgId");
  const { user } = await requireMembership(orgId, PROJECT_ROLES);
  const m = await db.frameworkMission.findFirst({ where: { id: str(form, "missionId"), projectExpert: { project: { organizationId: orgId, status: "SIGNE" } } }, include: { projectExpert: { select: { id: true, projectId: true } } } });
  if (!m) return;
  await db.frameworkMission.delete({ where: { id: m.id } });
  await audit(user.id, "framework.mission_remove", "ProjectExpert", m.projectExpertId, { missionId: m.id, label: m.label });
  refresh(orgId, m.projectExpert.projectId, m.projectExpertId);
}
