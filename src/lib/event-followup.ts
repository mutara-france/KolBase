import "server-only";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { pointedPastEvents } from "@/lib/checkin";

/**
 * Avant et après l'événement : rappel la veille, puis attestation de présence et questionnaire.
 * Les envois automatiques passent par /api/taches (tâche planifiée) ; l'organisateur peut aussi les déclencher.
 */
export const REMINDER_WINDOW_MS = 30 * 3600 * 1000; // rappel envoyé dans les 30 h qui précèdent le début
export const FOLLOWUP_DELAY_MS = 3600 * 1000; // une heure après la fin
export const FOLLOWUP_MAX_AGE_MS = 14 * 24 * 3600 * 1000; // au-delà, plus d'envoi automatique

export { eventEnd, eventEnded } from "@/lib/events";

/**
 * Présent au sens du questionnaire : pointé, ou inscrit à un événement où personne n'a été pointé
 * (webinaire, pointage non utilisé). Même règle que les absents de la conformité.
 */
export async function attended(r: { eventId: string; checkedInAt: Date | null }) {
  return !!r.checkedInAt || !(await pointedPastEvents([r.eventId])).has(r.eventId);
}

/** Code de vérification de l'attestation, créé à la première édition (aléatoire, non devinable). */
export async function ensureCertificateCode(registrationId: string) {
  const r = await db.registration.findUnique({ where: { id: registrationId }, select: { certificateCode: true } });
  if (!r) return null;
  if (r.certificateCode) return r.certificateCode;
  const code = randomBytes(15).toString("base64url");
  const { count } = await db.registration.updateMany({ where: { id: registrationId, certificateCode: null }, data: { certificateCode: code } });
  if (count) return code;
  return (await db.registration.findUnique({ where: { id: registrationId }, select: { certificateCode: true } }))?.certificateCode ?? null;
}

export const certificateUrl = (code: string) => `${process.env.APP_URL ?? "http://localhost:3000"}/attestation/${code}`;
export const validCertificateCode = (code: string) => /^[A-Za-z0-9_-]{16,40}$/.test(code);

/** Moyennes du questionnaire (null si aucune réponse). */
export function surveySummary(rs: { overall: number; content: number | null; logistics: number | null }[]) {
  const avg = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => x != null);
    return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
  };
  return { count: rs.length, overall: avg(rs.map((r) => r.overall)), content: avg(rs.map((r) => r.content)), logistics: avg(rs.map((r) => r.logistics)) };
}
export const fmtRating = (x: number | null) => (x == null ? "—" : x.toFixed(1).replace(".", ","));
