/** Lettre d'information : état du consentement stocké dans `User.notifyPrefs`, et rythme des envois. */
import { parseParisDateTime, TZ } from "@/lib/events";

type Prefs = { notifyPrefs: unknown };

const prefsOf = (u: Prefs) => (u.notifyPrefs && typeof u.notifyPrefs === "object" ? (u.notifyPrefs as Record<string, unknown>) : {});

/** Abonné à la lettre d'information. */
export const subscribed = (u: Prefs) => prefsOf(u).newsletter === true;

/** La question n'a jamais été posée (ni à l'inscription, ni depuis « Mon compte », ni par le bandeau). */
export const newsletterPending = (u: Prefs) => {
  const p = prefsOf(u);
  return p.newsletter !== true && p.newsletterAsked !== true;
};

/** Au plus deux envois par mois civil, e-mailings commandés et lettres libres confondus (promesse faite aux abonnés). */
export const NEWSLETTER_MONTHLY_MAX = 2;

/** Début du mois civil (heure de Paris) qui contient `now`. */
export function parisMonthStart(now = new Date()) {
  const [y, m] = now.toLocaleDateString("sv-SE", { timeZone: TZ }).split("-");
  return parseParisDateTime(`${y}-${m}-01T00:00`)!;
}
/** « novembre 2026 ». */
export const parisMonthLabel = (now = new Date()) => now.toLocaleDateString("fr-FR", { timeZone: TZ, month: "long", year: "numeric" });

/** Message du plafond atteint. */
export const monthlyCapMessage = (now = new Date()) =>
  `Plafond atteint : ${NEWSLETTER_MONTHLY_MAX} envois de la lettre d'information en ${parisMonthLabel(now)} (e-mailings commandés et lettres libres confondus). Le prochain envoi est possible le mois prochain.`;

/** Premier jour du mois suivant (heure de Paris). */
export function nextParisMonthStart(now = new Date()) {
  const [y, m] = now.toLocaleDateString("sv-SE", { timeZone: TZ }).split("-").map(Number);
  const [ny, nm] = m === 12 ? [y + 1, 1] : [y, m + 1];
  return parseParisDateTime(`${ny}-${String(nm).padStart(2, "0")}-01T00:00`)!;
}
/** « 1er décembre 2026 ». */
export const firstOfMonthLabel = (d: Date) => `1er ${d.toLocaleDateString("fr-FR", { timeZone: TZ, month: "long", year: "numeric" })}`;

/**
 * E-mailing commandé pour un événement, face au plafond mensuel de la lettre : plafond atteint, le prochain envoi
 * possible est le 1er du mois suivant (`nextAt`) ; si l'événement a lieu avant (`tooLate`), la commande est refusée.
 */
export function mailingSlot(sendsThisMonth: number, eventStart: Date, now = new Date()): { capped: boolean; nextAt: Date | null; tooLate: boolean; message: string | null } {
  if (sendsThisMonth < NEWSLETTER_MONTHLY_MAX) return { capped: false, nextAt: null, tooLate: false, message: null };
  const nextAt = nextParisMonthStart(now);
  const tooLate = eventStart <= nextAt;
  return {
    capped: true,
    nextAt,
    tooLate,
    message: tooLate
      ? `Plafond de la lettre d'information atteint ce mois-ci (${NEWSLETTER_MONTHLY_MAX} envois) : prochain envoi possible le ${firstOfMonthLabel(nextAt)}, après l'événement. L'e-mailing ne peut pas être commandé.`
      : `Plafond de la lettre d'information atteint ce mois-ci (${NEWSLETTER_MONTHLY_MAX} envois) : prochain envoi possible le ${firstOfMonthLabel(nextAt)}.`,
  };
}
