"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit, createSession, destroyOtherSessions, destroySession, requireUser } from "@/lib/auth";
import { hashPassword, passwordProblem, verifyPassword } from "@/lib/password";
import { blockedFor, clientIp, hit, reset } from "@/lib/rate-limit";
import { safeNext } from "@/lib/safe-redirect";

export type FormState = { error?: string; ok?: string } | undefined;

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

// Limites anti-force brute (échecs comptés sur 15 min) et anti-création de comptes en masse (par heure).
const SIGNIN_WINDOW_MS = 15 * 60 * 1000;
const SIGNIN_MAX_FAILURES_PER_EMAIL = 5;
const SIGNIN_MAX_FAILURES_PER_IP = 30;
const SIGNUP_WINDOW_MS = 60 * 60 * 1000;
const SIGNUP_MAX_PER_IP = 10;
const tooMany = (minutes: number) => ({ error: `Trop de tentatives. Réessayez dans ${minutes} minute${minutes > 1 ? "s" : ""}.` });

export async function signUp(_: FormState, form: FormData): Promise<FormState> {
  const firstName = str(form, "firstName");
  const lastName = str(form, "lastName");
  const email = str(form, "email").toLowerCase();
  const password = String(form.get("password") ?? "");
  const profession = str(form, "profession");

  if (!firstName || !lastName) return { error: "Indiquez votre prénom et votre nom." };
  if (!emailOk(email)) return { error: "Adresse e-mail invalide." };
  const pwErr = passwordProblem(password);
  if (pwErr) return { error: pwErr };
  if (!form.get("cgu")) return { error: "Vous devez accepter les conditions d'utilisation." };
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
      practitioner: profession ? { create: { profession, languages: ["fr"] } } : undefined,
    },
  });
  hit(signupKey);
  await audit(user.id, "user.signup", "User", user.id);
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
  const firstName = str(form, "firstName");
  const lastName = str(form, "lastName");
  if (!firstName || !lastName) return { error: "Prénom et nom sont obligatoires." };
  await db.user.update({
    where: { id: user.id },
    data: { firstName, lastName, phone: str(form, "phone") || null, locale: str(form, "locale") === "en" ? "en" : "fr" },
  });
  if (user.practitioner) {
    await db.practitionerProfile.update({
      where: { userId: user.id },
      data: {
        profession: str(form, "profession") || user.practitioner.profession,
        rpps: str(form, "rpps") || null,
        city: str(form, "city") || null,
        specialty: str(form, "specialty") || null,
      },
    });
  }
  await audit(user.id, "user.update_profile", "User", user.id);
  revalidatePath("/compte");
  return { ok: "Informations enregistrées." };
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
  await db.practitionerProfile.update({
    where: { userId: user.id },
    data: { listed, listedAt: listed ? new Date() : null },
  });
  await audit(user.id, listed ? "practitioner.listed" : "practitioner.unlisted", "PractitionerProfile", user.practitioner.id);
  revalidatePath("/compte");
  return { ok: listed ? "Vous êtes référencé comme expert." : "Votre profil n'est plus référencé." };
}
