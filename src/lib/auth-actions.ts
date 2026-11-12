"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit, createSession, destroyOtherSessions, destroySession, requireUser, sessionScope } from "@/lib/auth";
import { currentHost } from "@/lib/brand-server";
import { appUrl } from "@/lib/ics";
import { hashPassword, needsRehash, passwordProblem, verifyPassword } from "@/lib/password";
import { confirmPassword, tooManyAttempts } from "@/lib/password-check";
import { blockedFor, clientIp, hit, reset } from "@/lib/rate-limit";
import { safeNext } from "@/lib/safe-redirect";
import { canBeExpert, isRpps, normalizeRpps, PROFESSIONS } from "@/lib/professions";
import { country, isCountry, licenseRule, practicesInFrance } from "@/lib/countries";
import { mailEnabled, sendLater } from "@/lib/mail";
import { notifyPlatformAdmins } from "@/lib/notifications";
import { consumeToken, findToken, issueToken } from "@/lib/tokens";
import { sendVerification } from "@/lib/verification";
import { LEGAL } from "@/lib/legal";
import { anonymizeAccount, soleAdminOrgs } from "@/lib/account";
import { startSecondFactor } from "@/lib/two-factor";
import { MAX_NAME, str } from "@/lib/form";
import { normalize } from "@/lib/search";
import { getLocale, getT, LOCALE_COOKIE } from "@/lib/i18n/server";
import { ORG_KIND_LABEL } from "@/lib/org-roles";
import { isFrenchPostalCode } from "@/lib/regions";
import { makeT, type T } from "@/lib/i18n";

export type FormState = { error?: string; ok?: string } | undefined;

const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

// Limites anti-force brute (échecs comptés sur 15 min) et anti-création de comptes en masse (par heure). Par adresse IP,
// une marge pour un congrès dont les participants partagent le Wi-Fi ; par adresse e-mail, les essais répétés.
const SIGNIN_WINDOW_MS = 15 * 60 * 1000;
const SIGNIN_MAX_FAILURES_PER_EMAIL = 5;
const SIGNIN_MAX_FAILURES_PER_IP = 30;
const SIGNUP_WINDOW_MS = 60 * 60 * 1000;
const SIGNUP_MAX_PER_IP = 60;
const SIGNUP_MAX_PER_EMAIL = 5;
const RESET_WINDOW_MS = 60 * 60 * 1000;
const RESET_MAX_PER_EMAIL = 3;
const RESET_MAX_PER_IP = 10;
const VERIFY_RESEND_MAX = 3;

const tooMany = (t: T, minutes: number) => ({
  error: minutes > 1 ? t("Trop de tentatives. Réessayez dans {n} minutes.", { n: minutes }) : t("Trop de tentatives. Réessayez dans {n} minute.", { n: minutes }),
});

export async function signUp(_: FormState, form: FormData): Promise<FormState> {
  const firstName = str(form, "firstName", MAX_NAME);
  const lastName = str(form, "lastName", MAX_NAME);
  const email = str(form, "email").toLowerCase();
  const password = String(form.get("password") ?? "");
  const profession = str(form, "profession");
  const countryCode = str(form, "country") || "FR";
  const { t } = await getT();

  if (!firstName || !lastName) return { error: t("Indiquez votre prénom et votre nom.") };
  if (!isCountry(countryCode)) return { error: t("Pays d'exercice invalide.") };
  if (!emailOk(email)) return { error: t("Adresse e-mail invalide.") };
  const pwErr = passwordProblem(password);
  if (pwErr) return { error: t(pwErr) };
  if (!form.get("cgu")) return { error: t("Vous devez accepter les conditions d'utilisation.") };
  if (profession && !(PROFESSIONS as readonly string[]).includes(profession)) return { error: t("Profession invalide.") };
  // Lettre d'information : réservée aux praticiens.
  const newsletter = !!profession && form.get("newsletter") === "1";
  const signupKey = `signup:ip:${await clientIp()}`;
  const emailKey = `signup:email:${email}`;
  const wait = Math.max(await blockedFor(signupKey, SIGNUP_MAX_PER_IP, SIGNUP_WINDOW_MS), await blockedFor(emailKey, SIGNUP_MAX_PER_EMAIL, SIGNUP_WINDOW_MS));
  if (wait) return tooMany(t, wait);
  await hit(emailKey);

  const exists = await db.user.findUnique({ where: { email } });
  if (exists) return { error: t("Un compte existe déjà avec cette adresse. Connectez-vous.") };
  // Nom de domaine d'une organisation (KolBase Business) : les comptes se créent sur KolBase.
  if ((await currentHost()).claimed) return { error: t("Les comptes se créent sur KolBase : rendez-vous sur {site}.", { site: appUrl() || "kolbase.io" }) };

  const user = await db.user.create({
    data: {
      email,
      firstName,
      lastName,
      passwordHash: await hashPassword(password),
      // Langue utilisée pendant l'inscription : elle sert ensuite pour l'interface et les e-mails.
      locale: await getLocale(),
      // Lettre d'information : case décochée par défaut, la question n'est plus reposée ensuite.
      notifyPrefs: { newsletter, newsletterAsked: true },
      practitioner: profession ? { create: { profession, country: countryCode, languages: practicesInFrance(countryCode) ? ["fr"] : [] } } : undefined,
    },
  });
  await hit(signupKey);
  await audit(user.id, "user.signup", "User", user.id);
  if (newsletter) await audit(user.id, "user.notify_prefs", "User", user.id, { newsletter, source: "inscription" });
  const next = safeNext(str(form, "next"), "");
  await sendVerification(user, !!profession, next);
  await createSession(user.id);
  // Structure nommée à l'inscription : l'étape suivante (sa fiche) est préremplie.
  const orgName = profession ? "" : str(form, "orgName", 120);
  const orgKind = str(form, "orgKind");
  if (orgName) redirect(`/organisations/nouvelle?${new URLSearchParams({ nom: orgName, ...(Object.hasOwn(ORG_KIND_LABEL, orgKind) ? { type: orgKind } : {}) })}`);
  redirect(next || (profession ? "/tableau-de-bord" : "/organisations/nouvelle"));
}

export async function signIn(_: FormState, form: FormData): Promise<FormState> {
  const email = str(form, "email").toLowerCase();
  const password = String(form.get("password") ?? "");
  const ipKey = `signin:ip:${await clientIp()}`;
  const emailKey = `signin:email:${email}`;
  const { t } = await getT();
  // Vérifié avant le calcul (coûteux) du hash : un attaquant bloqué ne consomme plus de CPU.
  const wait = Math.max(await blockedFor(emailKey, SIGNIN_MAX_FAILURES_PER_EMAIL, SIGNIN_WINDOW_MS), await blockedFor(ipKey, SIGNIN_MAX_FAILURES_PER_IP, SIGNIN_WINDOW_MS));
  if (wait) return tooMany(t, wait);
  const user = await db.user.findUnique({ where: { email } });
  const ok = await verifyPassword(password, user?.passwordHash);
  if (!user || !ok) {
    await hit(emailKey);
    await hit(ipKey);
    if (user) await audit(user.id, "user.signin_failed", "User", user.id);
    return { error: t("E-mail ou mot de passe incorrect.") };
  }
  await reset(emailKey);
  // Compte désactivé par l'équipe KolBase : le mot de passe est juste, mais la connexion est refusée.
  if (user.disabledAt) {
    await audit(user.id, "user.signin_disabled", "User", user.id);
    return { error: t("Ce compte a été désactivé par l'équipe KolBase. Pour en savoir plus, écrivez à {email}.", { email: LEGAL.contactEmail ?? "contact@kolbase.io" }) };
  }
  // Nom de domaine d'une organisation (KolBase Business) : réservé à ses membres ; les autres comptes se connectent
  // sur KolBase (dit avant le second facteur, pour ne pas le demander en vain).
  if (!(await sessionScope(user.id)).allowed) {
    await audit(user.id, "user.signin_brand_refused", "User", user.id);
    return { error: t("Cette adresse est réservée à l'équipe de l'organisation. Connectez-vous sur {site}.", { site: appUrl() || "kolbase.io" }) };
  }
  // Hash d'un ancien format ou de paramètres dépassés : recalculé maintenant que le mot de passe est connu.
  if (user.passwordHash && needsRehash(user.passwordHash)) await db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(password) } });
  // Double authentification : le mot de passe ne suffit pas, le code de l'application est demandé ensuite.
  if (user.totpEnabledAt) {
    await audit(user.id, "user.signin_password", "User", user.id);
    await startSecondFactor(user.id, str(form, "next"));
  }
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
  if (!firstName || !lastName) return { error: (await getT()).t("Prénom et nom sont obligatoires.") };
  const locale = str(form, "locale") === "en" ? "en" : "fr";
  // Messages dans la langue de la page affichée après l'enregistrement (la langue choisie, si elle a changé).
  const t = locale !== user.locale ? makeT(locale) : (await getT()).t;
  const userData = { firstName, lastName, phone: str(form, "phone") || null, locale };

  // Toutes les vérifications d'abord : une erreur n'enregistre rien (pas de sauvegarde partielle).
  let unlisted = false;
  let toCheck: string | null = null;
  let practitionerData: Record<string, unknown> | null = null;
  if (user.practitioner) {
    const p = user.practitioner;
    const profession = str(form, "profession") || p.profession;
    if (!(PROFESSIONS as readonly string[]).includes(profession) && profession !== p.profession) return { error: t("Profession invalide.") };
    const countryCode = str(form, "country") || p.country;
    if (!isCountry(countryCode)) return { error: t("Pays d'exercice invalide.") };
    const inFrance = practicesInFrance(countryCode);
    // En France, le RPPS ; ailleurs, l'identifiant du pays d'exercice (INAMI, NPI, n° d'Ordre…).
    let rpps: string | null = null;
    let license: string | null = null;
    if (inFrance) {
      rpps = normalizeRpps(str(form, "rpps")) || null;
      if (rpps && !isRpps(rpps)) return { error: t("Numéro RPPS invalide : 11 chiffres, le dernier étant une clé de contrôle. Vérifiez la saisie. Si vous exercez hors de France, choisissez votre pays d'exercice.") };
      if (rpps && rpps !== p.rpps && (await db.practitionerProfile.findFirst({ where: { rpps, NOT: { id: p.id } } })))
        return { error: t("Ce numéro RPPS est déjà associé à un autre compte. Contactez-nous s'il s'agit du vôtre.") };
    } else {
      const rule = licenseRule(countryCode);
      license = rule.normalize(str(form, "licenseNumber", 120)) || null;
      if (license && !rule.valid(license)) return { error: t(rule.error) };
      if (license && (await db.practitionerProfile.findFirst({ where: { country: countryCode, licenseNumber: license, NOT: { id: p.id } } })))
        return { error: t("Cet identifiant professionnel est déjà associé à un autre compte. Contactez-nous s'il s'agit du vôtre.") };
    }
    const identifier = inFrance ? rpps : license;
    // Un identifiant modifié doit être contrôlé à nouveau ; sans identifiant ou hors profession éligible, plus de référencement.
    const idChanged = countryCode !== p.country || rpps !== p.rpps || license !== p.licenseNumber;
    // Le badge « Identité vérifiée » porte sur un nom, une profession et un identifiant : changer l'un d'eux relance le contrôle
    // (une simple correction de casse ou d'accent ne compte pas).
    const identityChanged =
      normalize(firstName) !== normalize(user.firstName) || normalize(lastName) !== normalize(user.lastName) || profession !== p.profession;
    const recheck = idChanged || (identityChanged && (p.rppsVerified || !!p.rppsCheckedAt));
    if (recheck && identifier) toCheck = inFrance ? `RPPS ${identifier}` : `${licenseRule(countryCode).label} ${identifier} (${country(countryCode).name})`;
    unlisted = p.listed && (!identifier || !canBeExpert(profession));
    // Code postal : 5 chiffres en France, libre ailleurs (facultatif).
    const postalCode = str(form, "postalCode").replace(/\s/g, "").slice(0, 12) || null;
    if (postalCode && inFrance && !isFrenchPostalCode(postalCode)) return { error: t("Code postal invalide : 5 chiffres.") };
    practitionerData = {
      profession,
      country: countryCode,
      rpps,
      licenseNumber: license,
      city: str(form, "city") || null,
      postalCode,
      specialty: str(form, "specialty") || null,
      ...(recheck ? { rppsVerified: false, rppsCheckedAt: null, rppsCheckNote: null } : {}),
      ...(unlisted ? { listed: false, listedAt: null } : {}),
    };
  }

  await db.$transaction([
    db.user.update({ where: { id: user.id }, data: userData }),
    ...(practitionerData ? [db.practitionerProfile.update({ where: { userId: user.id }, data: practitionerData })] : []),
  ]);
  // La langue choisie s'applique aussi à cet appareil (le sélecteur de langue pose le même cookie).
  if (locale !== user.locale) (await cookies()).set(LOCALE_COOKIE, locale, { path: "/", maxAge: 365 * 24 * 3600, sameSite: "lax", httpOnly: true, secure: process.env.NODE_ENV === "production" });
  await audit(user.id, "user.update_profile", "User", user.id, unlisted ? { unlisted: true } : undefined);
  if (toCheck) notifyPlatformAdmins(`Identité à vérifier : ${firstName} ${lastName}`, `${firstName} ${lastName} a renseigné : ${toCheck}.`, "/admin/identites");
  revalidatePath("/compte");
  return { ok: unlisted ? t("Informations enregistrées. Votre référencement d'expert est suspendu (identifiant professionnel ou profession requis).") : t("Informations enregistrées.") };
}

export async function changePassword(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const current = String(form.get("current") ?? "");
  const next = String(form.get("next") ?? "");
  const { t } = await getT();
  const check = await confirmPassword(user.id, current, user.passwordHash);
  if (check.wait) return tooManyAttempts(t, check.wait);
  if (!check.ok) return { error: t("Mot de passe actuel incorrect.") };
  const pwErr = passwordProblem(next);
  if (pwErr) return { error: t(pwErr) };
  if (next !== String(form.get("confirm") ?? "")) return { error: t("Les deux mots de passe ne correspondent pas.") };
  await db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(next) } });
  await destroyOtherSessions(user.id);
  await audit(user.id, "user.change_password", "User", user.id);
  return { ok: t("Mot de passe modifié. Vos autres sessions ont été fermées.") };
}

// Le praticien se référence (ou se retire) comme expert KOL.
export async function setListed(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const { t } = await getT();
  if (!user.practitioner) return { error: t("Cette option est réservée aux comptes praticiens.") };
  const listed = form.get("listed") === "1";
  if (listed && !canBeExpert(user.practitioner.profession))
    return { error: t("Le référencement comme expert est réservé aux chirurgiens-dentistes, orthodontistes, chirurgiens oraux et stomatologues.") };
  const p = user.practitioner;
  let identifier = practicesInFrance(p.country) ? p.rpps : p.licenseNumber;
  // RPPS saisi dans l'encart de référencement (exercice en France, pas encore renseigné) : enregistré et soumis à
  // la vérification de KolBase, puis le référencement suit.
  const typedRpps = listed && practicesInFrance(p.country) && !p.rpps ? normalizeRpps(str(form, "rpps")) : "";
  if (typedRpps) {
    if (!isRpps(typedRpps)) return { error: t("Numéro RPPS invalide : 11 chiffres, le dernier étant une clé de contrôle. Vérifiez la saisie. Si vous exercez hors de France, choisissez votre pays d'exercice.") };
    if (await db.practitionerProfile.findFirst({ where: { rpps: typedRpps, NOT: { id: p.id } } }))
      return { error: t("Ce numéro RPPS est déjà associé à un autre compte. Contactez-nous s'il s'agit du vôtre.") };
    if (!canBeExpert(p.profession)) return { error: t("Le référencement comme expert est réservé aux chirurgiens-dentistes, orthodontistes, chirurgiens oraux et stomatologues.") };
    await db.practitionerProfile.update({ where: { userId: user.id }, data: { rpps: typedRpps, rppsVerified: false, rppsCheckedAt: null, rppsCheckNote: null } });
    notifyPlatformAdmins(`Identité à vérifier : ${user.firstName} ${user.lastName}`, `${user.firstName} ${user.lastName} a renseigné : RPPS ${typedRpps}.`, "/admin/identites");
    identifier = typedRpps;
  }
  if (listed && !identifier)
    return {
      error: practicesInFrance(p.country)
        ? t("Renseignez d'abord votre numéro RPPS ci-dessus : KolBase le vérifie pour afficher le badge « Identité vérifiée ».")
        : t("Renseignez d'abord votre {id} dans « Informations personnelles » : KolBase le vérifie pour afficher le badge « Identité vérifiée ».", { id: t(licenseRule(p.country).short) }),
    };
  if (listed && !typedRpps && !p.rppsVerified && p.rppsCheckedAt)
    return { error: t("Votre identifiant professionnel n'a pas pu être vérifié : corrigez-le dans « Informations personnelles » pour vous référencer à nouveau.") };
  await db.practitionerProfile.update({
    where: { userId: user.id },
    data: { listed, listedAt: listed ? new Date() : null },
  });
  await audit(user.id, listed ? "practitioner.listed" : "practitioner.unlisted", "PractitionerProfile", user.practitioner.id);
  revalidatePath("/compte");
  return { ok: listed ? t("Vous êtes référencé comme expert.") : t("Votre profil n'est plus référencé.") };
}

// ─── Mot de passe oublié, confirmation d'adresse, préférences ──────────────

/** Envoie un lien de réinitialisation (réponse identique que le compte existe ou non). */
export async function requestPasswordReset(_: FormState, form: FormData): Promise<FormState> {
  const email = str(form, "email").toLowerCase();
  const { t } = await getT();
  if (!emailOk(email)) return { error: t("Adresse e-mail invalide.") };
  // Envoi d'e-mails pas encore configuré : le dire plutôt qu'annoncer un lien qui ne partira pas (même réponse pour tous).
  if (!mailEnabled()) return { error: t("L'envoi d'e-mails n'est pas encore activé sur KolBase : la réinitialisation par e-mail est indisponible pour l'instant. Écrivez à {email}.", { email: LEGAL.contactEmail ?? "contact@kolbase.io" }) };
  const ipKey = `reset:ip:${await clientIp()}`;
  const emailKey = `reset:email:${email}`;
  const wait = Math.max(await blockedFor(ipKey, RESET_MAX_PER_IP, RESET_WINDOW_MS), await blockedFor(emailKey, RESET_MAX_PER_EMAIL, RESET_WINDOW_MS));
  if (wait) return tooMany(t, wait);
  await hit(ipKey);
  await hit(emailKey);
  const user = await db.user.findUnique({ where: { email } });
  // Compte désactivé : pas de lien (même réponse neutre, qu'il existe ou non).
  if (user && !user.disabledAt) {
    // La page d'origine suit le lien : retour à cette page après le nouveau mot de passe.
    const token = await issueToken(user.id, "RESET_PASSWORD", safeNext(str(form, "next"), ""));
    sendLater({
      to: user.email,
      subject: "Réinitialiser votre mot de passe — KolBase",
      text: `Bonjour ${user.firstName},\n\nVous avez demandé à réinitialiser votre mot de passe. Le lien est valable une heure et ne sert qu'une fois.\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez ce message : votre mot de passe reste inchangé.`,
      cta: { label: "Choisir un nouveau mot de passe", href: `/mot-de-passe/${token}` },
    });
    await audit(user.id, "user.reset_request", "User", user.id);
  }
  return { ok: t("Si un compte existe avec cette adresse, un e-mail vient de vous être envoyé. Pensez à vérifier les indésirables.") };
}

/** Nouveau mot de passe à partir du lien reçu : toutes les sessions sont fermées, puis l'utilisateur est connecté. */
export async function resetPassword(_: FormState, form: FormData): Promise<FormState> {
  const t = await findToken(str(form, "token"), "RESET_PASSWORD");
  const { t: tr } = await getT();
  if (!t) return { error: tr("Ce lien n'est plus valable. Demandez-en un nouveau.") };
  const password = String(form.get("password") ?? "");
  const pwErr = passwordProblem(password);
  if (pwErr) return { error: tr(pwErr) };
  if (password !== String(form.get("confirm") ?? "")) return { error: tr("Les deux mots de passe ne correspondent pas.") };
  if (t.user.disabledAt) return { error: tr("Ce lien n'est plus valable. Demandez-en un nouveau.") };
  if (!(await consumeToken(t.id, t.userId, "RESET_PASSWORD"))) return { error: tr("Ce lien n'est plus valable. Demandez-en un nouveau.") };
  await db.user.update({
    where: { id: t.userId },
    // Le lien reçu prouve aussi l'accès à la boîte mail.
    data: { passwordHash: await hashPassword(password), ...(t.user.emailVerifiedAt ? {} : { emailVerifiedAt: new Date() }) },
  });
  await db.session.deleteMany({ where: { userId: t.userId } });
  await reset(`signin:email:${t.user.email}`);
  await audit(t.userId, "user.reset_password", "User", t.userId);
  // Retour à la page d'origine gardée par le lien. Le lien reçu par e-mail ne remplace pas le second facteur.
  const next = safeNext(t.next, "/tableau-de-bord");
  if (t.user.totpEnabledAt) await startSecondFactor(t.userId, next);
  await createSession(t.userId);
  redirect(next);
}

/** Renvoie le lien de confirmation d'adresse. */
export async function resendVerification(_: FormState): Promise<FormState> {
  const user = await requireUser();
  const { t } = await getT();
  if (user.emailVerifiedAt) return { ok: t("Votre adresse est déjà confirmée.") };
  if (!mailEnabled()) return { error: t("L'envoi d'e-mails n'est pas encore activé sur KolBase : aucun lien ne peut partir pour l'instant.") };
  const key = `verify:user:${user.id}`;
  const wait = await blockedFor(key, VERIFY_RESEND_MAX, RESET_WINDOW_MS);
  if (wait) return tooMany(t, wait);
  await hit(key);
  await sendVerification(user, !!user.practitioner);
  return { ok: t("Lien envoyé à {email}.", { email: user.email }) };
}

/** Préférence de notifications par e-mail (les e-mails de service partent toujours). */
export async function updateNotifyPrefs(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const email = form.get("email") === "1";
  // Lettre d'information réservée aux praticiens : sans profil praticien, la case n'est pas proposée.
  const newsletter = !!user.practitioner && form.get("newsletter") === "1";
  const prefs = user.notifyPrefs && typeof user.notifyPrefs === "object" ? (user.notifyPrefs as Record<string, unknown>) : {};
  await db.user.update({ where: { id: user.id }, data: { notifyPrefs: { ...prefs, email, newsletter, newsletterAsked: true } } });
  // Consentement à la lettre d'information tracé (date, choix).
  await audit(user.id, "user.notify_prefs", "User", user.id, { email, newsletter, source: "compte" });
  revalidatePath("/compte");
  const { t } = await getT();
  return { ok: email ? t("Vous recevrez les notifications par e-mail.") : t("Vous ne recevrez plus de notifications par e-mail (hors e-mails de service).") };
}

/** Réponse à la proposition de lettre d'information (accueil du praticien), posée une seule fois. */
export async function answerNewsletter(form: FormData) {
  const user = await requireUser();
  const newsletter = form.get("choice") === "oui";
  const prefs = user.notifyPrefs && typeof user.notifyPrefs === "object" ? (user.notifyPrefs as Record<string, unknown>) : {};
  await db.user.update({ where: { id: user.id }, data: { notifyPrefs: { ...prefs, newsletter, newsletterAsked: true } } });
  await audit(user.id, "user.notify_prefs", "User", user.id, { newsletter, source: String(form.get("source") ?? "accueil").slice(0, 20) });
  revalidatePath("/tableau-de-bord");
  revalidatePath("/actualites");
  revalidatePath("/compte");
}

/** Suppression du compte (anonymisation), après confirmation par le mot de passe. */
export async function deleteAccount(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const { t } = await getT();
  if (form.get("confirm") !== "1") return { error: t("Cochez la case de confirmation.") };
  const check = await confirmPassword(user.id, String(form.get("password") ?? ""), user.passwordHash);
  if (check.wait) return tooManyAttempts(t, check.wait);
  if (!check.ok) return { error: t("Mot de passe incorrect.") };
  const blocking = await soleAdminOrgs(user.id);
  if (blocking.length)
    return { error: t("Vous êtes le seul administrateur de {orgs} : nommez d'abord un autre administrateur (Membres et réglages), ou retirez les autres membres.", { orgs: blocking.join(", ") }) };
  const { kept } = await anonymizeAccount(user.id);
  await audit(user.id, "user.delete", "User", user.id, { kept });
  await destroySession();
  redirect("/?compte=supprime");
}
