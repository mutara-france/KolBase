/**
 * Mise en page : chaque page principale, pour chaque profil (visiteur, praticien, organisation, administration),
 * sur téléphone (360 px), tablette (768 px) et ordinateur (1280 px), en français et en anglais (téléphone).
 * Repère : la page plus large que l'écran, un élément qui dépasse de son conteneur, un texte coupé, deux blocs
 * collés ou qui se chevauchent, une image cassée. Échoue sur toute anomalie.
 * Usage : BASE=http://localhost:3000 DEMO_PASSWORD=… node tests/e2e/affichage.mjs  (base fraîche, démo chargée)
 * Captures : SHOTS=/dossier pour enregistrer chaque page (relecture à l'œil).
 */
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:3000";
const PW = process.env.DEMO_PASSWORD;
const SHOTS = process.env.SHOTS;
const ONLY = process.env.ONLY; // filtre facultatif sur le chemin (expression régulière)
if (!PW) throw new Error("DEMO_PASSWORD est nécessaire.");
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const ORG = "/organisations/demo-org-dentalys";
const PROFILES = {
  public: [
    "/", "/experts", "/experts/demo-p-martin", "/evenements", "/evenements/demo-ev-soiree-implanto", "/appels", "/opportunites",
    "/opportunites/demo-call-bordeaux", "/structures", "/structures/demo-org-dentalys", "/annuaire",
    "/actualites", "/actualites/attestations-de-presence-et-questionnaire", "/aide", "/cgu", "/conditions-de-vente",
    "/confidentialite", "/mentions-legales", "/sous-traitance", "/connexion", "/inscription", "/mot-de-passe-oublie",
  ],
  "antoine.martin@demo.kolbase.local": [
    "/tableau-de-bord", "/revenus", "/revenus?onglet=facturation", "/revenus?onglet=liens", "/revenus?onglet=transparence",
    "/sollicitations", "/sollicitations/demo-prj-symposium-x0", "/propositions", "/propositions/nouvelle", "/inscriptions",
    "/interventions", "/interventions?onglet=candidatures", "/suivis", "/compte", "/organisations",
  ],
  "ines.lambert@demo.kolbase.local": ["/tableau-de-bord", "/inscriptions", "/inscriptions/demo-reg-soiree-implanto-lambert/badge", "/compte"],
  "claire.morel@demo.kolbase.local": [
    ORG, `${ORG}/evenements`, `${ORG}/evenements/nouveau`, `${ORG}/evenements/demo-ev-soiree-implanto`, `${ORG}/evenements/demo-ev-soiree-implanto/pointage`,
    `${ORG}/dossiers`, `${ORG}/dossiers?etat=tous`, `${ORG}/dossiers/nouveau`, `${ORG}/dossiers/demo-prj-board`, `${ORG}/dossiers/demo-prj-symposium`,
    `${ORG}/devis`, `${ORG}/devis?onglet=fiche`, `${ORG}/intervenants`, `${ORG}/hospitalites`, `${ORG}/statistiques`, `${ORG}/membres`,
    `${ORG}/membres?onglet=organisation`, `${ORG}/prestataires`, `${ORG}/prestataires?onglet=agences`, `${ORG}/prestataires?onglet=demandes`,
    `${ORG}/prestataires?onglet=nouvelle`, `${ORG}/conformite`, `${ORG}/conformite?onglet=autorisations`, `${ORG}/conformite?onglet=registre`,
    `${ORG}/conformite?onglet=transparence`, `${ORG}/conformite?onglet=parametres`, `${ORG}/relecture`, `${ORG}/integrations`,
    `${ORG}/abonnement`, `${ORG}/opportunites`, "/organisations/nouvelle",
  ],
  "anne.chevalier@demo.kolbase.local": [
    "/admin", "/admin?onglet=organisations", "/admin?onglet=praticiens", "/admin?onglet=abonnements", "/admin?onglet=services",
    "/admin?onglet=actualites", "/admin?onglet=lancement", "/admin/actualites/nouveau", "/admin/actualites/art-lettre-information", "/admin/services/lettre",
  ],
};
const VIEWPORTS = [
  { name: "telephone", width: 360, height: 780, locales: ["fr", "en"] },
  { name: "tablette", width: 768, height: 1024, locales: ["fr"] },
  { name: "ordinateur", width: 1280, height: 800, locales: ["fr"] },
];

/** Analyse exécutée dans la page : renvoie les anomalies de mise en page. */
function inspect() {
  const vw = document.documentElement.clientWidth;
  const out = [];
  const name = (el) => {
    const parts = [];
    for (let e = el, i = 0; e && e !== document.body && i < 4; e = e.parentElement, i++) {
      const cls = [...e.classList].filter((c) => !/^(on|active)$/.test(c)).slice(0, 2).join(".");
      parts.unshift(e.tagName.toLowerCase() + (cls ? `.${cls}` : ""));
    }
    const text = (el.innerText || el.getAttribute("aria-label") || el.getAttribute("alt") || "").trim().replace(/\s+/g, " ").slice(0, 40);
    return `${parts.join(" > ")}${text ? ` « ${text} »` : ""}`;
  };
  const shown = (el) => {
    // checkVisibility écarte aussi le contenu d'un <details> fermé.
    if (el.checkVisibility && !el.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: true })) return false;
    // Texte réservé aux lecteurs d'écran (boîte de 1 px découpée).
    for (let a = el; a && a !== document.body; a = a.parentElement) {
      const s = getComputedStyle(a);
      if ((s.clipPath !== "none" && s.clipPath.startsWith("inset")) || (s.clip && s.clip !== "auto")) return false;
    }
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return cs.display !== "none" && cs.visibility !== "hidden" && r.width > 0 && r.height > 0;
  };
  // Défilement horizontal voulu (tableaux, rangées d'onglets) ou contenu masqué volontairement.
  const clippedBy = (el) => {
    for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      const ox = getComputedStyle(a).overflowX;
      if (ox !== "visible") return a;
    }
    return null;
  };
  const boxed = (el) => {
    const cs = getComputedStyle(el);
    if (/^(BUTTON|IMG|TABLE)$/.test(el.tagName)) return true;
    if (parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth) + parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth) > 0) return true;
    const bg = cs.backgroundColor;
    return bg && bg !== "transparent" && !/rgba\(.*,\s*0\)$/.test(bg);
  };

  const over = document.documentElement.scrollWidth - vw;
  if (over > 1) out.push({ kind: "page-plus-large-que-l-ecran", px: over, where: "document" });

  const els = [...document.body.querySelectorAll("*")].filter((el) => !el.closest("svg, script, style, noscript, template") && shown(el));
  for (const el of els) {
    const cs = getComputedStyle(el);
    if (cs.position === "fixed" || cs.position === "absolute") continue;
    const r = el.getBoundingClientRect();
    const clip = clippedBy(el);
    // Hors de l'écran sans conteneur défilant.
    if (!clip && (r.right > vw + 1 || r.left < -1)) out.push({ kind: "deborde-de-l-ecran", px: Math.round(Math.max(r.right - vw, -r.left)), where: name(el) });
    // Dépasse la zone de contenu de son parent (ni défilant ni masqué).
    const p = el.parentElement;
    if (p && p !== document.body && getComputedStyle(p).overflowX === "visible" && getComputedStyle(p).display !== "contents" && !/^(inline|contents)$/.test(cs.display)) {
      const ps = getComputedStyle(p);
      const pr = p.getBoundingClientRect();
      const right = pr.right - parseFloat(ps.borderRightWidth) - parseFloat(ps.paddingRight);
      const left = pr.left + parseFloat(ps.borderLeftWidth) + parseFloat(ps.paddingLeft);
      const ml = parseFloat(cs.marginLeft), mr = parseFloat(cs.marginRight);
      if (ml >= 0 && mr >= 0 && (r.right > right + 1.5 || r.left < left - 1.5) && pr.width > 0) {
        out.push({ kind: "deborde-du-conteneur", px: Math.round(Math.max(r.right - right, left - r.left)), where: name(el) });
      }
    }
    // Texte coupé : contenu plus large que la boîte masquée, sans points de suspension.
    if (cs.overflowX === "hidden" && cs.textOverflow !== "ellipsis" && el.scrollWidth > el.clientWidth + 1 && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) {
      out.push({ kind: "texte-coupe", px: el.scrollWidth - el.clientWidth, where: name(el) });
    }
    // Défilement horizontal dans la page (tableau trop large sur téléphone…) : signalé pour relecture.
    if ((cs.overflowX === "auto" || cs.overflowX === "scroll") && el.scrollWidth > el.clientWidth + 1 && el !== document.documentElement) {
      out.push({ kind: "defilement-horizontal", px: el.scrollWidth - el.clientWidth, where: name(el), soft: true });
    }
    // Champ de saisie sans le style de l'application : bordure et angles droits du navigateur (un champ sans bordure,
    // posé dans une boîte stylée comme la recherche ou la messagerie, est voulu).
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) && !/^(checkbox|radio|hidden|file|range|color|submit)$/.test(el.type) && cs.borderTopLeftRadius === "0px" && parseFloat(cs.borderTopWidth) > 0) {
      out.push({ kind: "champ-sans-style", where: name(el) });
    }
    // Image cassée.
    if (el.tagName === "IMG" && el.complete && el.naturalWidth === 0) out.push({ kind: "image-cassee", where: name(el) });
    // Blocs voisins collés ou qui se chevauchent (hors cellules de tableau, hors gabarit de page, hors boutons
    // jointifs d'un sélecteur segmenté, voulus).
    if (/^(TR|THEAD|TBODY|TFOOT|TABLE|BODY)$/.test(el.tagName) || el.classList.contains("page") || [...el.classList].some((c) => c.startsWith("viz-"))) continue;
    const kids = [...el.children].filter((k) => shown(k) && !/^(inline)$/.test(getComputedStyle(k).display) && !["absolute", "fixed"].includes(getComputedStyle(k).position));
    const segmented = boxed(el) && /flex/.test(cs.display) && (parseFloat(cs.columnGap) || 0) === 0;
    // Étendue visible : la boîte entière si elle a un fond ou une bordure, sinon sa zone de contenu.
    const extent = (k) => {
      const r = k.getBoundingClientRect();
      if (boxed(k)) return r;
      const s = getComputedStyle(k);
      const px = (v) => parseFloat(v) || 0;
      return { left: r.left + px(s.paddingLeft) + px(s.borderLeftWidth), right: r.right - px(s.paddingRight) - px(s.borderRightWidth), top: r.top + px(s.paddingTop) + px(s.borderTopWidth), bottom: r.bottom - px(s.paddingBottom) - px(s.borderBottomWidth) };
    };
    for (let i = 1; i < kids.length; i++) {
      if (segmented) break;
      if (!(boxed(kids[i - 1]) || boxed(kids[i]))) continue;
      const a = extent(kids[i - 1]), b = extent(kids[i]);
      const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      // Chevauchement voulu : marge négative (carte posée à cheval sur un bandeau).
      const negative = parseFloat(getComputedStyle(kids[i]).marginTop) < 0 || parseFloat(getComputedStyle(kids[i]).marginLeft) < 0;
      if (overlapX > 2 && overlapY > 2) { if (!negative) out.push({ kind: "chevauchement", where: `${name(kids[i - 1])} ⟷ ${name(kids[i])}` }); continue; }
      // Liste à séparateurs : un filet entre deux lignes sans fond, voulu.
      const sa = getComputedStyle(kids[i - 1]), sb = getComputedStyle(kids[i]);
      const noFill = (s) => !s.backgroundColor || s.backgroundColor === "transparent" || /rgba\(.*,\s*0\)$/.test(s.backgroundColor);
      const divider = noFill(sa) && noFill(sb) && (overlapX > 2 ? parseFloat(sa.borderBottomWidth) > 0 || parseFloat(sb.borderTopWidth) > 0 : parseFloat(sa.borderRightWidth) > 0 || parseFloat(sb.borderLeftWidth) > 0);
      if (divider) continue;
      const gapX = overlapY > 2 ? Math.max(b.left - a.right, a.left - b.right) : Infinity;
      const gapY = overlapX > 2 ? Math.max(b.top - a.bottom, a.top - b.bottom) : Infinity;
      const gap = Math.min(gapX, gapY);
      if (gap >= -2 && gap < 4) out.push({ kind: "elements-colles", px: Math.round(gap), where: `${name(kids[i - 1])} ⟷ ${name(kids[i])}` });
    }
  }
  return out;
}

const browser = await chromium.launch();
const all = [];
for (const [who, paths] of Object.entries(PROFILES)) {
  for (const vp of VIEWPORTS) {
    for (const locale of vp.locales) {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, locale: locale === "en" ? "en-GB" : "fr-FR" });
      await ctx.addCookies([{ name: "kb_lang", value: locale, url: BASE }]);
      const page = await ctx.newPage();
      if (who !== "public") {
        await page.goto(`${BASE}/connexion`);
        await page.fill('input[name="email"]', who);
        await page.fill('input[name="password"]', PW);
        await page.press('input[name="password"]', "Enter");
        await page.waitForURL((u) => u.pathname !== "/connexion", { timeout: 15000 });
      }
      for (const path of paths) {
        if (ONLY && !new RegExp(ONLY).test(path)) continue;
        const res = await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
        const tag = `${vp.name}/${locale} ${who === "public" ? "visiteur" : who.split("@")[0]} ${path}`;
        if (!res || res.status() >= 400 || (who !== "public" && new URL(page.url()).pathname === "/connexion")) {
          all.push({ tag, kind: "page-indisponible", where: `HTTP ${res?.status()} → ${new URL(page.url()).pathname}` });
          continue;
        }
        await page.evaluate(() => document.fonts.ready);
        for (const f of await page.evaluate(inspect)) all.push({ tag, ...f });
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/${vp.name}-${locale}-${who.split("@")[0]}-${path.replace(/[/?=&]+/g, "_")}.png`, fullPage: true });
      }
      await ctx.close();
    }
  }
}
await browser.close();

// Une anomalie répétée sur plusieurs tailles ou profils n'est listée qu'une fois par page et par endroit.
const seen = new Map();
for (const f of all) {
  const key = `${f.kind}|${f.where}|${f.tag.split(" ").slice(2).join(" ")}`;
  if (!seen.has(key)) seen.set(key, { ...f, tags: [] });
  seen.get(key).tags.push(f.tag.split(" ").slice(0, 2).join(" "));
}
let hard = 0;
for (const f of seen.values()) {
  if (!f.soft) hard++;
  console.log(`${f.soft ? "info" : "FAIL"} ${f.kind}${f.px != null ? ` (${f.px} px)` : ""} ${f.tag.split(" ").slice(2).join(" ")} : ${f.where}\n       ${[...new Set(f.tags)].join(", ")}`);
}
console.log(`\n${seen.size} constats, ${hard} anomalies.`);
process.exit(hard ? 1 : 0);
