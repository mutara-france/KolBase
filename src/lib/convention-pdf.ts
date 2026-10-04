import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

const A4: [number, number] = [595.28, 841.89];
const M = 56; // marge
const INK = rgb(0.06, 0.09, 0.16);
const MUTED = rgb(0.28, 0.33, 0.41);
const BRAND = rgb(0.11, 0.31, 0.85);

/** Les polices standard PDF (WinAnsi) ne couvrent pas tout l'Unicode : on normalise. */
const clean = (s: string) =>
  s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/ | /g, " ")
    .replace(/×/g, "x").replace(/[^\x20-\x7E -ÿ€]/g, "");

class Writer {
  page!: PDFPage;
  y = 0;
  pageNo = 0;
  constructor(private doc: PDFDocument, private font: PDFFont, private bold: PDFFont, private footer: string) { this.newPage(); }
  newPage() {
    this.page = this.doc.addPage(A4);
    this.pageNo++;
    this.y = A4[1] - M;
    this.page.drawText(clean(this.footer), { x: M, y: 30, size: 8, font: this.font, color: MUTED });
    this.page.drawText(`Page ${this.pageNo}`, { x: A4[0] - M - 40, y: 30, size: 8, font: this.font, color: MUTED });
  }
  ensure(h: number) { if (this.y - h < 60) this.newPage(); }
  wrap(text: string, size: number, font: PDFFont, width: number) {
    const lines: string[] = [];
    for (const para of clean(text).split("\n")) {
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
      this.page.drawText(clean(k), { x: M, y: this.y - 10, size: 10, font: this.bold, color: MUTED });
      lines.forEach((l, i) => this.page.drawText(l, { x: M + 170, y: this.y - 10 - i * 14, size: 10, font: this.font, color: INK }));
      this.y -= Math.max(1, lines.length) * 14 + 4;
    }
  }
  signatures(left: string, right: string) {
    this.ensure(120);
    this.y -= 10;
    const w = (A4[0] - 2 * M - 30) / 2;
    [[left, M], [right, M + w + 30]].forEach(([label, x]) => {
      this.page.drawText(clean(label as string), { x: x as number, y: this.y - 10, size: 10, font: this.bold, color: INK });
      this.page.drawText("Date, nom, qualité et signature :", { x: x as number, y: this.y - 26, size: 9, font: this.font, color: MUTED });
      this.page.drawRectangle({ x: x as number, y: this.y - 110, width: w, height: 76, borderColor: MUTED, borderWidth: 0.5 });
    });
    this.y -= 120;
  }
}

const eur = (cents: number) => (cents / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
const dateFr = (d: Date) => d.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "long", year: "numeric" });

async function setup(title: string, footer: string) {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setProducer("Kolbase");
  doc.setCreator("Kolbase");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  return { doc, w: new Writer(doc, font, bold, footer) };
}

function header(w: Writer, title: string, ref: string, status: string) {
  w.text("KOLBASE", { size: 9, bold: true, color: BRAND, gap: 0 });
  w.text(title, { size: 18, bold: true, gap: 2 });
  w.text(`Réf. ${ref} - ${status} - éditée le ${dateFr(new Date())}`, { size: 9, color: MUTED, gap: 8 });
  w.rule();
}

export type CollabConventionInput = {
  ref: string;
  statusLabel: string;
  org: { name: string; headquarters: string | null; contactEmail: string | null; policy: string | null };
  expert: { firstName: string; lastName: string; email: string; profession: string; rpps: string | null; city: string | null; structure?: { name: string; legalForm: string; siren: string | null } | null };
  project: { title: string; typeLabel: string; unit: string; therapeuticArea: string | null; description: string | null; ordreRef: string | null };
  link: { units: number | null; feeCents: number | null };
  fmv: { min: number; max: number; perUnit: number; verdict: "ok" | "above" | "below" } | null;
};

export async function buildCollaborationConvention(i: CollabConventionInput) {
  const { doc, w } = await setup(`Convention - ${i.project.title}`, `Kolbase - Convention ${i.ref} - document généré, à faire valider par le service juridique avant signature.`);
  header(w, "Convention de collaboration", i.ref, i.statusLabel);

  w.heading("Entre les soussignés");
  w.text(`${i.org.name}${i.org.headquarters ? `, ${i.org.headquarters}` : ""}${i.org.contactEmail ? ` (${i.org.contactEmail})` : ""}, ci-après « l'Organisation »,`);
  w.text("et", { color: MUTED });
  const e = i.expert;
  w.text(
    `Dr ${e.firstName} ${e.lastName}, ${e.profession}${e.city ? ` exerçant à ${e.city}` : ""}${e.rpps ? `, n° RPPS ${e.rpps}` : ""}, ${e.email}` +
      (e.structure ? `, agissant pour le compte de ${e.structure.name} (${e.structure.legalForm}${e.structure.siren ? `, SIREN ${e.structure.siren}` : ""})` : "") +
      ", ci-après « l'Expert ».",
  );

  w.heading("Article 1 - Objet");
  w.text(`L'Organisation confie à l'Expert, qui l'accepte, la prestation suivante : ${i.project.typeLabel} - « ${i.project.title} »${i.project.therapeuticArea ? ` (domaine : ${i.project.therapeuticArea})` : ""}.`);
  if (i.project.description) w.text(i.project.description, { color: MUTED });

  w.heading("Article 2 - Prestations et rémunération");
  const units = i.link.units ?? 1;
  w.rows([
    ["Nature", i.project.typeLabel],
    ["Volume", `${units} ${i.project.unit}${units > 1 ? "s" : ""}`],
    ["Honoraires", i.link.feeCents != null ? `${eur(i.link.feeCents)} HT, forfaitaires et définitifs` : "À définir"],
    ...(i.fmv
      ? ([["Juste contrepartie", `${Math.round(i.fmv.perUnit).toLocaleString("fr-FR")} € HT par ${i.project.unit} - référence ${i.fmv.min.toLocaleString("fr-FR")} à ${i.fmv.max.toLocaleString("fr-FR")} € (${i.fmv.verdict === "ok" ? "conforme" : i.fmv.verdict === "above" ? "au-dessus, justification requise" : "en dessous"})`]] as [string, string][])
      : []),
    ["Paiement", "Par virement, à 30 jours après réalisation de la prestation et réception de la facture."],
  ]);
  w.text("Les frais de déplacement et d'hébergement éventuellement pris en charge par l'Organisation sont limités au strict nécessaire à la prestation et font l'objet d'une déclaration distincte.", { color: MUTED });

  w.heading("Article 3 - Encadrement réglementaire");
  w.text("La présente convention est conclue dans le respect des articles L.1453-1 et suivants du Code de la santé publique (dispositif dit « anti-cadeaux » et transparence des liens d'intérêts).");
  w.text(i.project.ordreRef ? `Elle a été soumise à l'instance ordinale compétente : ${i.project.ordreRef}.` : "Elle est soumise, selon le montant en jeu, à déclaration ou à autorisation préalable auprès de l'instance ordinale compétente, avant son exécution.");
  w.text("Son existence, son objet et les rémunérations versées sont rendus publics sur la base Transparence Santé, conformément à la réglementation.");

  w.heading("Article 4 - Indépendance et confidentialité");
  w.text("L'Expert conserve une totale indépendance scientifique. Il s'engage à déclarer ses liens d'intérêts lors de toute intervention publique en lien avec l'Organisation, et à garder confidentielles les informations non publiques portées à sa connaissance.");

  w.heading("Article 5 - Durée");
  w.text("La convention prend effet à sa signature par les deux parties et, le cas échéant, après obtention de l'autorisation ordinale. Elle prend fin à l'achèvement de la prestation.");

  if (i.org.policy) { w.heading("Politique de collaboration de l'Organisation"); w.text(i.org.policy, { color: MUTED }); }

  w.heading("Signatures");
  w.signatures(`Pour ${i.org.name}`, `Dr ${e.firstName} ${e.lastName}`);
  return doc.save();
}

export type HospitalityConventionInput = {
  ref: string;
  org: { name: string; headquarters: string | null };
  beneficiary: { firstName: string; lastName: string; email: string; profession: string | null; rpps: string | null; structure: string | null };
  event: { title: string; startsAt: Date; city: string | null; venue: string | null; typeLabel: string };
  benefits: { label: string; valueCents: number }[];
  declared: boolean;
  declarationRef: string | null;
};

export async function buildHospitalityConvention(i: HospitalityConventionInput) {
  const { doc, w } = await setup(`Convention d'hospitalité - ${i.event.title}`, `Kolbase - Convention d'hospitalité ${i.ref}`);
  header(w, "Convention d'hospitalité", i.ref, i.declared ? `Déclarée${i.declarationRef ? ` (${i.declarationRef})` : ""}` : "À déclarer");

  w.heading("Parties");
  w.text(`${i.org.name}${i.org.headquarters ? `, ${i.org.headquarters}` : ""}, organisateur, et`);
  const b = i.beneficiary;
  w.text(`${b.firstName} ${b.lastName}${b.profession ? `, ${b.profession}` : ""}${b.rpps ? `, n° RPPS ${b.rpps}` : ""}${b.structure ? `, ${b.structure}` : ""} (${b.email}), bénéficiaire.`);

  w.heading("Manifestation");
  w.rows([
    ["Événement", `${i.event.title} (${i.event.typeLabel})`],
    ["Date", dateFr(i.event.startsAt)],
    ["Lieu", [i.event.venue, i.event.city].filter(Boolean).join(", ") || "-"],
  ]);

  w.heading("Avantages acceptés par le bénéficiaire");
  w.rows(i.benefits.map((x) => [x.label, `${eur(x.valueCents)} TTC`] as [string, string]));
  const total = i.benefits.reduce((s, x) => s + x.valueCents, 0);
  w.rows([["Total", `${eur(total)} TTC`]]);

  w.heading("Engagements");
  w.text("L'hospitalité offerte est d'un niveau raisonnable, strictement limitée à l'objet scientifique ou professionnel de la manifestation, et ne s'étend pas aux personnes accompagnant le bénéficiaire.");
  w.text("Conformément aux articles L.1453-1 et suivants du Code de la santé publique, la présente convention est déclarée à l'instance ordinale compétente et rendue publique sur la base Transparence Santé.");
  w.text("Le bénéficiaire a accepté chacun de ces avantages individuellement lors de son inscription sur Kolbase.", { color: MUTED });

  w.heading("Signatures");
  w.signatures(`Pour ${i.org.name}`, `${b.firstName} ${b.lastName}`);
  return doc.save();
}

export const pdfResponse = (bytes: Uint8Array, filename: string) =>
  new Response(Buffer.from(bytes), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${filename}"`, "Cache-Control": "private, no-store" },
  });
