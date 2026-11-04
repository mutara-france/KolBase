import "server-only";
import { randomBytes } from "node:crypto";
import QRCode from "qrcode";
import { db } from "@/lib/db";
import { EVENT_MANAGER_ROLES, eventEnded, eventScope } from "@/lib/events";

/**
 * Événements terminés dont le pointage a été fait (au moins un présent) : un inscrit non pointé y est absent.
 * Pendant l'événement, les retardataires ne sont pas encore absents.
 */
export async function pointedPastEvents(eventIds: string[], now = new Date()) {
  if (eventIds.length === 0) return new Set<string>();
  const g = await db.registration.groupBy({ by: ["eventId"], where: { eventId: { in: [...new Set(eventIds)] }, checkedInAt: { not: null }, event: { startsAt: { lt: now } } } });
  if (g.length === 0) return new Set<string>();
  const events = await db.event.findMany({ where: { id: { in: g.map((x) => x.eventId) } }, select: { id: true, startsAt: true, durationMinutes: true } });
  return new Set(events.filter((e) => eventEnded(e, now)).map((e) => e.id));
}

/** Le pointage ouvre la veille de l'événement et reste possible ensuite (régularisation). */
export const CHECKIN_OPENS_MS = 24 * 3600 * 1000;
export const checkinOpen = (startsAt: Date, now = new Date()) => now.getTime() >= startsAt.getTime() - CHECKIN_OPENS_MS;

const CODE_RE = /^[A-Za-z0-9_-]{16,40}$/;
export const validCheckinCode = (code: string) => CODE_RE.test(code);

/** Code du badge d'une inscription, créé à la première demande (aléatoire, non devinable). */
export async function ensureCheckinCode(registrationId: string) {
  const r = await db.registration.findUnique({ where: { id: registrationId }, select: { checkinCode: true } });
  if (!r) return null;
  if (r.checkinCode) return r.checkinCode;
  const code = randomBytes(18).toString("base64url");
  const { count } = await db.registration.updateMany({ where: { id: registrationId, checkinCode: null }, data: { checkinCode: code } });
  if (count) return code;
  return (await db.registration.findUnique({ where: { id: registrationId }, select: { checkinCode: true } }))?.checkinCode ?? null;
}

export const checkinUrl = (code: string) => `${process.env.APP_URL ?? "http://localhost:3000"}/pointage/${code}`;

/** QR code en SVG (lisible par l'appareil photo d'un téléphone, qui ouvre la page de pointage). */
export function qrSvg(text: string) {
  return QRCode.toString(text, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#0e0b24", light: "#ffffff" } });
}

/** L'utilisateur peut-il pointer les participants de cet événement (organisateur ou agence mandatée) ? */
export function canCheckIn(
  user: { memberships: { organizationId: string; role: string; organization: { kind: string } }[] },
  event: { organizationId: string; agencyId: string | null },
) {
  const roles = user.memberships.filter((m) => m.organizationId === event.organizationId).map((m) => m.role);
  if (!roles.some((r) => (EVENT_MANAGER_ROLES as string[]).includes(r))) return false;
  const scope = eventScope(user, roles as Parameters<typeof eventScope>[1]);
  return !scope.agencyId || (!!event.agencyId && scope.agencyId.in.includes(event.agencyId));
}
