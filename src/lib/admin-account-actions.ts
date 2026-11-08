"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/auth";
import { str } from "@/lib/form";
import { platformAdminEmails, requirePlatformAdmin } from "@/lib/platform";
import { mailEnabled, sendLater } from "@/lib/mail";
import { sendVerification } from "@/lib/verification";
import { LEGAL } from "@/lib/legal";

/**
 * Actions de l'équipe KolBase sur un compte (fiche /admin/comptes/[id]) : renvoyer le lien de confirmation d'adresse,
 * réinitialiser la double authentification (téléphone perdu), désactiver puis réactiver un compte. Chacune est
 * inscrite au journal d'activité ; la réinitialisation et la désactivation exigent un motif et préviennent la personne.
 */

const done = (userId: string, what: string): never => {
  revalidatePath("/admin", "layout");
  redirect(`/admin/comptes/${userId}?fait=${what}`);
};

const contact = () => LEGAL.contactEmail ?? "contact@kolbase.io";

export async function resendAccountVerification(form: FormData) {
  const admin = await requirePlatformAdmin();
  const u = await db.user.findUnique({ where: { id: str(form, "userId") }, include: { practitioner: { select: { id: true } } } });
  if (!u || u.emailVerifiedAt || u.disabledAt) return;
  if (!mailEnabled()) done(u.id, "sans-envoi");
  await sendVerification(u, !!u.practitioner);
  await audit(admin.id, "admin.verification_resend", "User", u.id);
  done(u.id, "lien");
}

export async function resetAccountTwoFactor(form: FormData) {
  const admin = await requirePlatformAdmin();
  const note = str(form, "note", 300);
  const u = await db.user.findUnique({ where: { id: str(form, "userId") } });
  // Sa propre double authentification se gère depuis « Mon compte » (mot de passe demandé).
  if (!u || !u.totpEnabledAt || !note || u.id === admin.id) return;
  await db.$transaction([
    db.user.update({ where: { id: u.id }, data: { totpSecret: null, totpEnabledAt: null, totpLastStep: null, recoveryCodes: [] } }),
    db.session.deleteMany({ where: { userId: u.id } }),
  ]);
  await audit(admin.id, "admin.2fa_reset", "User", u.id, { note });
  sendLater({
    to: u.email,
    subject: "Sécurité de votre compte KolBase",
    text: `Bonjour ${u.firstName},\n\nL'équipe KolBase a réinitialisé la double authentification de votre compte (motif : ${note}). Vos sessions ouvertes ont été fermées : reconnectez-vous avec votre mot de passe, puis activez-la de nouveau depuis « Mon compte ». Si l'une de vos organisations l'exige, elle vous sera demandée dès la connexion.\n\nSi vous n'êtes pas à l'origine de cette demande, écrivez-nous à ${contact()}.`,
    cta: { label: "Mon compte", href: "/compte#securite" },
  });
  done(u.id, "2fa");
}

export async function setAccountDisabled(form: FormData) {
  const admin = await requirePlatformAdmin();
  const decision = str(form, "decision");
  const note = str(form, "note", 300);
  const u = await db.user.findUnique({ where: { id: str(form, "userId") }, include: { practitioner: { select: { id: true, listed: true } } } });
  if (!u || u.id === admin.id) return;
  if (decision === "disable") {
    // Un administrateur KolBase se retire d'abord de PLATFORM_ADMIN_EMAILS ; une désactivation est toujours motivée.
    if (u.disabledAt || !note || platformAdminEmails().includes(u.email.toLowerCase())) return;
    const now = new Date();
    await db.$transaction([
      db.user.update({ where: { id: u.id }, data: { disabledAt: now, disabledNote: note } }),
      db.session.deleteMany({ where: { userId: u.id } }),
      // Liens reçus par e-mail (réinitialisation, confirmation) : plus utilisables.
      db.authToken.updateMany({ where: { userId: u.id, usedAt: null }, data: { usedAt: now } }),
      // Une fiche d'expert ne reste pas dans l'annuaire public ; la personne la republie après réactivation.
      ...(u.practitioner?.listed ? [db.practitionerProfile.update({ where: { id: u.practitioner.id }, data: { listed: false } })] : []),
    ]);
    await audit(admin.id, "admin.account_disable", "User", u.id, { note, unlisted: !!u.practitioner?.listed });
    sendLater({
      to: u.email,
      subject: "Votre compte KolBase est désactivé",
      text: `Bonjour ${u.firstName},\n\nL'équipe KolBase a désactivé votre compte (motif : ${note}). Vous ne pouvez plus vous y connecter ; vos données sont conservées.\n\nPour en savoir plus ou demander sa réactivation, écrivez-nous à ${contact()}.`,
    });
    done(u.id, "desactive");
  }
  if (decision === "enable") {
    if (!u.disabledAt) return;
    await db.user.update({ where: { id: u.id }, data: { disabledAt: null, disabledNote: null } });
    await audit(admin.id, "admin.account_enable", "User", u.id, note ? { note } : undefined);
    sendLater({
      to: u.email,
      subject: "Votre compte KolBase est réactivé",
      text: `Bonjour ${u.firstName},\n\nL'équipe KolBase a réactivé votre compte : vous pouvez de nouveau vous connecter.${u.practitioner ? " Si vous étiez référencé comme expert, republiez votre fiche depuis « Mon compte »." : ""}`,
      cta: { label: "Me connecter", href: "/connexion" },
    });
    done(u.id, "reactive");
  }
}
