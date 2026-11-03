/** Lettre d'information : état du consentement stocké dans `User.notifyPrefs`. */
type Prefs = { notifyPrefs: unknown };

const prefsOf = (u: Prefs) => (u.notifyPrefs && typeof u.notifyPrefs === "object" ? (u.notifyPrefs as Record<string, unknown>) : {});

/** Abonné à la lettre d'information. */
export const subscribed = (u: Prefs) => prefsOf(u).newsletter === true;

/** La question n'a jamais été posée (ni à l'inscription, ni depuis « Mon compte », ni par le bandeau). */
export const newsletterPending = (u: Prefs) => {
  const p = prefsOf(u);
  return p.newsletter !== true && p.newsletterAsked !== true;
};
