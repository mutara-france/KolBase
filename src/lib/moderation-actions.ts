"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit, getCurrentUser } from "@/lib/auth";
import { str } from "@/lib/form";
import { requirePlatformAdmin } from "@/lib/platform";
import { blockedFor, clientIp, hit } from "@/lib/rate-limit";
import { isReportReason, isReportTarget, plausibleEmail, REPORT_MAX_CHARS, REPORT_MIN_CHARS, REPORTS_PER_DAY, type ReportTarget } from "@/lib/moderation";
import { notifyPlatformAdmins, notifyReportDecision } from "@/lib/notifications";
import { getT } from "@/lib/i18n/server";

export type ActionState = { error?: string; ok?: string } | undefined;

/** Cible signalable (publique) : son libellé, ou null. */
async function target(type: ReportTarget, id: string) {
  if (type === "expert") {
    const p = await db.practitionerProfile.findFirst({ where: { id, listed: true }, select: { user: { select: { firstName: true, lastName: true } } } });
    return p ? `${p.user.firstName} ${p.user.lastName}` : null;
  }
  if (type === "organisation") return (await db.organization.findFirst({ where: { id, verification: "VERIFIED" }, select: { name: true } }))?.name ?? null;
  if (type === "evenement") return (await db.event.findFirst({ where: { id, publishedAt: { not: null } }, select: { title: true } }))?.title ?? null;
  // Le nom du client n'est pas public (avis anonymes) : il n'entre pas dans le libellé, repris dans les e-mails.
  const r = await db.supplierReview.findFirst({ where: { id, hiddenAt: null }, select: { supplier: { select: { name: true } } } });
  return r ? `Avis sur ${r.supplier.name}` : null;
}

/** Signalement d'un contenu public : par un compte, ou par une adresse e-mail (sans compte). */
export async function submitReport(_: ActionState, form: FormData): Promise<ActionState> {
  const { t } = await getT();
  const type = str(form, "type");
  const id = str(form, "id", 60);
  if (!isReportTarget(type)) return { error: t("Contenu introuvable.") };
  const label = await target(type, id);
  if (!label) return { error: t("Contenu introuvable.") };
  const reason = str(form, "reason");
  if (!isReportReason(reason)) return { error: t("Choisissez le motif du signalement.") };
  const details = str(form, "details", REPORT_MAX_CHARS);
  if (details.length < REPORT_MIN_CHARS) return { error: t("Décrivez ce qui pose problème (10 caractères au moins).") };
  const user = await getCurrentUser();
  const email = user ? null : str(form, "email", 254).toLowerCase();
  if (!user && !(email && plausibleEmail(email))) return { error: t("Indiquez votre adresse e-mail : la décision vous y est envoyée.") };
  const ip = await clientIp();
  const who = `report:${user?.id ?? email}`;
  if ((await blockedFor(who, REPORTS_PER_DAY, 86400e3)) || (await blockedFor(`report-ip:${ip}`, REPORTS_PER_DAY * 2, 86400e3)))
    return { error: t("Trop de signalements en 24 heures : écrivez à l'équipe KolBase.") };
  await hit(who);
  await hit(`report-ip:${ip}`);
  const r = await db.report.create({ data: { targetType: type, targetId: id, targetLabel: label.slice(0, 200), reason, details, reporterId: user?.id ?? null, reporterEmail: email } });
  await audit(user?.id ?? null, "report.submit", "Report", r.id, { targetType: type, targetId: id });
  notifyPlatformAdmins(`Signalement : ${label}`, `Un contenu a été signalé (${type}) : « ${label} ». Examinez-le dans le registre des signalements.`, "/admin/signalements");
  revalidatePath("/admin/signalements");
  return { ok: t("Signalement transmis à l'équipe KolBase : la décision vous est communiquée par e-mail.") };
}

/**
 * Décision motivée sur un signalement : contenu retiré (présentation, description) ou avis masqué, ou sans suite.
 * Le contenu retiré est conservé dans le journal (contestation) ; l'auteur du signalement et celui du contenu sont prévenus.
 */
export async function handleReport(_: ActionState, form: FormData): Promise<ActionState> {
  const admin = await requirePlatformAdmin();
  const r = await db.report.findFirst({ where: { id: str(form, "reportId"), status: "open" } });
  if (!r || !isReportTarget(r.targetType)) return { error: "Signalement introuvable ou déjà traité." };
  const decision = str(form, "decision");
  if (decision !== "retire" && decision !== "sans_suite") return { error: "Choisissez une décision." };
  const note = str(form, "note", 2000);
  if (!note) return { error: "La décision est motivée : indiquez le motif, il est communiqué." };
  let removed: string | null = null;
  if (decision === "retire") {
    if (r.targetType === "avis") {
      const rev = await db.supplierReview.findUnique({ where: { id: r.targetId }, select: { comment: true, supplierId: true } });
      if (!rev) return { error: "Avis introuvable." };
      await db.supplierReview.update({ where: { id: r.targetId }, data: { hiddenAt: new Date(), hiddenReason: note } });
      removed = rev.comment;
      revalidatePath(`/structures/${rev.supplierId}`);
    } else if (r.targetType === "expert") {
      const p = await db.practitionerProfile.findUnique({ where: { id: r.targetId }, select: { bio: true } });
      if (!p) return { error: "Profil introuvable." };
      await db.practitionerProfile.update({ where: { id: r.targetId }, data: { bio: null } });
      removed = p.bio;
      revalidatePath(`/experts/${r.targetId}`);
    } else if (r.targetType === "organisation") {
      const o = await db.organization.findUnique({ where: { id: r.targetId }, select: { about: true } });
      if (!o) return { error: "Organisation introuvable." };
      await db.organization.update({ where: { id: r.targetId }, data: { about: null } });
      removed = o.about;
      revalidatePath(`/structures/${r.targetId}`);
    } else {
      const e = await db.event.findUnique({ where: { id: r.targetId }, select: { description: true } });
      if (!e) return { error: "Événement introuvable." };
      await db.event.update({ where: { id: r.targetId }, data: { description: null } });
      removed = e.description;
      revalidatePath(`/evenements/${r.targetId}`);
    }
  }
  await db.report.update({ where: { id: r.id }, data: { status: "closed", decision, decisionNote: note, handledById: admin.id, handledAt: new Date() } });
  await audit(admin.id, `admin.report_${decision}`, "Report", r.id, { targetType: r.targetType, targetId: r.targetId, note, ...(removed ? { removed: removed.slice(0, 5000) } : {}) });
  notifyReportDecision(r.id);
  revalidatePath("/admin/signalements");
  return { ok: decision === "retire" ? "Contenu retiré : l'auteur du signalement et celui du contenu sont prévenus." : "Signalement classé sans suite : son auteur est prévenu." };
}

/** Avis masqué rétabli (contestation fondée de son auteur). */
export async function restoreReview(form: FormData) {
  const admin = await requirePlatformAdmin();
  const rev = await db.supplierReview.findFirst({ where: { id: str(form, "reviewId"), hiddenAt: { not: null } }, select: { id: true, supplierId: true } });
  if (!rev) return;
  await db.supplierReview.update({ where: { id: rev.id }, data: { hiddenAt: null, hiddenReason: null } });
  await audit(admin.id, "admin.review_restore", "SupplierReview", rev.id);
  revalidatePath(`/structures/${rev.supplierId}`);
  revalidatePath("/admin/signalements");
}
