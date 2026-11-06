/**
 * Consentement aux cookies non nécessaires, selon les lignes directrices et la recommandation de la CNIL
 * (17 septembre 2020) : rien n'est déposé avant l'accord, refuser est aussi simple qu'accepter, le choix est donné
 * par finalité, conservé six mois puis redemandé, et modifiable à tout moment (« Gérer les cookies »).
 *
 * Les services de mesure d'audience et de marketing ne sont chargés que s'ils sont configurés (identifiant dans
 * l'environnement) et acceptés. Sans identifiant, le bandeau s'affiche mais aucun service tiers n'est chargé.
 */

export const CONSENT_COOKIE = "kb_consent";
/** Durée de conservation du choix (accord comme refus) : six mois, puis le bandeau revient. */
export const CONSENT_MAX_AGE = 182 * 24 * 3600;
const VERSION = "1";

export type ConsentCategory = "mesure" | "marketing";
export type Choice = Record<ConsentCategory, boolean>;
/** Choix enregistré : finalités acceptées et date (secondes), qui sert de preuve et d'échéance. */
export type Consent = Choice & { at: number };

/** Lit le cookie de choix ; null s'il manque, est illisible, périmé ou daté du futur (le bandeau s'affiche alors). */
export function readConsent(raw: string | undefined | null, now = Date.now()): Consent | null {
  const m = raw?.match(/^1\.(\d{9,11})\.([01])([01])$/);
  if (!m) return null;
  const at = Number(m[1]);
  const age = now / 1000 - at;
  if (age > CONSENT_MAX_AGE || age < -86400) return null;
  return { at, mesure: m[2] === "1", marketing: m[3] === "1" };
}

/** Valeur du cookie de choix : version, date (secondes), puis 1 ou 0 par finalité (mesure, marketing). */
export const writeConsent = (c: Choice, now = Date.now()) =>
  `${VERSION}.${Math.floor(now / 1000)}.${c.mesure ? 1 : 0}${c.marketing ? 1 : 0}`;

export type ServiceId = "ga" | "hubspot" | "meta";
export type OptionalService = { id: ServiceId; name: string; category: ConsentCategory; key: string; region?: "eu1" };

/**
 * Services soumis à consentement activés par l'environnement :
 * - GA_MEASUREMENT_ID (G-XXXXXXX) : Google Analytics 4, mesure d'audience ;
 * - HUBSPOT_PORTAL_ID (numéro du compte) et HUBSPOT_REGION (eu1 si le compte est hébergé en Europe) : HubSpot, marketing ;
 * - META_PIXEL_ID : pixel Meta (Facebook, Instagram), marketing.
 * Un identifiant mal formé est ignoré : mieux vaut aucun service qu'un script chargé vers une adresse inattendue.
 */
export function optionalServices(env: Record<string, string | undefined> = process.env): OptionalService[] {
  const out: OptionalService[] = [];
  const ga = env.GA_MEASUREMENT_ID?.trim();
  if (ga && /^G-[A-Z0-9]{4,20}$/.test(ga)) out.push({ id: "ga", name: "Google Analytics", category: "mesure", key: ga });
  const hs = env.HUBSPOT_PORTAL_ID?.trim();
  if (hs && /^\d{3,12}$/.test(hs))
    out.push({ id: "hubspot", name: "HubSpot", category: "marketing", key: hs, ...(env.HUBSPOT_REGION?.trim() === "eu1" ? { region: "eu1" as const } : {}) });
  const meta = env.META_PIXEL_ID?.trim();
  if (meta && /^\d{6,20}$/.test(meta)) out.push({ id: "meta", name: "Meta (Facebook, Instagram)", category: "marketing", key: meta });
  return out;
}

/** Cookies déposés par chaque service, supprimés quand l'accord est retiré. */
export const SERVICE_COOKIES: Record<ServiceId, RegExp> = {
  ga: /^(_ga|_ga_.+|_gid|_gat.*)$/,
  hubspot: /^(__hstc|__hssc|__hssrc|hubspotutk|__hs_.+|messagesUtk)$/,
  meta: /^(_fbp|_fbc)$/,
};

/** Origines à autoriser dans la politique de sécurité des contenus (CSP) pour les services activés. */
export const SERVICE_ORIGINS: Record<ServiceId, string[]> = {
  ga: ["https://www.googletagmanager.com", "https://*.google-analytics.com", "https://*.analytics.google.com"],
  hubspot: [
    "https://*.hs-scripts.com", "https://*.hs-analytics.net", "https://*.hs-banner.com", "https://*.hscollectedforms.net",
    "https://*.hubspot.com", "https://*.hubapi.com", "https://*.hsforms.com", "https://*.hsforms.net", "https://*.usemessages.com",
  ],
  meta: ["https://connect.facebook.net", "https://www.facebook.com"],
};

/** Ce que chaque service dépose et pour qui, pour la politique de confidentialité. */
export const SERVICE_DETAILS: Record<ServiceId, { cookies: string; who: string; duration: string }> = {
  ga: { cookies: "_ga, _ga_*", who: "Google Ireland Ltd", duration: "13 mois" },
  hubspot: { cookies: "__hstc, hubspotutk, __hssc, __hssrc", who: "HubSpot Ireland Ltd", duration: "6 mois au plus" },
  meta: { cookies: "_fbp, _fbc", who: "Meta Platforms Ireland Ltd", duration: "3 mois" },
};
