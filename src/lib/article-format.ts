/**
 * Mise en forme des actualités (module pur, testé) : un texte simple devient des blocs sûrs,
 * rendus en React sans HTML brut. Paragraphes séparés par une ligne vide, « ## » intertitre,
 * lignes « - » en liste, **gras** et [lien](https://… ou /…) dans le texte, « ![légende](/…) » seule
 * sur sa ligne pour une image du site.
 */
export const ARTICLE_CATEGORIES = ["Plateforme", "Réglementation", "Événements", "Partenaires", "Conseils", "Études"] as const;

export type Inline = { text: string; bold?: boolean; href?: string };
export type Block = { kind: "h2"; text: string } | { kind: "p"; parts: Inline[] } | { kind: "ul"; items: Inline[][] } | { kind: "img"; src: string; alt: string };

// Lien absolu http(s), ou chemin interne : « //hôte » (adresse relative au protocole) mènerait hors du site.
const internal = (h: string) => /^\/(?![/\\])[^\s<>"]*$/.test(h);
const safeHref = (h: string) => (/^https?:\/\/[^\s<>"]+$/i.test(h) || internal(h) ? h : null);

// Image servie par le site lui-même (dossier public) : aucune image extérieure, qui renseignerait un tiers sur les lecteurs.
function image(line: string): Block | null {
  const m = /^!\[([^\]]*)\]\(([^)\s]+)\)$/.exec(line);
  return m && internal(m[2]) ? { kind: "img", src: m[2], alt: m[1].trim() } : null;
}

export function inline(text: string): Inline[] {
  const out: Inline[] = [];
  const re = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push({ text: text.slice(last, m.index) });
    if (m[1] != null) out.push({ text: m[1], bold: true });
    else {
      const href = safeHref(m[3]);
      out.push(href ? { text: m[2], href } : { text: m[0] });
    }
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

export function parseArticle(body: string): Block[] {
  const blocks: Block[] = [];
  for (const chunk of body.replace(/\r\n/g, "\n").split(/\n\s*\n/)) {
    const lines = chunk.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) continue;
    if (lines.length === 1 && lines[0].startsWith("## ")) { blocks.push({ kind: "h2", text: lines[0].slice(3).trim() }); continue; }
    if (lines.every((l) => l.startsWith("- "))) { blocks.push({ kind: "ul", items: lines.map((l) => inline(l.slice(2))) }); continue; }
    let para: string[] = [];
    const flush = () => { if (para.length) blocks.push({ kind: "p", parts: inline(para.join(" ")) }); para = []; };
    for (const l of lines) {
      const img = image(l);
      if (l.startsWith("## ")) { flush(); blocks.push({ kind: "h2", text: l.slice(3).trim() }); }
      else if (img) { flush(); blocks.push(img); }
      else para.push(l);
    }
    flush();
  }
  return blocks;
}

/** Identifiant d'adresse lisible : « Nouveau : attestations vérifiables » → « nouveau-attestations-verifiables ». */
export const slugify = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "article";

/** Temps de lecture estimé (200 mots par minute, une minute au moins). */
export const readingMinutes = (body: string) => Math.max(1, Math.round(body.split(/\s+/).filter(Boolean).length / 200));
