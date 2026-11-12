import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "@/lib/db";
import { loginPath } from "@/lib/safe-redirect";
import { currentHost } from "@/lib/brand-server";

const COOKIE = "kb_session";
const SESSION_DAYS = 30;

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

/**
 * KolBase Business : où une session peut-elle s'ouvrir pour ce compte ? Le nom de domaine d'une organisation lui
 * appartient (elle pourrait le faire pointer ailleurs et y recevoir le cookie de session) : on n'y ouvre donc jamais
 * une session KolBase ordinaire. Domaine actif : seuls les membres de l'organisation, pour une session limitée à son
 * espace (`brandOrgId`). Domaine en attente, retiré ou sans option : aucune session. Partout ailleurs : comme avant.
 */
export async function sessionScope(userId: string): Promise<{ allowed: false } | { allowed: true; brandOrgId: string | null }> {
  const { claimed, brand } = await currentHost();
  if (!claimed) return { allowed: true, brandOrgId: null };
  if (!brand || (await db.membership.count({ where: { userId, organizationId: brand.orgId } })) === 0) return { allowed: false };
  return { allowed: true, brandOrgId: brand.orgId };
}

/** Ouvre la session du compte ; false si l'adresse du site ne le permet pas pour lui (voir sessionScope). */
export async function createSession(userId: string) {
  const scope = await sessionScope(userId);
  if (!scope.allowed) return false;
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 864e5);
  const userAgent = (await headers()).get("user-agent")?.slice(0, 255) ?? null;
  await db.session.create({ data: { tokenHash: sha256(token), userId, expiresAt, userAgent, brandOrgId: scope.brandOrgId } });
  // Ménage : sessions expirées de ce compte.
  await db.session.deleteMany({ where: { userId, expiresAt: { lt: new Date() } } });
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
  return true;
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
  // KolBase Business : une session ouverte sur le domaine d'une organisation ne vaut que sur ce domaine, tant qu'il
  // sert sa marque ; une session KolBase ne vaut pas sur le domaine d'une organisation.
  const host = await currentHost();
  if ((session.brandOrgId ?? null) !== (host.brand?.orgId ?? null) || (host.claimed && !host.brand)) return null;
  const user = { ...session.user, brandScoped: session.brandOrgId !== null };
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
  // Session du domaine d'une organisation : son espace seulement — ni les autres organisations du compte, ni son
  // profil de praticien, ni l'administration KolBase (isPlatformAdmin). Plus membre : plus de session.
  if (session.brandOrgId) {
    user.memberships = user.memberships.filter((m) => m.organizationId === session.brandOrgId && !viaMandate(m));
    user.practitioner = null;
    if (user.memberships.length === 0) return null;
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
