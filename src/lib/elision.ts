/**
 * Élision de « de » devant un nom : « d'Académie Odonto Formation », « d'Hôtel Rive Gauche », mais « de Dentalys ».
 * Voyelles (accentuées comprises) et mots courants à h muet (hôtel, hôpital, hospices…) ; « Y » et les autres « h »
 * gardent « de » (h aspiré : « de Hachette ») ; « Le » et « Les » se contractent. Module sans dépendance, utilisable partout (pages, e-mails).
 */
const VOWEL = /^[aeiouàâäéèêëîïôöùûüœæ]/i;
const H_MUET = /^h(ô|o)(tel|pital|spice)|^hygi|^hom(é|e)o|^huma/i;

export const elides = (name: string) => VOWEL.test(name.trim()) || H_MUET.test(name.trim());
/** « de Dentalys », « d'Académie… » ; article contracté : « des Tables du Sud », « du Petit Traiteur ». */
export function de(name: string) {
  const art = /^(Les|Le)\s+(.*)$/.exec(name.trim());
  if (art) return `${art[1] === "Les" ? "des" : "du"} ${art[2]}`;
  return elides(name) ? `d'${name}` : `de ${name}`;
}

/** Texte saisi (motif, note) inséré dans une phrase qui a sa propre ponctuation : sans point final (« RNA.. » évité). */
export const inSentence = (s: string) => s.trim().replace(/[.\s]+$/, "");
