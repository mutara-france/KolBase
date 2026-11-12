/**
 * KolBase Business : règles de la marque d'une organisation (nom de domaine, couleur) — module pur, testé.
 * La marque n'est qu'un habillage : elle ne décide jamais d'un accès (les droits restent ceux du compte connecté).
 */

/** Hôte d'une requête (en-tête Host ou X-Forwarded-Host) : minuscules, sans port ni point final. */
export const hostOf = (v: string | null | undefined) => (v ?? "").split(",")[0].trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");

/** Cible du CNAME à créer par l'organisation : le service web de KolBase chez l'hébergeur. */
export const brandDomainTarget = () => process.env.BRAND_DOMAIN_TARGET || "kolbase-web.onrender.com";

export type DomainRefusal = "format" | "sous-domaine" | "reserve";
/**
 * Nom de domaine saisi par l'organisation (« https://kol.exemple.com/ » accepté) → nom normalisé, ou le motif du
 * refus. Un sous-domaine est exigé (un CNAME ne se pose pas sur la racine d'un domaine) ; l'adresse de KolBase, ses
 * sous-domaines et ceux de l'hébergeur sont réservés.
 */
export function asBrandDomain(v: string, appHost: string): { domain: string } | { refusal: DomainRefusal } {
  const d = v.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/[/?#].*$/, "").replace(/\.$/, "");
  const labels = d.split(".");
  if (d.length > 253 || labels.length < 2 || !labels.every((l) => /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(l)) || /^\d+$/.test(labels[labels.length - 1])) return { refusal: "format" };
  if (labels.length < 3) return { refusal: "sous-domaine" };
  const reserved = [appHost, brandDomainTarget(), "onrender.com", "kolbase.io", "kolbase.fr"].filter(Boolean);
  if (reserved.some((r) => d === r || d.endsWith(`.${r}`))) return { refusal: "reserve" };
  return { domain: d };
}
export const DOMAIN_REFUSAL: Record<DomainRefusal, string> = {
  format: "Nom de domaine invalide : indiquez un nom comme kol.votre-domaine.com.",
  "sous-domaine": "Indiquez un sous-domaine (kol.votre-domaine.com) : la racine d'un domaine ne peut pas pointer vers KolBase par un CNAME.",
  reserve: "Ce nom de domaine est réservé.",
};

type Rgb = [number, number, number];
const rgb = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
const hex = (c: Rgb) => `#${c.map((x) => Math.round(Math.min(255, Math.max(0, x))).toString(16).padStart(2, "0")).join("")}`;
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * t) as Rgb;
const luminance = (c: Rgb) => {
  const [r, g, b] = c.map((x) => (x / 255 <= 0.03928 ? x / 255 / 12.92 : ((x / 255 + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** Contraste (WCAG) d'une couleur avec le blanc : 4,5 au moins pour un texte blanc lisible sur les boutons. */
export const contrastWithWhite = (color: string) => 1.05 / (luminance(rgb(color)) + 0.05);
export const MIN_CONTRAST = 4.5;
/** Couleur saisie (#rrggbb) : normalisée, null si le format ne convient pas. */
export const asBrandColor = (v: string) => (/^#[0-9a-fA-F]{6}$/.test(v.trim()) ? v.trim().toLowerCase() : null);

/**
 * Variables CSS de la marque, dérivées de sa couleur principale : la couleur elle-même (boutons, liens), une teinte
 * sombre (barre latérale, pied de page) et une teinte très claire (fonds). Les autres couleurs de KolBase restent.
 */
export function brandPalette(color: string): Record<string, string> {
  const c = rgb(color);
  return { "--outremer": hex(c), "--outremer-deep": hex(mix(c, [0, 0, 0], 0.4)), "--indigo": hex(mix(c, [255, 255, 255], 0.2)), "--tint": hex(mix(c, [255, 255, 255], 0.9)) };
}

/** Marque servie sur un hôte : ce que lisent la mise en page et les composants (aucune donnée d'accès). */
export type Brand = { orgId: string; name: string; logo: string | null; color: string | null };
