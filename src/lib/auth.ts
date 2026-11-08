import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "@/lib/db";
import { loginPath } from "@/lib/safe-redirect";

const COOKIE = "kb_session";
const SESSION_DAYS = 30;

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 864e5);
  const userAgent = (await headers()).get("user-agent")?.slice(0, 255) ?? null;
  await db.session.create({ data: { tokenHash: sha256(token), userId, expiresAt, userAgent } });
  // Ménage : sessions expirées de ce compte.
  await db.session.deleteMany({ where: { userId, expiresAt: { lt: new Date() } } });
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await db.session.deleteMany({ where: { tokenHash: sha256(token) } });
  jar.delete(COOKIE);
}

// Ferme toutes les autres sessions (après changement de mot de passe).
export async function destroyOtherSessions(userId: string) {
  const token = (await cookies()).get(COOKIE)?.value;
  await db.session.deleteMany({ where: { userId, NOT: token ? { tokenHash: sha256(token) } : undefined } });
}

/** Appartenance déduite d'un mandat d'agence (et non d'une invitation) : identifiant préfixé. */
const MANDATE_PREFIX = "mandat:";
export const viaMandate = (m: { id: string }) => m.id.startsWith(MANDATE_PREFIX);

export const getCurrentUser = cache(async () => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: { include: { practitioner: true, memberships: { include: { organization: true } } } } },
  });
  if (!session || session.expiresAt < new Date()) return null;
  // Compte désactivé par l'équipe KolBase : ses sessions sont fermées à la désactivation ; garde-fou si l'une subsiste.
  if (session.user.disabledAt) return null;
  const user = session.user;
  // Agences mandatées : les membres d'une agence accèdent à chaque organisation qui la mandate (mandat actif),
  // avec le seul rôle « Agence mandatée » (événements confiés). Aucune invitation séparée : le mandat fait foi.
  // Une agence suspendue par KolBase n'agit plus pour ses clients le temps de la suspension.
  const agencyIds = user.memberships.filter((m) => m.organization.kind === "PRESTATAIRE" && m.organization.verification !== "SUSPENDED").map((m) => m.organizationId);
  if (agencyIds.length > 0) {
    const mandates = await db.mandate.findMany({
      where: { agencyId: { in: agencyIds }, OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }] },
      include: { mandator: true },
    });
    for (const m of mandates) {
      if (user.memberships.some((x) => x.organizationId === m.mandatorId && x.role === "PRESTATAIRE")) continue;
      user.memberships.push({ id: `${MANDATE_PREFIX}${m.id}`, userId: user.id, organizationId: m.mandatorId, role: "PRESTATAIRE", createdAt: m.startsAt, organization: m.mandator });
    }
  }
  return user;
});

/** Non connecté : connexion, puis retour au chemin demandé (en-tête `x-kb-path` posé par src/proxy.ts). */
export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect(loginPath((await headers()).get("x-kb-path")));
  return user;
}

export async function audit(actorId: string | null, action: string, entityType: string, entityId: string, data?: object) {
  await db.auditLog.create({ data: { actorId, action, entityType, entityId, data } });
}
