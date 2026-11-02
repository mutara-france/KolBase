/**
 * Informations légales de l'éditeur, reprises par les mentions légales, les CGU et la politique de confidentialité.
 * Un champ laissé à null s'affiche « [… à compléter] » et apparaît dans l'onglet Lancement de /admin.
 */
export const LEGAL = {
  editor: "Mutara France",
  legalForm: null as string | null, // forme sociale et capital, ex. « SAS au capital de 1 000 € »
  address: null as string | null, // adresse du siège social
  registration: null as string | null, // immatriculation, ex. « RCS Lyon 123 456 789 »
  vatNumber: null as string | null, // n° de TVA intracommunautaire (si assujetti)
  publicationDirector: null as string | null, // directeur ou directrice de la publication
  contactEmail: null as string | null, // contact général
  privacyContact: null as string | null, // contact pour les données personnelles (DPO le cas échéant)
  court: null as string | null, // juridiction compétente, ex. « tribunaux de Lyon »
  emailProvider: null as string | null, // prestataire d'envoi d'e-mails, ex. « Brevo (Sendinblue SAS, Paris) »
  storageProvider: null as string | null, // hébergeur des documents, ex. « Scaleway SAS, Paris »
};

export const LEGAL_LABEL: Record<keyof typeof LEGAL, string> = {
  editor: "nom de l'éditeur",
  legalForm: "forme sociale et capital",
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
