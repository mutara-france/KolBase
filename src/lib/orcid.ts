/** Lecture des travaux publics d'un chercheur via l'API publique ORCID (sans clé). */
export const ORCID_RE = /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/;

export type OrcidWork = { title: string; journal: string | null; year: number | null; doi: string | null };

type Summary = {
  title?: { title?: { value?: string } };
  "journal-title"?: { value?: string } | null;
  "publication-date"?: { year?: { value?: string } | null } | null;
  "external-ids"?: { "external-id"?: { "external-id-type"?: string; "external-id-value"?: string }[] } | null;
};

export async function fetchOrcidWorks(orcid: string): Promise<OrcidWork[]> {
  const res = await fetch(`https://pub.orcid.org/v3.0/${orcid}/works`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10000), cache: "no-store" });
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
