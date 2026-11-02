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
  emailProvider: "LWS (Ligne Web Services, Paris)" as string | null,
  storageProvider: null as string | null, // hébergeur des documents, ex. « Scaleway SAS, Paris »
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
  emailProvider: "prestataire d'e-mails",
  storageProvider: "hébergeur des documents",
};

/** Valeur, ou « [… à compléter] ». */
export const legal = (key: keyof typeof LEGAL) => LEGAL[key] ?? `[${LEGAL_LABEL[key]} à compléter]`;

export const missingLegal = () => (Object.keys(LEGAL) as (keyof typeof LEGAL)[]).filter((k) => LEGAL[k] == null).map((k) => LEGAL_LABEL[k]);
