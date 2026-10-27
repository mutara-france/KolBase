/** Recherche simple côté serveur pour les pages publiques (insensible à la casse et aux accents). */
export const normalize = (s: string | null | undefined) =>
  (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Vrai si chaque mot de la requête apparaît dans l'un des champs. Requête vide : toujours vrai. */
export function matches(query: string | undefined, ...fields: (string | null | undefined)[]) {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = normalize(fields.filter(Boolean).join(" "));
  return words.every((w) => hay.includes(w));
}
