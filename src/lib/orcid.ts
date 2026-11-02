/** Lecture des travaux publics d'un chercheur via l'API publique ORCID (sans clé). */
export const ORCID_RE = /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/;

const PUB_API = (process.env.ORCID_PUB_API_URL ?? "https://pub.orcid.org/v3.0").replace(/\/$/, "");

/**
 * Connexion au compte ORCID (OAuth, portée /authenticate) : prouve que l'iD appartient au praticien.
 * Active si ORCID_CLIENT_ID et ORCID_CLIENT_SECRET sont définis (application déclarée sur orcid.org/developer-tools).
 */
export function orcidOAuth() {
  const id = process.env.ORCID_CLIENT_ID;
  const secret = process.env.ORCID_CLIENT_SECRET;
  return id && secret ? { id, secret, base: (process.env.ORCID_BASE_URL ?? "https://orcid.org").replace(/\/$/, "") } : null;
}

export type OrcidWork = { title: string; journal: string | null; year: number | null; doi: string | null };

type Summary = {
  title?: { title?: { value?: string } };
  "journal-title"?: { value?: string } | null;
  "publication-date"?: { year?: { value?: string } | null } | null;
  "external-ids"?: { "external-id"?: { "external-id-type"?: string; "external-id-value"?: string }[] } | null;
};

export async function fetchOrcidWorks(orcid: string): Promise<OrcidWork[]> {
  const res = await fetch(`${PUB_API}/${orcid}/works`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10000), cache: "no-store" });
  if (res.status === 404) throw new Error("Identifiant ORCID introuvable.");
  if (!res.ok) throw new Error(`ORCID indisponible (${res.status}).`);
  const json = (await res.json()) as { group?: { "work-summary"?: Summary[] }[] };
  const works: OrcidWork[] = [];
  for (const g of json.group ?? []) {
    const w = g["work-summary"]?.[0]; // première version = version préférée
    const title = w?.title?.title?.value?.trim();
    if (!w || !title) continue;
    const year = Number(w["publication-date"]?.year?.value) || null;
    const doi = w["external-ids"]?.["external-id"]?.find((x) => x["external-id-type"] === "doi")?.["external-id-value"]?.trim() || null;
    works.push({ title: title.slice(0, 500), journal: w["journal-title"]?.value?.trim() || null, year, doi });
  }
  return works.slice(0, 200);
}

export const normTitle = (t: string) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
