/**
 * Journaux et alertes : ni adresse e-mail complète, ni jeton présent dans une adresse (réinitialisation du mot de passe,
 * invitation, confirmation d'adresse, désinscription). Les journaux Render sont lisibles par tout le workspace et
 * conservés ; une alerte part par e-mail.
 */
const EMAIL = /([\p{L}\p{N}._%+-])[\p{L}\p{N}._%+-]*@([\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,})/gu;

/** « kevin@exemple.fr » → « k***@exemple.fr » (le domaine reste utile pour diagnostiquer un refus d'envoi). */
export const maskEmails = (s: string) => s.replace(EMAIL, "$1***@$2");

const TOKEN_SEGMENT = /\/(mot-de-passe|invitation|confirmer-email|desinscription)\/[^/?#]+/g;

/** Chemin journalisable : sans paramètres (?…) et sans jeton. */
export const redactPath = (p: string) => p.split(/[?#]/)[0].replace(TOKEN_SEGMENT, "/$1/…");

/** Message d'erreur journalisable (un refus SMTP cite l'adresse du destinataire). */
export const errorText = (e: unknown) => maskEmails(e instanceof Error ? e.message : String(e));
