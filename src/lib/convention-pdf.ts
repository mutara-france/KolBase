import { drPrefix } from "@/lib/professions";
import { conventionClause, country, licenseRule, practicesInFrance } from "@/lib/countries";
import { fmtDate, intlLocale, makeT, type Locale, type T } from "@/lib/i18n";
import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

const A4: [number, number] = [595.28, 841.89];
const M = 56; // marge
const INK = rgb(0.06, 0.09, 0.16);
const MUTED = rgb(0.28, 0.33, 0.41);
const BRAND = rgb(0.11, 0.31, 0.85);

/**
 * Police Unicode embarquée (DejaVu Sans : latin étendu, grec, cyrillique…) pour que les noms
 * « Łukasz Żółć » ou « Νίκος » figurent tels quels dans la convention. Repli sur Helvetica si
 * les fichiers sont absents. Un caractère que la police ne couvre pas (idéogrammes) devient « ? »
 * plutôt que de disparaître sans laisser de trace.
 */
const FONT_DIR = path.join(process.cwd(), "assets", "fonts");
let fontFiles: Promise<[Uint8Array, Uint8Array] | null> | null = null;
const loadFonts = () =>
  (fontFiles ??= Promise.all([readFile(path.join(FONT_DIR, "DejaVuSans.ttf")), readFile(path.join(FONT_DIR, "DejaVuSans-Bold.ttf"))])
    .then(([r, b]) => [new Uint8Array(r), new Uint8Array(b)] as [Uint8Array, Uint8Array])
    .catch(() => null));

/** Normalise le texte pour la police : espaces insécables, puis caractères couverts uniquement. */
function makeClean(covered: Set<number> | null) {
  return (s: string) => {
    const base = s.replace(/[\u00A0\u202F\u2007\t]/g, " ").replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, "");
    if (!covered) {
      // Polices standard PDF (WinAnsi) : on remplace la typographie, puis « ? » pour le reste.
      return base.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/×/g, "x")
        .replace(/[^\n\x20-\x7E\u00A0-\u00FF€]/g, "?");
    }
    let out = "";
    for (const ch of base) {
      const cp = ch.codePointAt(0)!;
      if (ch === "\n" || covered.has(cp)) { out += ch; continue; }
      // Lettre accentuée hors police : on garde au moins la lettre de base.
      const plain = ch.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      out += plain && [...plain].every((c) => covered.has(c.codePointAt(0)!)) ? plain : "?";
    }
    return out;
  };
}

class Writer {
  page!: PDFPage;
  y = 0;
  pageNo = 0;
  constructor(private doc: PDFDocument, private font: PDFFont, private bold: PDFFont, private footer: string, readonly clean: (s: string) => string) { this.newPage(); }
  newPage() {
    this.page = this.doc.addPage(A4);
    this.pageNo++;
    this.y = A4[1] - M;
    this.page.drawText(this.clean(this.footer), { x: M, y: 30, size: 8, font: this.font, color: MUTED });
    this.page.drawText(`Page ${this.pageNo}`, { x: A4[0] - M - 40, y: 30, size: 8, font: this.font, color: MUTED });
  }
  ensure(h: number) { if (this.y - h < 60) this.newPage(); }
  wrap(text: string, size: number, font: PDFFont, width: number) {
    const lines: string[] = [];
    for (const para of this.clean(text).split("\n")) {
      let line = "";
      for (const word of para.split(/\s+/)) {
        const tryLine = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(tryLine, size) > width && line) { lines.push(line); line = word; } else line = tryLine;
      }
      lines.push(line);
    }
    return lines;
  }
  text(t: string, o: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; gap?: number; indent?: number } = {}) {
    const size = o.size ?? 10;
    const font = o.bold ? this.bold : this.font;
    const x = M + (o.indent ?? 0);
    for (const line of this.wrap(t, size, font, A4[0] - M - x)) {
      this.ensure(size + 4);
      this.page.drawText(line, { x, y: this.y - size, size, font, color: o.color ?? INK });
      this.y -= size * 1.45;
    }
    this.y -= o.gap ?? 4;
  }
  heading(t: string) { this.y -= 6; this.ensure(40); this.text(t, { size: 12, bold: true, color: BRAND, gap: 2 }); }
  rule() { this.ensure(10); this.page.drawLine({ start: { x: M, y: this.y }, end: { x: A4[0] - M, y: this.y }, thickness: 0.5, color: MUTED }); this.y -= 10; }
  rows(rows: [string, string][]) {
    for (const [k, v] of rows) {
      const lines = this.wrap(v, 10, this.font, A4[0] - 2 * M - 170);
      this.ensure(lines.length * 14 + 2);
      this.page.drawText(this.clean(k), { x: M, y: this.y - 10, size: 10, font: this.bold, color: MUTED });
      lines.forEach((l, i) => this.page.drawText(l, { x: M + 170, y: this.y - 10 - i * 14, size: 10, font: this.font, color: INK }));
      this.y -= Math.max(1, lines.length) * 14 + 4;
    }
  }
  /** Cadres de signature dessinés (repère PDF : origine en bas à gauche), pour la signature électronique. */
  boxes: SignatureBox[] = [];
  signatures(left: string, right: string, caption = "Date, nom, qualité et signature :") {
    this.ensure(120);
    this.y -= 10;
    const w = (A4[0] - 2 * M - 30) / 2;
    [[left, M], [right, M + w + 30]].forEach(([label, x]) => {
      this.page.drawText(this.clean(label as string), { x: x as number, y: this.y - 10, size: 10, font: this.bold, color: INK });
      this.page.drawText(this.clean(caption), { x: x as number, y: this.y - 26, size: 9, font: this.font, color: MUTED });
      this.page.drawRectangle({ x: x as number, y: this.y - 110, width: w, height: 76, borderColor: MUTED, borderWidth: 0.5 });
      this.boxes.push({ page: this.pageNo, x: x as number, y: this.y - 110, width: w, height: 76, pageHeight: A4[1] });
    });
    this.y -= 120;
  }
}

/** « , n° RPPS … » en France, « , numéro INAMI … » (ou l'identifiant du pays) ailleurs. */
const identifierText = (t: T, p: { rpps: string | null; country?: string; licenseNumber?: string | null }) =>
  practicesInFrance(p.country) ? (p.rpps ? `, ${t("n° RPPS")} ${p.rpps}` : "") : p.licenseNumber ? `, ${t(licenseRule(p.country!).label)} ${p.licenseNumber}` : "";

const eur = (locale: Locale, cents: number) => (cents / 100).toLocaleString(intlLocale(locale), { style: "currency", currency: "EUR" });
const longDate = (locale: Locale, d: Date) => fmtDate(locale, d, { day: "numeric", month: "long", year: "numeric" });

async function setup(title: string, footer: string) {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setProducer("KolBase");
  doc.setCreator("KolBase");
  const files = await loadFonts();
  let font: PDFFont, bold: PDFFont, covered: Set<number> | null = null;
  if (files) {
    doc.registerFontkit(fontkit);
    font = await doc.embedFont(files[0], { subset: true });
    bold = await doc.embedFont(files[1], { subset: true });
    covered = new Set(font.getCharacterSet());
  } else {
    font = await doc.embedFont(StandardFonts.Helvetica);
    bold = await doc.embedFont(StandardFonts.HelveticaBold);
  }
  return { doc, w: new Writer(doc, font, bold, footer, makeClean(covered)) };
}

function header(w: Writer, t: T, locale: Locale, title: string, ref: string, status: string) {
  w.text("KOLBASE", { size: 9, bold: true, color: BRAND, gap: 0 });
  w.text(title, { size: 18, bold: true, gap: 2 });
  w.text(t("Réf. {ref} - {statut} - éditée le {date}", { ref, statut: status, date: longDate(locale, new Date()) }), { size: 9, color: MUTED, gap: 8 });
  // Version anglaise : traduction de courtoisie, la version française fait foi.
  if (locale !== "fr") w.text(t("Traduction fournie à titre d'information : en cas de divergence, la version française fait foi."), { size: 9, color: MUTED, gap: 8 });
  w.rule();
}

export type CollabConventionInput = {
  ref: string;
  statusLabel: string;
  org: { name: string; headquarters: string | null; contactEmail: string | null; policy: string | null };
  expert: { firstName: string; lastName: string; email: string; profession: string; rpps: string | null; city: string | null; country?: string; licenseNumber?: string | null; structure?: { name: string; legalForm: string; siren: string | null } | null };
  project: { title: string; typeLabel: string; unit: string; therapeuticArea: string | null; description: string | null; ordreRef: string | null };
  link: { units: number | null; feeCents: number | null };
  fmv: { min: number; max: number; perUnit: number; verdict: "ok" | "above" | "below" } | null;
  expertLocale?: string;
};

/** Titre « Dr » selon la langue. */
const dr = (t: T, profession: string) => (drPrefix(profession) ? `${t("Dr")} ` : "");

/** Cadre de signature : page (à partir de 1), position et taille en points, repère PDF (origine en bas à gauche). */
export type SignatureBox = { page: number; x: number; y: number; width: number; height: number; pageHeight: number };

export async function buildCollaborationConvention(i: CollabConventionInput, locale: Locale = "fr") {
  return (await buildCollaborationConventionForSignature(i, locale)).bytes;
}

/** Convention et position des cadres de signature (organisation, puis expert), pour la signature électronique. */
export async function buildCollaborationConventionForSignature(i: CollabConventionInput, locale: Locale = "fr") {
  const t = makeT(locale);
  const { doc, w } = await setup(`${t("Convention")} - ${i.project.title}`, t("KolBase - Convention {ref} - document généré, à faire valider par le service juridique avant signature.", { ref: i.ref }));
  header(w, t, locale, t("Convention de collaboration"), i.ref, t(i.statusLabel));

  w.heading(t("Entre les soussignés"));
  w.text(`${i.org.name}${i.org.headquarters ? `, ${i.org.headquarters}` : ""}${i.org.contactEmail ? ` (${i.org.contactEmail})` : ""}, ${t("ci-après « l'Organisation »,")}`);
  w.text(t("et"), { color: MUTED });
  const e = i.expert;
  w.text(
    `${dr(t, e.profession)}${e.firstName} ${e.lastName}, ${t(e.profession)}${e.city ? ` ${t("exerçant à {ville}", { ville: e.city })}` : ""}${practicesInFrance(e.country) ? "" : ` (${t(country(e.country).name)})`}${identifierText(t, e)}, ${e.email}` +
      (e.structure ? `, ${t("agissant pour le compte de {structure}", { structure: `${e.structure.name} (${e.structure.legalForm}${e.structure.siren ? `, SIREN ${e.structure.siren}` : ""})` })}` : "") +
      `, ${t("ci-après « l'Expert ».")}`,
  );

  w.heading(t("Article 1 - Objet"));
  w.text(
    t("L'Organisation confie à l'Expert, qui l'accepte, la prestation suivante : {nature} - « {titre} »{domaine}.", {
      nature: t(i.project.typeLabel),
      titre: i.project.title,
      domaine: i.project.therapeuticArea ? ` (${t("domaine : {domaine}", { domaine: t(i.project.therapeuticArea) })})` : "",
    }),
  );
  if (i.project.description) w.text(i.project.description, { color: MUTED });

  w.heading(t("Article 2 - Prestations et rémunération"));
  const units = i.link.units ?? 1;
  const unit = t(i.project.unit);
  w.rows([
    [t("Nature"), t(i.project.typeLabel)],
    [t("Volume"), `${units} ${unit}${units > 1 ? "s" : ""}`],
    [t("Honoraires"), i.link.feeCents != null ? t("{montant} HT, forfaitaires et définitifs", { montant: eur(locale, i.link.feeCents) }) : t("À définir")],
    ...(i.fmv
      ? ([[
          t("Juste contrepartie"),
          t("{prix} € HT par {unite} - référence {min} à {max} € ({verdict})", {
            prix: Math.round(i.fmv.perUnit).toLocaleString(intlLocale(locale)),
            unite: unit,
            min: i.fmv.min.toLocaleString(intlLocale(locale)),
            max: i.fmv.max.toLocaleString(intlLocale(locale)),
            verdict: t(i.fmv.verdict === "ok" ? "conforme" : i.fmv.verdict === "above" ? "au-dessus, justification requise" : "en dessous"),
          }),
        ]] as [string, string][])
      : []),
    [t("Paiement"), t("Par virement, à 30 jours après réalisation de la prestation et réception de la facture.")],
  ]);
  w.text(t("Les frais de déplacement et d'hébergement éventuellement pris en charge par l'Organisation sont limités au strict nécessaire à la prestation et font l'objet d'une déclaration distincte."), { color: MUTED });

  w.heading(t("Article 3 - Encadrement réglementaire"));
  for (const line of conventionClause(e.country ?? "FR", t)) w.text(line);
  if (practicesInFrance(e.country)) {
    w.text(i.project.ordreRef ? t("Elle a été soumise à l'instance ordinale compétente : {ref}.", { ref: i.project.ordreRef }) : t("Elle est soumise, selon le montant en jeu, à déclaration ou à autorisation préalable auprès de l'instance ordinale compétente, avant son exécution."));
    w.text(t("Son existence, son objet et les rémunérations versées sont rendus publics sur la base Transparence Santé, conformément à la réglementation."));
  }

  w.heading(t("Article 4 - Indépendance et confidentialité"));
  w.text(t("L'Expert conserve une totale indépendance scientifique. Il s'engage à déclarer ses liens d'intérêts lors de toute intervention publique en lien avec l'Organisation, et à garder confidentielles les informations non publiques portées à sa connaissance."));

  w.heading(t("Article 5 - Durée"));
  w.text(t("La convention prend effet à sa signature par les deux parties et, le cas échéant, après obtention de l'autorisation ordinale. Elle prend fin à l'achèvement de la prestation."));

  if (i.org.policy) { w.heading(t("Politique de collaboration de l'Organisation")); w.text(i.org.policy, { color: MUTED }); }

  w.heading(t("Signatures"));
  w.signatures(t("Pour {org}", { org: i.org.name }), `${dr(t, e.profession)}${e.firstName} ${e.lastName}`, t("Date, nom, qualité et signature :"));
  return { bytes: await doc.save(), boxes: w.boxes };
}

export type HospitalityConventionInput = {
  ref: string;
  org: { name: string; headquarters: string | null };
  beneficiary: { firstName: string; lastName: string; email: string; profession: string | null; rpps: string | null; structure: string | null; country?: string; licenseNumber?: string | null };
  event: { title: string; startsAt: Date; city: string | null; venue: string | null; typeLabel: string };
  benefits: { label: string; valueCents: number }[];
  declared: boolean;
  declarationRef: string | null;
};

export async function buildHospitalityConvention(i: HospitalityConventionInput, locale: Locale = "fr") {
  const t = makeT(locale);
  const { doc, w } = await setup(`${t("Convention d'hospitalité")} - ${i.event.title}`, t("KolBase - Convention d'hospitalité {ref}", { ref: i.ref }));
  header(w, t, locale, t("Convention d'hospitalité"), i.ref, i.declared ? `${t("Déclarée")}${i.declarationRef ? ` (${i.declarationRef})` : ""}` : t("À déclarer"));

  w.heading(t("Parties"));
  w.text(`${i.org.name}${i.org.headquarters ? `, ${i.org.headquarters}` : ""}, ${t("organisateur, et")}`);
  const b = i.beneficiary;
  w.text(`${b.firstName} ${b.lastName}${b.profession ? `, ${t(b.profession)}` : ""}${practicesInFrance(b.country) ? "" : ` (${t(country(b.country).name)})`}${identifierText(t, b)}${b.structure ? `, ${b.structure}` : ""} (${b.email}), ${t("bénéficiaire.")}`);

  w.heading(t("Manifestation"));
  w.rows([
    [t("Événement"), `${i.event.title} (${t(i.event.typeLabel)})`],
    [t("Date"), longDate(locale, i.event.startsAt)],
    [t("Lieu"), [i.event.venue, i.event.city].filter(Boolean).join(", ") || "-"],
  ]);

  w.heading(t("Avantages acceptés par le bénéficiaire"));
  w.rows(i.benefits.map((x) => [t(x.label), t("{montant} TTC", { montant: eur(locale, x.valueCents) })] as [string, string]));
  const total = i.benefits.reduce((s, x) => s + x.valueCents, 0);
  w.rows([[t("Total"), t("{montant} TTC", { montant: eur(locale, total) })]]);

  w.heading(t("Engagements"));
  w.text(t("L'hospitalité offerte est d'un niveau raisonnable, strictement limitée à l'objet scientifique ou professionnel de la manifestation, et ne s'étend pas aux personnes accompagnant le bénéficiaire."));
  if (practicesInFrance(b.country)) w.text(t("Conformément aux articles L.1453-1 et suivants du Code de la santé publique, la présente convention est déclarée à l'instance ordinale compétente et rendue publique sur la base Transparence Santé."));
  else for (const line of conventionClause(b.country ?? "XX", t)) w.text(line.replace(t("L'Expert exerce"), t("Le bénéficiaire exerce")));
  w.text(t("Le bénéficiaire a accepté chacun de ces avantages individuellement lors de son inscription sur KolBase."), { color: MUTED });

  w.heading(t("Signatures"));
  w.signatures(t("Pour {org}", { org: i.org.name }), `${b.firstName} ${b.lastName}`, t("Date, nom, qualité et signature :"));
  return doc.save();
}

export const pdfResponse = (bytes: Uint8Array, filename: string) =>
  new Response(Buffer.from(bytes), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${filename}"`, "Cache-Control": "private, no-store" },
  });
