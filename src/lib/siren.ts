/** SIREN : saisie, clé de contrôle et vérification auprès de l'API publique Recherche d'entreprises. */

/** SIREN (9 chiffres) tiré d'une saisie de SIREN ou de SIRET (14 chiffres), espaces tolérés ; null sinon. */
export function parseSiren(v: string): string | null {
  const digits = v.replace(/[\s.]/g, "");
  if (/^\d{14}$/.test(digits)) return digits.slice(0, 9);
  return /^\d{9}$/.test(digits) ? digits : null;
}

/** Clé de Luhn du SIREN (La Poste, 356 000 000, fait exception). */
export function sirenKeyOk(siren: string): boolean {
  if (siren === "356000000") return true;
  let sum = 0;
  for (let i = 0; i < siren.length; i++) {
    let d = Number(siren[siren.length - 1 - i]);
    if (i % 2 === 1) d = d * 2 > 9 ? d * 2 - 9 : d * 2;
    sum += d;
  }
  return sum % 10 === 0;
}

export type SirenLookup = { found: false } | { found: true; name: string; active: boolean | null; city: string | null };

type ApiResult = {
  siren?: string;
  nom_complet?: string | null;
  nom_raison_sociale?: string | null;
  etat_administratif?: string | null;
  siege?: { libelle_commune?: string | null } | null;
};

/** Lecture d'une réponse de l'API (exportée pour les tests). */
export function readSirenResponse(siren: string, json: { results?: ApiResult[] }): SirenLookup {
  const r = json.results?.find((x) => x.siren === siren);
  if (!r) return { found: false };
  const state = r.etat_administratif;
  return {
    found: true,
    name: (r.nom_complet || r.nom_raison_sociale || "").trim() || siren,
    active: state === "A" ? true : state === "C" ? false : null,
    city: r.siege?.libelle_commune ?? null,
  };
}

const API = process.env.SIREN_API_URL ?? "https://recherche-entreprises.api.gouv.fr";

/** Interroge l'API (sans clé). null si elle ne répond pas : la validation par un administrateur reste possible. */
export async function lookupSiren(siren: string): Promise<SirenLookup | null> {
  try {
    const res = await fetch(`${API}/search?q=${siren}&page=1&per_page=1`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(6000), cache: "no-store" });
    if (!res.ok) return null;
    return readSirenResponse(siren, (await res.json()) as { results?: ApiResult[] });
  } catch {
    return null;
  }
}
