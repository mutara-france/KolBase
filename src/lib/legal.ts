/**
 * Informations légales de l'éditeur, reprises par les mentions légales, les CGU et la politique de confidentialité.
 * Un champ laissé à null s'affiche « [… à compléter] » et apparaît dans l'onglet Lancement de /admin.
 */
export const LEGAL = {
  // Registre du commerce (source : RNE / Pappers, novembre 2026).
  editor: "MUTARA",
  legalForm: "société par actions simplifiée (SAS)" as string | null,
  capital: "100 €" as string | null,
  address: "20 rue Léon Martine, 92290 Châtenay-Malabry" as string | null,
  registration: "au RCS de Nanterre sous le numéro 927 839 134" as string | null,
  vatNumber: "FR79927839134" as string | null,
  publicationDirector: "Kévin Peyrotte, président" as string | null, // représentant légal
  contactEmail: "contact@kolbase.io" as string | null,
  privacyContact: "contact@kolbase.io" as string | null, // données personnelles (DPO le cas échéant)
  court: "tribunaux de Nanterre" as string | null,
  // Hébergeur de l'application et de la base (LCEN, art. 6) : société américaine, serveurs dans l'Union européenne.
  host: "Render Services, Inc., 525 Brannan Street, Suite 300, San Francisco, CA 94107, États-Unis (privacy@render.com)" as string | null,
  hostRegion: "Francfort (Allemagne, Union européenne)" as string | null,
  // Envoi des e-mails (source : CGV LWS, RCS Épinal 851 993 683).
  emailProvider: "Ligne Web Services (LWS), Golbey (France)" as string | null,
  // Paiement des abonnements et des services (si STRIPE_SECRET_KEY).
  paymentProvider: "Stripe Payments Europe, Limited, Dublin (Irlande)" as string | null,
  storageProvider: null as string | null, // hébergeur des documents, ex. « Scaleway SAS, Paris »
  // Signature électronique des conventions (si YOUSIGN_API_KEY) : Yousign SAS, renommée Youtrust SAS en 2026
  // (RCS Caen 794 513 986, source : youtrust.com/fr-fr/mentions, novembre 2026).
  signatureProvider: "Youtrust SAS (anciennement Yousign), Caen" as string | null,
  // Assistant de rédaction (si ANTHROPIC_API_KEY) : modèle d'IA Claude.
  aiProvider: "Anthropic PBC, San Francisco (États-Unis)" as string | null,
};

export const LEGAL_LABEL: Record<keyof typeof LEGAL, string> = {
  editor: "nom de l'éditeur",
  legalForm: "forme sociale",
  capital: "capital social",
  address: "adresse du siège",
  registration: "immatriculation (RCS et SIREN)",
  vatNumber: "numéro de TVA",
  publicationDirector: "directeur de la publication",
  contactEmail: "adresse de contact",
  privacyContact: "contact données personnelles",
  court: "juridiction compétente",
  host: "hébergeur de l'application",
  hostRegion: "localisation des serveurs",
  emailProvider: "prestataire d'e-mails",
  paymentProvider: "prestataire de paiement",
  storageProvider: "hébergeur des documents",
  signatureProvider: "prestataire de signature électronique",
  aiProvider: "fournisseur de l'assistant de rédaction (IA)",
};

/** Valeur, ou « [… à compléter] ». */
export const legal = (key: keyof typeof LEGAL) => LEGAL[key] ?? `[${LEGAL_LABEL[key]} à compléter]`;

export const missingLegal = () => (Object.keys(LEGAL) as (keyof typeof LEGAL)[]).filter((k) => LEGAL[k] == null).map((k) => LEGAL_LABEL[k]);
