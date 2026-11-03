import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { issueToken } from "@/lib/tokens";
import { TOKEN_TTL_MS } from "@/lib/tokens";

/** Cookie de l'étape « code de vérification » (après le mot de passe, avant la session). */
export const PENDING_COOKIE = "kb_2fa";

/**
 * Double authentification exigée des administrateurs de la plateforme (par défaut). PLATFORM_ADMIN_2FA=optional
 * la rend facultative (environnements de test).
 */
export const adminTwoFactorRequired = () => process.env.PLATFORM_ADMIN_2FA !== "optional";

/** Organisations du compte qui exigent la double authentification. */
export const requiringOrgs = (user: { memberships: { organizationId: string; organization: { name: string; require2fa: boolean } }[] }) => {
  const seen = new Map<string, string>();
  for (const m of user.memberships) if (m.organization.require2fa) seen.set(m.organizationId, m.organization.name);
  return [...seen.entries()].map(([id, name]) => ({ id, name }));
};

/** Mot de passe vérifié, compte protégé : jeton d'étape (10 min) puis saisie du code. */
export async function startSecondFactor(userId: string, next: string) {
  const token = await issueToken(userId, "TWO_FACTOR");
  (await cookies()).set(PENDING_COOKIE, token, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: TOKEN_TTL_MS.TWO_FACTOR / 1000,
  });
  redirect(`/connexion/verification${next ? `?next=${encodeURIComponent(next)}` : ""}`);
}
