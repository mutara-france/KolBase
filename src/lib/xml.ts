/**
 * Lecture minimale de XML pour des fichiers déposés ou relevés (classeur Excel, flux RSS) : contenu fourni par un
 * tiers, donc lu en temps linéaire. Une expression régulière du type « <row>…</row> » relit la fin du document à
 * chaque balise restée ouverte : sur un fichier piégé de plusieurs mégaoctets, le serveur n'en sortirait pas.
 */

const AFTER_NAME = new Set([">", "/", " ", "\n", "\r", "\t"]);

/** Éléments <name …>…</name> ou <name …/> d'un texte, de gauche à droite (non imbriqués). */
export function* elements(xml: string, name: string): Generator<{ attrs: string; body: string }> {
  const open = `<${name}`;
  const close = `</${name}>`;
  let at = 0;
  for (;;) {
    const start = xml.indexOf(open, at);
    if (start < 0) return;
    // « <c » ne doit pas prendre « <cols> », ni « <content » prendre « <content:encoded ».
    if (!AFTER_NAME.has(xml[start + open.length] ?? "")) {
      at = start + open.length;
      continue;
    }
    const gt = xml.indexOf(">", start);
    if (gt < 0) return;
    if (xml[gt - 1] === "/") {
      yield { attrs: xml.slice(start + open.length, gt - 1), body: "" };
      at = gt + 1;
      continue;
    }
    const end = xml.indexOf(close, gt);
    if (end < 0) return;
    yield { attrs: xml.slice(start + open.length, gt), body: xml.slice(gt + 1, end) };
    at = end + close.length;
  }
}

/** Premier élément de ce nom, ou null. */
export function element(xml: string, name: string) {
  for (const e of elements(xml, name)) return e;
  return null;
}

/** Valeur d'un attribut (name="…") dans le texte des attributs d'une balise. */
export function attr(attrs: string, name: string): string | null {
  const key = `${name}="`;
  for (let at = attrs.indexOf(key); at >= 0; at = attrs.indexOf(key, at + 1)) {
    // Début de mot : « r= » ne doit pas prendre la fin de « xml:spr= ».
    if (at > 0 && !/\s/.test(attrs[at - 1])) continue;
    const end = attrs.indexOf('"', at + key.length);
    return end < 0 ? null : attrs.slice(at + key.length, end);
  }
  return null;
}
