"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit, createSession, destroyOtherSessions, destroySession, requireUser } from "@/lib/auth";
import { hashPassword, passwordProblem, verifyPassword } from "@/lib/password";
import { blockedFor, clientIp, hit, reset } from "@/lib/rate-limit";
import { safeNext } from "@/lib/safe-redirect";
import { canBeExpert, isRpps, normalizeRpps, PROFESSIONS } from "@/lib/professions";
import { country, isCountry, licenseRule, practicesInFrance } from "@/lib/countries";
import { sendLater } from "@/lib/mail";
import { notifyPlatformAdmins } from "@/lib/notifications";
import { consumeToken, findToken, issueToken } from "@/lib/tokens";
import { anonymizeAccount, soleAdminOrgs } from "@/lib/account";
import { MAX_NAME, str } from "@/lib/form";

export type FormState = { error?: string; ok?: string } | undefined;

const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

// Limites anti-force brute (échecs comptés sur 15 min) et anti-création de comptes en masse (par heure).
const SIGNIN_WINDOW_MS = 15 * 60 * 1000;
const SIGNIN_MAX_FAILURES_PER_EMAIL = 5;
const SIGNIN_MAX_FAILURES_PER_IP = 30;
const SIGNUP_WINDOW_MS = 60 * 60 * 1000;
const SIGNUP_MAX_PER_IP = 10;
const RESET_WINDOW_MS = 60 * 60 * 1000;
const RESET_MAX_PER_EMAIL = 3;
const RESET_MAX_PER_IP = 10;
const VERIFY_RESEND_MAX = 3;

/** Lien de confirmation d'adresse (valable 7 jours). */
async function sendVerification(user: { id: string; email: string; firstName: string }) {
  const token = await issueToken(user.id, "VERIFY_EMAIL");
  sendLater({
    to: user.email,
    subject: "Confirmez votre adresse e-mail — KolBase",
    text: `Bonjour ${user.firstName},\n\nConfirmez votre adresse pour recevoir les sollicitations, messages et rappels de KolBase. Le lien est valable 7 jours.\n\nSi vous n'avez pas créé de compte, ignorez ce message.`,
    cta: { label: "Confirmer mon adresse", href: `/confirmer-email/${token}` },
  });
}

const tooMany = (minutes: number) => ({ error: `Trop de tentatives. Réessayez dans ${minutes} minute${minutes > 1 ? "s" : ""}.` });

export async function signUp(_: FormState, form: FormData): Promise<FormState> {
  const firstName = str(form, "firstName", MAX_NAME);
  const lastName = str(form, "lastName", MAX_NAME);
  const email = str(form, "email").toLowerCase();
  const password = String(form.get("password") ?? "");
  const profession = str(form, "profession");
  const countryCode = str(form, "country") || "FR";

  if (!firstName || !lastName) return { error: "Indiquez votre prénom et votre nom." };
  if (!isCountry(countryCode)) return { error: "Pays d'exercice invalide." };
  if (!emailOk(email)) return { error: "Adresse e-mail invalide." };
  const pwErr = passwordProblem(password);
  if (pwErr) return { error: pwErr };
  if (!form.get("cgu")) return { error: "Vous devez accepter les conditions d'utilisation." };
  if (profession && !(PROFESSIONS as readonly string[]).includes(profession)) return { error: "Profession invalide." };
  const signupKey = `signup:ip:${await clientIp()}`;
  const wait = blockedFor(signupKey, SIGNUP_MAX_PER_IP, SIGNUP_WINDOW_MS);
  if (wait) return tooMany(wait);

  const exists = await db.user.findUnique({ where: { email } });
  if (exists) return { error: "Un compte existe déjà avec cette adresse. Connectez-vous." };

  const user = await db.user.create({
    data: {
      email,
      firstName,
      lastName,
      passwordHash: await hashPassword(password),
      practitioner: profession ? { create: { profession, country: countryCode, languages: practicesInFrance(countryCode) ? ["fr"] : [] } } : undefined,
    },
  });
  hit(signupKey);
  await audit(user.id, "user.signup", "User", user.id);
  await sendVerification(user);
  await createSession(user.id);
  redirect(safeNext(str(form, "next"), profession ? "/tableau-de-bord" : "/organisations/nouvelle"));
}

export async function signIn(_: FormState, form: FormData): Promise<FormState> {
  const email = str(form, "email").toLowerCase();
  const password = String(form.get("password") ?? "");
  const ipKey = `signin:ip:${await clientIp()}`;
  const emailKey = `signin:email:${email}`;
  // Vérifié avant le calcul (coûteux) du hash : un attaquant bloqué ne consomme plus de CPU.
  const wait = Math.max(blockedFor(emailKey, SIGNIN_MAX_FAILURES_PER_EMAIL, SIGNIN_WINDOW_MS), blockedFor(ipKey, SIGNIN_MAX_FAILURES_PER_IP, SIGNIN_WINDOW_MS));
  if (wait) return tooMany(wait);
  const user = await db.user.findUnique({ where: { email } });
  const ok = await verifyPassword(password, user?.passwordHash);
  if (!user || !ok) {
    hit(emailKey);
    hit(ipKey);
    if (user) await audit(user.id, "user.signin_failed", "User", user.id);
    return { error: "E-mail ou mot de passe incorrect." };
  }
  reset(emailKey);
  await audit(user.id, "user.signin", "User", user.id);
  await createSession(user.id);
  redirect(safeNext(str(form, "next"), "/tableau-de-bord"));
}

export async function signOut() {
  await destroySession();
  redirect("/");
}

export async function updateProfile(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const firstName = str(form, "firstName", MAX_NAME);
  const lastName = str(form, "lastName", MAX_NAME);
  if (!firstName || !lastName) return { error: "Prénom et nom sont obligatoires." };
  await db.user.update({
    where: { id: user.id },
    data: { firstName, lastName, phone: str(form, "phone") || null, locale: str(form, "locale") === "en" ? "en" : "fr" },
  });
  let unlisted = false;
  let toCheck: string | null = null;
  if (user.practitioner) {
    const p = user.practitioner;
    const profession = str(form, "profession") || p.profession;
    if (!(PROFESSIONS as readonly string[]).includes(profession) && profession !== p.profession) return { error: "Profession invalide." };
    const countryCode = str(form, "country") || p.country;
    if (!isCountry(countryCode)) return { error: "Pays d'exercice invalide." };
    const inFrance = practicesInFrance(countryCode);
    // En France, le RPPS ; ailleurs, l'identifiant du pays d'exercice (INAMI, NPI, n° d'Ordre…).
    let rpps: string | null = null;
    let license: string | null = null;
    if (inFrance) {
      rpps = normalizeRpps(str(form, "rpps")) || null;
      if (rpps && !isRpps(rpps)) return { error: "Numéro RPPS invalide : 11 chiffres, le dernier étant une clé de contrôle. Vérifiez la saisie. Si vous exercez hors de France, choisissez votre pays d'exercice." };
      if (rpps && rpps !== p.rpps && (await db.practitionerProfile.findFirst({ where: { rpps, NOT: { id: p.id } } })))
        return { error: "Ce numéro RPPS est déjà associé à un autre compte. Contactez-nous s'il s'agit du vôtre." };
    } else {
      const rule = licenseRule(countryCode);
      license = rule.normalize(str(form, "licenseNumber", 120)) || null;
      if (license && !rule.valid(license)) return { error: rule.error };
      if (license && (await db.practitionerProfile.findFirst({ where: { country: countryCode, licenseNumber: license, NOT: { id: p.id } } })))
        return { error: "Cet identifiant professionnel est déjà associé à un autre compte. Contactez-nous s'il s'agit du vôtre." };
    }
    const identifier = inFrance ? rpps : license;
    // Un identifiant modifié doit être contrôlé à nouveau ; sans identifiant ou hors profession éligible, plus de référencement.
    const idChanged = countryCode !== p.country || rpps !== p.rpps || license !== p.licenseNumber;
    if (idChanged && identifier) toCheck = inFrance ? `RPPS ${identifier}` : `${licenseRule(countryCode).label} ${identifier} (${country(countryCode).name})`;
    unlisted = p.listed && (!identifier || !canBeExpert(profession));
    await db.practitionerProfile.update({
      where: { userId: user.id },
      data: {
        profession,
        country: countryCode,
        rpps,
        licenseNumber: license,
        city: str(form, "city") || null,
        specialty: str(form, "specialty") || null,
        ...(idChanged ? { rppsVerified: false, rppsCheckedAt: null, rppsCheckNote: null } : {}),
        ...(unlisted ? { listed: false, listedAt: null } : {}),
      },
    });
  }
  await audit(user.id, "user.update_profile", "User", user.id, unlisted ? { unlisted: true } : undefined);
  if (toCheck) notifyPlatformAdmins(`Identité à vérifier : ${firstName} ${lastName}`, `${firstName} ${lastName} a renseigné : ${toCheck}.`, "/admin?onglet=praticiens");
  revalidatePath("/compte");
  return { ok: unlisted ? "Informations enregistrées. Votre référencement d'expert est suspendu (identifiant professionnel ou profession requis)." : "Informations enregistrées." };
}

export async function changePassword(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const current = String(form.get("current") ?? "");
  const next = String(form.get("next") ?? "");
  if (!(await verifyPassword(current, user.passwordHash))) return { error: "Mot de passe actuel incorrect." };
  const pwErr = passwordProblem(next);
  if (pwErr) return { error: pwErr };
  if (next !== String(form.get("confirm") ?? "")) return { error: "Les deux mots de passe ne correspondent pas." };
  await db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(next) } });
  await destroyOtherSessions(user.id);
  await audit(user.id, "user.change_password", "User", user.id);
  return { ok: "Mot de passe modifié. Vos autres sessions ont été fermées." };
}

// Le praticien se référence (ou se retire) comme expert KOL.
export async function setListed(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  if (!user.practitioner) return { error: "Cette option est réservée aux comptes praticiens." };
  const listed = form.get("listed") === "1";
  if (listed && !canBeExpert(user.practitioner.profession))
    return { error: "Le référencement comme expert est réservé aux chirurgiens-dentistes, orthodontistes, chirurgiens oraux et stomatologues." };
  const p = user.practitioner;
  const identifier = practicesInFrance(p.country) ? p.rpps : p.licenseNumber;
  if (listed && !identifier)
    return {
      error: practicesInFrance(p.country)
        ? "Renseignez d'abord votre numéro RPPS dans « Informations personnelles » : KolBase le vérifie pour afficher le badge « Identité vérifiée »."
        : `Renseignez d'abord votre ${licenseRule(p.country).short} dans « Informations personnelles » : KolBase le vérifie pour afficher le badge « Identité vérifiée ».`,
    };
  if (listed && !p.rppsVerified && p.rppsCheckedAt)
    return { error: "Votre identifiant professionnel n'a pas pu être vérifié : corrigez-le dans « Informations personnelles » pour vous référencer à nouveau." };
  await db.practitionerProfile.update({
    where: { userId: user.id },
    data: { listed, listedAt: listed ? new Date() : null },
  });
  await audit(user.id, listed ? "practitioner.listed" : "practitioner.unlisted", "PractitionerProfile", user.practitioner.id);
  revalidatePath("/compte");
  return { ok: listed ? "Vous êtes référencé comme expert." : "Votre profil n'est plus référencé." };
}

// ─── Mot de passe oublié, confirmation d'adresse, préférences ──────────────

/** Envoie un lien de réinitialisation (réponse identique que le compte existe ou non). */
export async function requestPasswordReset(_: FormState, form: FormData): Promise<FormState> {
  const email = str(form, "email").toLowerCase();
  if (!emailOk(email)) return { error: "Adresse e-mail invalide." };
  const ipKey = `reset:ip:${await clientIp()}`;
  const emailKey = `reset:email:${email}`;
  const wait = Math.max(blockedFor(ipKey, RESET_MAX_PER_IP, RESET_WINDOW_MS), blockedFor(emailKey, RESET_MAX_PER_EMAIL, RESET_WINDOW_MS));
  if (wait) return tooMany(wait);
  hit(ipKey);
  hit(emailKey);
  const user = await db.user.findUnique({ where: { email } });
  if (user) {
    const token = await issueToken(user.id, "RESET_PASSWORD");
    sendLater({
      to: user.email,
      subject: "Réinitialiser votre mot de passe — KolBase",
      text: `Bonjour ${user.firstName},\n\nVous avez demandé à réinitialiser votre mot de passe. Le lien est valable une heure et ne sert qu'une fois.\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez ce message : votre mot de passe reste inchangé.`,
      cta: { label: "Choisir un nouveau mot de passe", href: `/mot-de-passe/${token}` },
    });
    await audit(user.id, "user.reset_request", "User", user.id);
  }
  return { ok: "Si un compte existe avec cette adresse, un e-mail vient de vous être envoyé. Pensez à vérifier les indésirables." };
}

/** Nouveau mot de passe à partir du lien reçu : toutes les sessions sont fermées, puis l'utilisateur est connecté. */
export async function resetPassword(_: FormState, form: FormData): Promise<FormState> {
  const t = await findToken(str(form, "token"), "RESET_PASSWORD");
  if (!t) return { error: "Ce lien n'est plus valable. Demandez-en un nouveau." };
  const password = String(form.get("password") ?? "");
  const pwErr = passwordProblem(password);
  if (pwErr) return { error: pwErr };
  if (password !== String(form.get("confirm") ?? "")) return { error: "Les deux mots de passe ne correspondent pas." };
  if (!(await consumeToken(t.id, t.userId, "RESET_PASSWORD"))) return { error: "Ce lien n'est plus valable. Demandez-en un nouveau." };
  await db.user.update({
    where: { id: t.userId },
    // Le lien reçu prouve aussi l'accès à la boîte mail.
    data: { passwordHash: await hashPassword(password), ...(t.user.emailVerifiedAt ? {} : { emailVerifiedAt: new Date() }) },
  });
  await db.session.deleteMany({ where: { userId: t.userId } });
  reset(`signin:email:${t.user.email}`);
  await audit(t.userId, "user.reset_password", "User", t.userId);
  await createSession(t.userId);
  redirect("/tableau-de-bord");
}

/** Renvoie le lien de confirmation d'adresse. */
export async function resendVerification(_: FormState): Promise<FormState> {
  const user = await requireUser();
  if (user.emailVerifiedAt) return { ok: "Votre adresse est déjà confirmée." };
  const key = `verify:user:${user.id}`;
  const wait = blockedFor(key, VERIFY_RESEND_MAX, RESET_WINDOW_MS);
  if (wait) return tooMany(wait);
  hit(key);
  await sendVerification(user);
  return { ok: `Lien envoyé à ${user.email}.` };
}

/** Préférence de notifications par e-mail (les e-mails de service partent toujours). */
export async function updateNotifyPrefs(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const email = form.get("email") === "1";
  const prefs = user.notifyPrefs && typeof user.notifyPrefs === "object" ? (user.notifyPrefs as Record<string, unknown>) : {};
  await db.user.update({ where: { id: user.id }, data: { notifyPrefs: { ...prefs, email } } });
  await audit(user.id, "user.notify_prefs", "User", user.id, { email });
  revalidatePath("/compte");
  return { ok: email ? "Vous recevrez les notifications par e-mail." : "Vous ne recevrez plus de notifications par e-mail (hors e-mails de service)." };
}

/** Suppression du compte (anonymisation), après confirmation par le mot de passe. */
export async function deleteAccount(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  if (form.get("confirm") !== "1") return { error: "Cochez la case de confirmation." };
  if (!(await verifyPassword(String(form.get("password") ?? ""), user.passwordHash))) return { error: "Mot de passe incorrect." };
  const blocking = await soleAdminOrgs(user.id);
  if (blocking.length)
    return { error: `Vous êtes le seul administrateur de ${blocking.join(", ")} : nommez d'abord un autre administrateur (Membres et réglages), ou retirez les autres membres.` };
  const { kept } = await anonymizeAccount(user.id);
  await audit(user.id, "user.delete", "User", user.id, { kept });
  await destroySession();
  redirect("/?compte=supprime");
}
