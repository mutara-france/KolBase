import { redirect } from "next/navigation";
import { createHash } from "node:crypto";
import { audit, getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { consumeToken, findToken } from "@/lib/tokens";

/**
 * Lien reçu par e-mail : confirme l'adresse du compte. Le résultat est annoncé sur « Mon compte » si la personne est
 * connectée avec ce compte, sinon sur la page de connexion (lien ouvert sur un autre appareil, déconnecté). Un lien
 * déjà utilisé pour une adresse confirmée le dit, au lieu d'un « lien plus valable ».
 */
export async function GET(_: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await findToken(token, "VERIFY_EMAIL");
  let outcome: "confirme" | "deja-confirme" | "lien-invalide";
  let userId: string | null = null;
  if (t && (await consumeToken(t.id, t.userId, "VERIFY_EMAIL"))) {
    if (!t.user.emailVerifiedAt) await db.user.update({ where: { id: t.userId }, data: { emailVerifiedAt: new Date() } });
    await audit(t.userId, "user.email_verified", "User", t.userId);
    outcome = "confirme";
    userId = t.userId;
  } else {
    // Lien réutilisé (ou expiré) : l'adresse est-elle déjà confirmée ?
    const used = /^[A-Za-z0-9_-]{20,100}$/.test(token)
      ? await db.authToken.findUnique({ where: { tokenHash: createHash("sha256").update(token).digest("hex") }, select: { purpose: true, userId: true, user: { select: { emailVerifiedAt: true } } } })
      : null;
    outcome = used?.purpose === "VERIFY_EMAIL" && used.user.emailVerifiedAt ? "deja-confirme" : "lien-invalide";
    userId = used?.userId ?? null;
  }
  const current = await getCurrentUser();
  if (current && (!userId || current.id === userId)) redirect(`/compte?email=${outcome}`);
  // Connecté avec un autre compte : le résultat concerne l'autre adresse.
  if (current) redirect(`/compte?email=${outcome === "confirme" ? "autre-compte" : outcome}`);
  redirect(`/connexion?email=${outcome}&next=${encodeURIComponent("/compte")}`);
}
