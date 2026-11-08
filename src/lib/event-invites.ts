import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/db";

/**
 * Événements sur invitation (comité consultatif, atelier fermé, congrès d'un tiers) : hors de l'agenda public, la page
 * et l'inscription sont réservées aux invités. Une invitation porte un lien personnel (jeton stocké haché) ; une
 * personne connectée dont l'adresse correspond à une invitation y accède aussi sans le lien.
 */

export const hashInvite = (token: string) => createHash("sha256").update(token).digest("hex");
export const newInviteToken = () => randomBytes(24).toString("base64url");

/** Invitations ajoutées d'un coup au plus. */
export const MAX_INVITES_PER_BATCH = 200;
/** Relance des invités sans réponse : au plus une fois par 48 heures. */
export const INVITE_REMINDER_MS = 48 * 3600e3;

type Viewer = { id: string; email: string; memberships: { organizationId: string }[] } | null;

/** Invitation qui ouvre l'événement à cette personne : par le lien, par son compte, ou par son adresse. */
export async function inviteFor(eventId: string, viewer: Viewer, token?: string | null) {
  if (token) {
    const byToken = await db.eventInvite.findFirst({ where: { eventId, tokenHash: hashInvite(token) } });
    if (byToken) return byToken;
  }
  if (!viewer) return null;
  return db.eventInvite.findFirst({ where: { eventId, OR: [{ userId: viewer.id }, { email: viewer.email.toLowerCase() }] } });
}

/** Accès à un événement sur invitation : membre de l'organisation, inscrit, ou invité. */
export async function canSeeInviteOnly(event: { id: string; organizationId: string; agencyId?: string | null }, viewer: Viewer, token?: string | null) {
  if (viewer?.memberships.some((m) => m.organizationId === event.organizationId || m.organizationId === event.agencyId)) return true;
  if (viewer && (await db.registration.findUnique({ where: { eventId_userId: { eventId: event.id, userId: viewer.id } }, select: { id: true } }))) return true;
  return !!(await inviteFor(event.id, viewer, token));
}

export { parseInviteList } from "@/lib/invite-list";
