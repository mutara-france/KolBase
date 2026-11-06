/**
 * Régions françaises, déduites du code postal (département), ou à défaut du nom des principales villes.
 * Sert aux statistiques géographiques ; une adresse hors de France, ou sans indice, reste « Non renseignée ».
 */

const REGION_DEPTS: Record<string, string[]> = {
  "Auvergne-Rhône-Alpes": ["01", "03", "07", "15", "26", "38", "42", "43", "63", "69", "73", "74"],
  "Bourgogne-Franche-Comté": ["21", "25", "39", "58", "70", "71", "89", "90"],
  Bretagne: ["22", "29", "35", "56"],
  "Centre-Val de Loire": ["18", "28", "36", "37", "41", "45"],
  Corse: ["20"],
  "Grand Est": ["08", "10", "51", "52", "54", "55", "57", "67", "68", "88"],
  "Hauts-de-France": ["02", "59", "60", "62", "80"],
  "Île-de-France": ["75", "77", "78", "91", "92", "93", "94", "95"],
  Normandie: ["14", "27", "50", "61", "76"],
  "Nouvelle-Aquitaine": ["16", "17", "19", "23", "24", "33", "40", "47", "64", "79", "86", "87"],
  Occitanie: ["09", "11", "12", "30", "31", "32", "34", "46", "48", "65", "66", "81", "82"],
  "Pays de la Loire": ["44", "49", "53", "72", "85"],
  "Provence-Alpes-Côte d'Azur": ["04", "05", "06", "13", "83", "84"],
  Guadeloupe: ["971"],
  Martinique: ["972"],
  Guyane: ["973"],
  "La Réunion": ["974"],
  Mayotte: ["976"],
};

const BY_DEPT = new Map(Object.entries(REGION_DEPTS).flatMap(([region, depts]) => depts.map((d) => [d, region] as const)));

/** Principales villes (préfectures de région et grandes villes) : région quand le code postal manque. */
const CITY_REGION: Record<string, string> = {
  paris: "Île-de-France", boulogne: "Île-de-France", versailles: "Île-de-France", "saint-denis": "Île-de-France", nanterre: "Île-de-France", creteil: "Île-de-France",
  lyon: "Auvergne-Rhône-Alpes", grenoble: "Auvergne-Rhône-Alpes", "saint-etienne": "Auvergne-Rhône-Alpes", "clermont-ferrand": "Auvergne-Rhône-Alpes", annecy: "Auvergne-Rhône-Alpes", villeurbanne: "Auvergne-Rhône-Alpes",
  marseille: "Provence-Alpes-Côte d'Azur", nice: "Provence-Alpes-Côte d'Azur", toulon: "Provence-Alpes-Côte d'Azur", "aix-en-provence": "Provence-Alpes-Côte d'Azur", avignon: "Provence-Alpes-Côte d'Azur", cannes: "Provence-Alpes-Côte d'Azur",
  toulouse: "Occitanie", montpellier: "Occitanie", nimes: "Occitanie", perpignan: "Occitanie",
  bordeaux: "Nouvelle-Aquitaine", limoges: "Nouvelle-Aquitaine", poitiers: "Nouvelle-Aquitaine", "la rochelle": "Nouvelle-Aquitaine", pau: "Nouvelle-Aquitaine", bayonne: "Nouvelle-Aquitaine",
  nantes: "Pays de la Loire", angers: "Pays de la Loire", "le mans": "Pays de la Loire",
  rennes: "Bretagne", brest: "Bretagne", vannes: "Bretagne", quimper: "Bretagne",
  lille: "Hauts-de-France", amiens: "Hauts-de-France", roubaix: "Hauts-de-France",
  strasbourg: "Grand Est", reims: "Grand Est", metz: "Grand Est", nancy: "Grand Est", mulhouse: "Grand Est",
  rouen: "Normandie", caen: "Normandie", "le havre": "Normandie",
  dijon: "Bourgogne-Franche-Comté", besancon: "Bourgogne-Franche-Comté",
  tours: "Centre-Val de Loire", orleans: "Centre-Val de Loire",
  ajaccio: "Corse", bastia: "Corse",
};

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** Code postal français : 5 chiffres (Corse comprise, 20xxx). */
export const isFrenchPostalCode = (s: string) => /^\d{5}$/.test(s);

/** Région d'un lieu en France, d'après son code postal ou, à défaut, sa ville ; null si inconnue. */
export function regionOf(postalCode?: string | null, city?: string | null): string | null {
  const cp = (postalCode ?? "").replace(/\s/g, "");
  if (isFrenchPostalCode(cp)) {
    const dept = cp.startsWith("97") ? cp.slice(0, 3) : cp.slice(0, 2);
    const region = BY_DEPT.get(dept);
    if (region) return region;
  }
  if (!city) return null;
  // « Lyon 3e », « Paris (75008) » : premier mot significatif de la ville.
  const c = norm(city).replace(/\(.*\)/, "").replace(/\d.*$/, "").trim();
  return CITY_REGION[c] ?? null;
}

/** Ville présentable pour un regroupement : casse harmonisée, arrondissements regroupés (« Lyon 3e » → « Lyon »). */
export function cityLabel(city?: string | null): string | null {
  const c = (city ?? "").replace(/\(.*\)/, "").replace(/\s+\d.*$/, "").trim();
  if (!c) return null;
  return c.charAt(0).toUpperCase() + c.slice(1);
}

/** Clé de regroupement d'une ville (accents, casse et arrondissements ignorés). */
export const cityKey = (city?: string | null) => {
  const l = cityLabel(city);
  return l ? norm(l) : null;
};
