"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit, createSession, requireUser } from "@/lib/auth";
import { confirmPassword, tooManyAttempts } from "@/lib/password-check";
import { blockedFor, hit, reset } from "@/lib/rate-limit";
import { safeNext } from "@/lib/safe-redirect";
import { requireMembership } from "@/lib/orgs";
import { str } from "@/lib/form";
import { sendLater } from "@/lib/mail";
import { consumeToken, findToken } from "@/lib/tokens";
import { getT } from "@/lib/i18n/server";
import { isPlatformAdmin } from "@/lib/platform";
import { hashRecovery, looksLikeRecovery, newRecoveryCodes, newSecret, verifyTotp } from "@/lib/totp";
import { adminTwoFactorRequired, PENDING_COOKIE, requiringOrgs } from "@/lib/two-factor";

export type FormState = { error?: string; ok?: string } | undefined;
export type CodesState = { error?: string; ok?: string; codes?: string[] } | undefined;

// Cinq essais par quart d'heure : au-delà, il faut attendre (le jeton d'étape expire au bout de 10 minutes).
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;

/** Avis de sécurité envoyé au titulaire du compte à chaque changement. */
function securityNotice(user: { email: string; firstName: string; locale?: string }, what: string) {
  sendLater({
    to: user.email,
    subject: "Sécurité de votre compte KolBase",
    text: `Bonjour ${user.firstName},\n\n${what}\n\nSi vous n'êtes pas à l'origine de cette opération, changez votre mot de passe et écrivez-nous en réponse à ce message.`,
    cta: { label: "Mon compte", href: "/compte#securite" },
  });
}

/** Code de l'application ou code de secours : renvoie le moyen accepté, et met à jour le compte (code consommé). */
async function checkSecondFactor(user: { id: string; totpSecret: string | null; totpLastStep: number | null; recoveryCodes: string[] }, code: string) {
  if (!user.totpSecret) return null;
  if (looksLikeRecovery(code)) {
    const h = hashRecovery(code);
    if (!user.recoveryCodes.includes(h)) return null;
    await db.user.update({ where: { id: user.id }, data: { recoveryCodes: user.recoveryCodes.filter((x) => x !== h) } });
    return "recovery" as const;
  }
  const step = verifyTotp(user.totpSecret, code, { lastStep: user.totpLastStep });
  if (step == null) return null;
  // Compare-and-set : deux envois simultanés du même code ne passent pas tous les deux.
  const { count } = await db.user.updateMany({ where: { id: user.id, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] }, data: { totpLastStep: step } });
  return count === 1 ? ("totp" as const) : null;
}

/** Connexion, seconde étape : code de l'application (ou code de secours) après le mot de passe. */
export async function verifySecondFactor(_: FormState, form: FormData): Promise<FormState> {
  const { t } = await getT();
  const jar = await cookies();
  const pending = await findToken(jar.get(PENDING_COOKIE)?.value ?? "", "TWO_FACTOR");
  if (!pending || !pending.user.totpEnabledAt) return { error: t("Délai dépassé : reconnectez-vous avec votre mot de passe.") };
  const key = `2fa:${pending.userId}`;
  const wait = await blockedFor(key, MAX_FAILURES, WINDOW_MS);
  if (wait) return { error: t("Trop de tentatives. Réessayez dans {n} minutes.", { n: wait }) };
  const how = await checkSecondFactor(pending.user, str(form, "code"));
  if (!how) {
    await hit(key);
    await audit(pending.userId, "user.2fa_failed", "User", pending.userId);
    return { error: t("Code incorrect ou déjà utilisé. Saisissez le code affiché par votre application.") };
  }
  await reset(key);
  await consumeToken(pending.id, pending.userId, "TWO_FACTOR");
  jar.delete(PENDING_COOKIE);
  await audit(pending.userId, "user.signin", "User", pending.userId, { twoFactor: how });
  if (how === "recovery") {
    const left = pending.user.recoveryCodes.length - 1;
    securityNotice(pending.user, `Un code de secours vient d'être utilisé pour vous connecter. Il vous en reste ${left}.${left <= 3 ? " Générez-en de nouveaux depuis « Mon compte »." : ""}`);
  }
  await createSession(pending.userId);
  redirect(safeNext(str(form, "next"), "/tableau-de-bord"));
}

/** Préparation : nouveau secret (pas encore actif tant qu'un premier code n'a pas été saisi). */
export async function beginTwoFactor() {
  const user = await requireUser();
  if (user.totpEnabledAt) return;
  await db.user.update({ where: { id: user.id }, data: { totpSecret: newSecret(), totpLastStep: null } });
  revalidatePath("/compte");
}

/** Activation : premier code de l'application, puis codes de secours affichés une seule fois. */
export async function confirmTwoFactor(_: CodesState, form: FormData): Promise<CodesState> {
  const user = await requireUser();
  const { t } = await getT();
  if (user.totpEnabledAt) return { error: t("La double authentification est déjà activée.") };
  if (!user.totpSecret) return { error: t("Recommencez l'activation.") };
  const step = verifyTotp(user.totpSecret, str(form, "code"));
  if (step == null) return { error: t("Code incorrect. Vérifiez l'heure de votre téléphone et saisissez le code affiché.") };
  const codes = newRecoveryCodes();
  await db.user.update({ where: { id: user.id }, data: { totpEnabledAt: new Date(), totpLastStep: step, recoveryCodes: codes.map(hashRecovery) } });
  await audit(user.id, "user.2fa_enabled", "User", user.id);
  securityNotice(user, "La double authentification vient d'être activée sur votre compte : un code de votre application vous sera demandé à chaque connexion.");
  revalidatePath("/compte");
  return { ok: t("Double authentification activée."), codes };
}

/** Nouveaux codes de secours (les anciens ne valent plus), sur présentation d'un code de l'application. */
export async function regenerateRecoveryCodes(_: CodesState, form: FormData): Promise<CodesState> {
  const user = await requireUser();
  const { t } = await getT();
  if (!user.totpEnabledAt) return { error: t("La double authentification n'est pas activée.") };
  if ((await checkSecondFactor(user, str(form, "code"))) !== "totp") return { error: t("Code incorrect ou déjà utilisé. Saisissez le code affiché par votre application.") };
  const codes = newRecoveryCodes();
  await db.user.update({ where: { id: user.id }, data: { recoveryCodes: codes.map(hashRecovery) } });
  await audit(user.id, "user.2fa_recovery_codes", "User", user.id);
  securityNotice(user, "De nouveaux codes de secours ont été générés ; les précédents ne fonctionnent plus.");
  revalidatePath("/compte");
  return { ok: t("Nouveaux codes de secours générés."), codes };
}

/** Désactivation, sur présentation du mot de passe ; impossible quand une organisation ou l'administration l'exige. */
export async function disableTwoFactor(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const { t } = await getT();
  if (!user.totpEnabledAt) return { error: t("La double authentification n'est pas activée.") };
  const orgs = requiringOrgs(user);
  if (orgs.length) return { error: t("Impossible : {orgs} exige la double authentification de ses membres.", { orgs: orgs.map((o) => o.name).join(", ") }) };
  if (isPlatformAdmin(user) && adminTwoFactorRequired()) return { error: t("Impossible : la double authentification est obligatoire pour les administrateurs de KolBase.") };
  const check = await confirmPassword(user.id, String(form.get("password") ?? ""), user.passwordHash);
  if (check.wait) return tooManyAttempts(t, check.wait);
  if (!check.ok) return { error: t("Mot de passe incorrect.") };
  await db.user.update({ where: { id: user.id }, data: { totpSecret: null, totpEnabledAt: null, totpLastStep: null, recoveryCodes: [] } });
  await audit(user.id, "user.2fa_disabled", "User", user.id);
  securityNotice(user, "La double authentification vient d'être désactivée sur votre compte.");
  revalidatePath("/compte");
  return { ok: t("Double authentification désactivée.") };
}

/** Organisation : exiger la double authentification de tous les membres (administrateur, lui-même protégé). */
export async function setOrgTwoFactor(_: FormState, form: FormData): Promise<FormState> {
  const orgId = str(form, "orgId");
  const { user, isAdmin } = await requireMembership(orgId, undefined, { allowSupplier: true });
  if (!isAdmin) return { error: "Réservé aux administrateurs de l'organisation." };
  const on = form.get("require") === "1";
  if (on && !user.totpEnabledAt) return { error: "Activez d'abord la double authentification sur votre propre compte (Mon compte › Sécurité)." };
  await db.organization.update({ where: { id: orgId }, data: { require2fa: on } });
  await audit(user.id, on ? "org.2fa_required" : "org.2fa_optional", "Organization", orgId);
  revalidatePath(`/organisations/${orgId}/membres`);
  return { ok: on ? "Double authentification exigée : les membres qui ne l'ont pas activée devront le faire à leur prochain accès." : "Double authentification facultative." };
}
