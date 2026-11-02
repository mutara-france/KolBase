/**
 * Pays d'exercice des praticiens : identifiant professionnel attendu et règles applicables.
 *
 * Le dispositif anti-cadeaux français (déclaration ou autorisation sur la plateforme EPS) vise les
 * personnes qui exercent en France ; un praticien qui exerce à l'étranger relève des règles de son
 * pays (Sunshine Act belge, Open Payments américain…) et, pour les industriels qui en sont membres,
 * du code MedTech Europe. Ces textes sont des aides : ils ne valent pas conseil juridique.
 */
import { luhnOk } from "@/lib/professions";

export type Regulation = "FR" | "BE" | "US" | "EU" | "AUTRE";

export type Country = {
  code: string;
  name: string;
  /** « en Belgique », « aux États-Unis »… */
  in: string;
  regulation: Regulation;
};

export const COUNTRIES: Country[] = [
  { code: "FR", name: "France", in: "en France", regulation: "FR" },
  { code: "BE", name: "Belgique", in: "en Belgique", regulation: "BE" },
  { code: "LU", name: "Luxembourg", in: "au Luxembourg", regulation: "EU" },
  { code: "CH", name: "Suisse", in: "en Suisse", regulation: "AUTRE" },
  { code: "MC", name: "Monaco", in: "à Monaco", regulation: "AUTRE" },
  { code: "DE", name: "Allemagne", in: "en Allemagne", regulation: "EU" },
  { code: "ES", name: "Espagne", in: "en Espagne", regulation: "EU" },
  { code: "IT", name: "Italie", in: "en Italie", regulation: "EU" },
  { code: "PT", name: "Portugal", in: "au Portugal", regulation: "EU" },
  { code: "NL", name: "Pays-Bas", in: "aux Pays-Bas", regulation: "EU" },
  { code: "IE", name: "Irlande", in: "en Irlande", regulation: "EU" },
  { code: "GR", name: "Grèce", in: "en Grèce", regulation: "EU" },
  { code: "PL", name: "Pologne", in: "en Pologne", regulation: "EU" },
  { code: "GB", name: "Royaume-Uni", in: "au Royaume-Uni", regulation: "AUTRE" },
  { code: "US", name: "États-Unis", in: "aux États-Unis", regulation: "US" },
  { code: "CA", name: "Canada", in: "au Canada", regulation: "AUTRE" },
  { code: "MA", name: "Maroc", in: "au Maroc", regulation: "AUTRE" },
  { code: "TN", name: "Tunisie", in: "en Tunisie", regulation: "AUTRE" },
  { code: "DZ", name: "Algérie", in: "en Algérie", regulation: "AUTRE" },
  { code: "LB", name: "Liban", in: "au Liban", regulation: "AUTRE" },
  { code: "XX", name: "Autre pays", in: "hors de France", regulation: "AUTRE" },
];

const BY_CODE = new Map(COUNTRIES.map((c) => [c.code, c]));
export const country = (code: string | null | undefined): Country => BY_CODE.get(code ?? "FR") ?? BY_CODE.get("XX")!;
export const isCountry = (code: string) => BY_CODE.has(code);
export const practicesInFrance = (code: string | null | undefined) => (code ?? "FR") === "FR";

/** NPI américain : 10 chiffres, clé de Luhn calculée avec le préfixe 80840 (spécification CMS). */
export const isNpi = (v: string) => /^\d{10}$/.test(v) && luhnOk(`80840${v}`);
/** Numéro INAMI belge : 11 chiffres. */
export const isInami = (v: string) => /^\d{11}$/.test(v);

/** Identifiant professionnel demandé selon le pays (hors France ; en France, c'est le RPPS). */
export function licenseRule(code: string): { label: string; short: string; hint: string; normalize: (v: string) => string; valid: (v: string) => boolean; error: string } {
  if (code === "BE")
    return {
      label: "Numéro INAMI",
      short: "numéro INAMI",
      hint: "11 chiffres, attribué par l'INAMI (vérifiable sur son moteur « Rechercher un dispensateur de soins »).",
      normalize: (v) => v.replace(/[\s.\-/]/g, ""),
      valid: isInami,
      error: "Numéro INAMI invalide : 11 chiffres.",
    };
  if (code === "US")
    return {
      label: "NPI (National Provider Identifier)",
      short: "NPI",
      hint: "10 chiffres, vérifiable sur le registre NPPES de la CMS. Précisez l'État de votre licence dans « Ville d'exercice ».",
      normalize: (v) => v.replace(/[\s-]/g, ""),
      valid: isNpi,
      error: "NPI invalide : 10 chiffres, le dernier étant une clé de contrôle.",
    };
  return {
    label: "N° d'inscription professionnelle",
    short: "numéro d'inscription professionnelle",
    hint: "Numéro d'inscription à l'Ordre ou à l'autorité du pays d'exercice, avec son nom (ex. « Ordre des médecins dentistes, n° 12345 »).",
    normalize: (v) => v.trim().replace(/\s+/g, " "),
    valid: (v) => v.length >= 3 && v.length <= 80,
    error: "Indiquez votre numéro d'inscription professionnelle (3 à 80 caractères).",
  };
}

/** Où l'administrateur KolBase vérifie l'identifiant. */
export function registryLink(code: string): { label: string; url: string } {
  if (code === "FR") return { label: "Annuaire Santé", url: "https://annuaire.sante.fr/" };
  if (code === "BE") return { label: "INAMI – Rechercher un dispensateur de soins", url: "https://www.inami.fgov.be/fr/programmes-web/rechercher-un-dispensateur-de-soins" };
  if (code === "US") return { label: "Registre NPPES (NPI)", url: "https://npiregistry.cms.hhs.gov/" };
  return { label: "Ordre ou autorité du pays d'exercice", url: "" };
}

/** Obligations à rappeler à l'organisation pour un praticien exerçant hors de France. */
export function foreignObligations(code: string): string[] {
  const c = country(code);
  const base = `Le praticien exerce ${c.in} : le dispositif anti-cadeaux français (déclaration ou autorisation sur la plateforme EPS) ne s'applique pas à lui. Vérifiez avec votre conseil si une publication sur Transparence Santé reste due.`;
  const medtech = "Membres de MedTech Europe : pas de prise en charge directe d'un praticien pour assister à un congrès organisé par un tiers (subventions éducatives uniquement) ; un orateur de symposium satellite intervient sous contrat de consultant.";
  if (c.regulation === "BE")
    return [
      base,
      "Belgique (Sunshine Act) : primes et avantages accordés au praticien à déclarer chaque année sur betransparent.be, y compris par une entreprise établie hors de Belgique.",
      "Manifestation scientifique de plusieurs jours avec hospitalité : visa préalable de Mdeon à demander.",
      medtech,
    ];
  if (c.regulation === "US")
    return [
      base,
      "États-Unis (Open Payments) : si votre entreprise est un « applicable manufacturer » (activité aux États-Unis), la rémunération d'un dentiste titulaire d'une licence américaine est à déclarer à la CMS, où que se déroule la prestation.",
    ];
  if (c.regulation === "EU") return [base, `Appliquez les règles de transparence et d'autorisation du pays d'exercice (${c.name}).`, medtech];
  return [base, "Appliquez les règles du pays d'exercice et votre politique interne de conformité."];
}

/** Clause « encadrement réglementaire » de la convention, selon le pays d'exercice de l'expert. */
export function conventionClause(code: string, t: (fr: string, vars?: Record<string, string>) => string = (fr, v) => (v ? fr.replace(/\{(\w+)\}/g, (m, k: string) => v[k] ?? m) : fr)): string[] {
  if (practicesInFrance(code))
    return [
      t("La présente convention est conclue dans le respect des articles L.1453-1 et suivants du Code de la santé publique (dispositif dit « anti-cadeaux » et transparence des liens d'intérêts)."),
    ];
  const c = country(code);
  const extra =
    c.regulation === "BE"
      ? ` ${t("L'Organisation déclare les avantages accordés sur la plateforme betransparent.be conformément à la loi belge dite « Sunshine Act ».")}`
      : c.regulation === "US"
        ? ` ${t("Le cas échéant, l'Organisation déclare la rémunération au programme américain Open Payments.")}`
        : "";
  return [`${t("L'Expert exerce {pays}. La présente convention est conclue dans le respect des règles applicables dans son pays d'exercice, notamment en matière de transparence des liens d'intérêts.", { pays: t(c.in) })}${extra}`];
}
