import "server-only";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";

/**
 * Administrateurs de la plateforme KolBase (validation des organisations et des praticiens).
 * Variable PLATFORM_ADMIN_EMAILS : e-mails séparés par des virgules, de comptes déjà créés.
 */
export const platformAdminEmails = () =>
  (process.env.PLATFORM_ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);

export const isPlatformAdmin = (user: { email: string } | null | undefined) => !!user && platformAdminEmails().includes(user.email.toLowerCase());

export async function requirePlatformAdmin() {
  const user = await requireUser();
  if (!isPlatformAdmin(user)) notFound();
  return user;
}
