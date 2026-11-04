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
