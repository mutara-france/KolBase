import { isIP } from "node:net";
import { normName } from "@/lib/intelligence";

/**
 * Veille des sites spécialisés (KolBase Intelligence) : lecture des flux RSS et Atom, contrôle des adresses relevées
 * et recherche des mentions. Module pur, testé. Seuls le titre, le lien, la date et un court extrait sont repris :
 * l'article se lit sur le site d'origine.
 */

export type FeedItem = { title: string; url: string; summary: string | null; publishedAt: Date | null };

const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'", nbsp: " ", eacute: "é", egrave: "è", ecirc: "ê", agrave: "à", acirc: "â", ccedil: "ç", ocirc: "ô", ucirc: "û", ugrave: "ù", icirc: "î", rsquo: "’", lsquo: "‘", laquo: "«", raquo: "»", hellip: "…", ndash: "–", mdash: "—", euro: "€" };
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, e: string) => {
    if (e[0] !== "#") return ENTITIES[e] ?? m;
    const code = e[1] === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1));
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
  });
/**
 * Texte d'un élément XML : CDATA dépliée, balises HTML retirées et entités décodées, deux fois (le HTML d'un flux est
 * souvent échappé : « &amp;lt;p&amp;gt; », « &amp;nbsp; »), espaces resserrés. Le résultat est affiché comme du texte.
 */
const plain = (s: string) => {
  const pass = (x: string) => decode(x.replace(/<[^>]*>/g, " "));
  return pass(pass(s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1"))).replace(/\s+/g, " ").trim();
};
const tag = (xml: string, names: string[]) => {
  for (const n of names) {
    const m = new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`, "i").exec(xml);
    if (m) return m[1];
  }
  return "";
};
const cut = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

/** Adresse d'article reprise d'un flux : http(s) seulement (jamais « javascript: » ou autre). */
const articleUrl = (v: string) => {
  try {
    const u = new URL(decode(v.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")).trim());
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString().slice(0, 600) : null;
  } catch {
    return null;
  }
};

/** Publications d'un flux RSS 2.0 (<item>) ou Atom (<entry>) ; un document qui n'est ni l'un ni l'autre ne donne rien. */
export function parseFeed(xml: string, max = 60): FeedItem[] {
  const items: FeedItem[] = [];
  for (const m of xml.matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)) {
    const body = m[2];
    const title = cut(plain(tag(body, ["title"])), 240);
    // Atom : <link href="…"> (de préférence rel="alternate") ; RSS : <link>…</link>, à défaut <guid>.
    const links = [...body.matchAll(/<link\b([^>]*)\/?>/gi)].map((l) => ({ rel: /\brel="([^"]*)"/i.exec(l[1])?.[1] ?? "alternate", href: /\bhref="([^"]*)"/i.exec(l[1])?.[1] }));
    const url = articleUrl(links.find((l) => l.href && l.rel === "alternate")?.href ?? links.find((l) => l.href)?.href ?? (tag(body, ["link"]) || tag(body, ["guid", "id"])));
    if (!title || !url) continue;
    const date = new Date(plain(tag(body, ["pubDate", "published", "updated", "dc:date"])));
    const summary = cut(plain(tag(body, ["description", "summary", "content", "content:encoded"])), 300);
    items.push({ title, url, summary: summary || null, publishedAt: Number.isNaN(date.getTime()) ? null : date });
    if (items.length >= max) break;
  }
  return items;
}

/** Adresse IP réservée (boucle locale, réseaux privés, lien local, métadonnées d'hébergeur) : jamais relevée. */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  if (v === 6) {
    const x = ip.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(x);
    return mapped ? isPrivateAddress(mapped[1]) : x === "::" || x === "::1" || /^f[cd]/.test(x) || /^fe[89ab]/.test(x) || x.startsWith("::ffff:");
  }
  return true;
}

/** Adresse de flux acceptable : https, nom de domaine public (ni adresse IP, ni nom interne), port par défaut. */
export function feedUrl(v: string): URL | null {
  let u: URL;
  try {
    u = new URL(v.trim());
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  if (u.protocol !== "https:" || u.port || u.username || u.password) return null;
  if (isIP(host.replace(/^\[|\]$/g, "")) || !host.includes(".") || /\.(local|localhost|internal|lan|home|test|invalid)$/.test(host)) return null;
  return u;
}

/** Termes de veille présents dans un texte, en mots entiers et sans tenir compte de la casse ni des accents. */
export function mentions<T extends { terms: readonly string[] }>(text: string, watched: readonly T[]): T[] {
  const hay = ` ${normName(text)} `;
  return watched.filter((w) => w.terms.some((t) => normName(t).length >= 3 && hay.includes(` ${normName(t)} `)));
}
