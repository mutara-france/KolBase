/**
 * Données fictives de démonstration (prisma/seed.ts, retirées par scripts/purge-demo.ts) : mêmes critères que la purge.
 * Elles restent visibles sur le site, mais jamais indexées par les moteurs de recherche ni listées dans le plan du site :
 * des fiches « Dr Prénom Nom » inventées ne doivent pas apparaître dans Google.
 */
export const DEMO_EMAIL_DOMAIN = "@demo.kolbase.local";
export const DEMO_ID_PREFIX = "demo-";

export const isDemoEmail = (email: string) => email.endsWith(DEMO_EMAIL_DOMAIN);
export const isDemoOrgId = (id: string) => id.startsWith(DEMO_ID_PREFIX);

/** Filtres Prisma : praticiens et organisations réels seulement. */
export const realPractitioner = { user: { email: { not: { endsWith: DEMO_EMAIL_DOMAIN } } } } as const;
export const realOrganization = { id: { not: { startsWith: DEMO_ID_PREFIX } } } as const;
