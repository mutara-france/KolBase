import "server-only";
import { notFound } from "next/navigation";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { mailEnabled } from "@/lib/mail";
import { adminTwoFactorRequired } from "@/lib/two-factor";

/**
 * Administrateurs de la plateforme KolBase (validation des organisations et des praticiens).
 * Variable PLATFORM_ADMIN_EMAILS : e-mails séparés par des virgules, de comptes déjà créés.
 */
export const platformAdminEmails = () =>
  (process.env.PLATFORM_ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);

const listed = (user: { email: string }) => platformAdminEmails().includes(user.email.toLowerCase());

/**
 * Adresse listée ET confirmée dès que l'envoi d'e-mails est configuré : sans cette confirmation,
 * quiconque créerait un compte avec une adresse listée (encore libre) deviendrait administrateur.
 */
export const isPlatformAdmin = (user: { email: string; emailVerifiedAt?: Date | null } | null | undefined) =>
  !!user && listed(user) && (!mailEnabled() || !!user.emailVerifiedAt);

export async function requirePlatformAdmin() {
  const user = await requireUser();
  // Adresse listée mais pas encore confirmée : direction « Mon compte », où le lien peut être renvoyé.
  if (listed(user) && !isPlatformAdmin(user)) redirect("/compte?admin=confirmer");
  if (!isPlatformAdmin(user)) notFound();
  // Administration de KolBase : double authentification obligatoire (sauf PLATFORM_ADMIN_2FA=optional).
  if (adminTwoFactorRequired() && !user.totpEnabledAt) redirect("/compte?securite=admin#securite");
  return user;
}
