import { PDFDocument, rgb } from "pdf-lib";
import { embedPdfFonts } from "@/lib/convention-pdf";

/**
 * Notes d'honoraires des experts (pur : utilisable dans les tests).
 * La note est figée à l'émission : les données de l'émetteur, du destinataire et de l'objet y sont recopiées.
 */
export const vatBpOf = (regime: string) => (regime === "assujetti" ? 2000 : 0);

export type Billing = { billingAddress: string | null; siret: string | null; vatRegime: string; vatNumber: string | null; iban: string | null };
/** Délai de paiement, le même dans la convention et dans la note d'honoraires. */
export const PAYMENT_TERMS = "Par virement, à 30 jours après réalisation de la prestation et réception de la facture.";
export const billingComplete = (b: Billing) => !!b.billingAddress?.trim() && (b.vatRegime !== "assujetti" || !!b.vatNumber?.trim());

/** SIRET : 14 chiffres et clé de Luhn. */
export function validSiret(raw: string) {
  const v = raw.replace(/\s/g, "");
  if (!/^\d{14}$/.test(v)) return false;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    let d = Number(v[13 - i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

/** IBAN : format et clé (modulo 97). */
export function validIban(raw: string) {
  const v = raw.replace(/\s/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(v)) return false;
  const moved = v.slice(4) + v.slice(0, 4);
  let rem = 0;
  for (const ch of moved) {
    const n = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
    for (const d of n) rem = (rem * 10 + Number(d)) % 97;
  }
  return rem === 1;
}
export const formatIban = (raw: string) => raw.replace(/\s/g, "").toUpperCase().replace(/(.{4})/g, "$1 ").trim();

/** Numéro suivant : NH-AAAA-NNN (séquentiel par expert et par année). */
export const nextNumber = (year: number, existing: string[]) => {
  const prefix = `NH-${year}-`;
  const max = existing.filter((n) => n.startsWith(prefix)).reduce((m, n) => Math.max(m, Number(n.slice(prefix.length)) || 0), 0);
  return `${prefix}${String(max + 1).padStart(3, "0")}`;
};

export type FeeNoteData = {
  // Identifiant professionnel : RPPS en France ; ailleurs, celui du pays d'exercice (« Numéro INAMI … »), comme la convention.
  issuer: { name: string; entity: string | null; address: string; siret: string | null; vatNumber: string | null; rpps: string | null; license?: string | null; iban: string | null; vatRegime: string };
  recipient: { name: string; siren: string | null; address: string | null };
  object: { title: string; type: string; unit: string | null; units: number | null; signedAt: string | null; projectRef: string };
};

const W = 595.28, H = 841.89, M = 56;
const INK = rgb(0.06, 0.05, 0.2), MUTED = rgb(0.29, 0.28, 0.4), BRAND = rgb(0.094, 0, 0.67), LINE = rgb(0.85, 0.84, 0.9);
const eur = (c: number) => (c / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: 2 });
const day = (d: Date) => d.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "long", year: "numeric" });

/** PDF de la note d'honoraires (A4), à partir des données figées. */
export async function feeNotePdf(n: { number: string; issuedAt: Date; amountCents: number; vatBp: number; totalCents: number; data: FeeNoteData }) {
  const d = n.data;
  const doc = await PDFDocument.create();
  doc.setTitle(`Note d'honoraires ${n.number}`);
  doc.setProducer("KolBase");
  const { font, bold, clean } = await embedPdfFonts(doc);
  const page = doc.addPage([W, H]);
  const text = (s: string, x: number, y: number, size = 10, f = font, color = INK) => page.drawText(clean(s), { x, y, size, font: f, color });
  const right = (s: string, x: number, y: number, size = 10, f = font) => text(s, x - f.widthOfTextAtSize(clean(s), size), y, size, f);
  const lines = (s: string) => s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  page.drawRectangle({ x: 0, y: H - 8, width: W, height: 8, color: BRAND });
  text("Note d'honoraires", M, H - 70, 24, bold);
  text(`N° ${n.number} · émise le ${day(n.issuedAt)}`, M, H - 92, 11, font, MUTED);

  // Émetteur et destinataire.
  let y = H - 140;
  text("ÉMETTEUR", M, y, 8, bold, MUTED);
  text("DESTINATAIRE", W / 2 + 10, y, 8, bold, MUTED);
  y -= 16;
  const left = [d.issuer.entity ? `${d.issuer.entity}` : null, d.issuer.entity ? `représentée par ${d.issuer.name}` : d.issuer.name, ...lines(d.issuer.address), d.issuer.siret ? `SIRET ${d.issuer.siret}` : null, d.issuer.vatNumber ? `TVA ${d.issuer.vatNumber}` : null, d.issuer.license ?? (d.issuer.rpps ? `RPPS ${d.issuer.rpps}` : null)].filter(Boolean) as string[];
  const rightCol = [d.recipient.name, ...(d.recipient.address ? lines(d.recipient.address) : []), d.recipient.siren ? `SIREN ${d.recipient.siren}` : null].filter(Boolean) as string[];
  left.forEach((l, i) => text(l, M, y - i * 14, 10, i === 0 ? bold : font));
  rightCol.forEach((l, i) => text(l, W / 2 + 10, y - i * 14, 10, i === 0 ? bold : font));
  y -= Math.max(left.length, rightCol.length) * 14 + 24;

  // Objet.
  text("OBJET", M, y, 8, bold, MUTED);
  y -= 16;
  text(`${d.object.type} « ${d.object.title} »`, M, y, 11, bold);
  y -= 15;
  text(`Convention ${d.object.signedAt ? `signée le ${d.object.signedAt}` : "signée"} · référence ${d.object.projectRef}`, M, y, 10, font, MUTED);
  y -= 30;

  // Tableau.
  const cols = [M, W - M - 230, W - M - 140, W - M];
  text("DÉSIGNATION", cols[0], y, 8, bold, MUTED);
  right("QUANTITÉ", cols[1] + 50, y, 8, bold);
  right("PRIX UNITAIRE HT", cols[2] + 60, y, 8, bold);
  right("TOTAL HT", cols[3], y, 8, bold);
  y -= 8;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1, color: INK });
  y -= 18;
  const units = d.object.units && d.object.units > 0 ? d.object.units : 1;
  text(`Honoraires — ${d.object.type.toLowerCase()}`, cols[0], y, 10);
  right(`${units.toLocaleString("fr-FR")} ${d.object.unit ?? ""}`.trim(), cols[1] + 50, y, 10);
  right(eur(Math.round(n.amountCents / units)), cols[2] + 60, y, 10);
  right(eur(n.amountCents), cols[3], y, 10);
  y -= 12;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: LINE });
  y -= 22;
  const vat = n.totalCents - n.amountCents;
  right("Total HT", cols[2] + 60, y, 10); right(eur(n.amountCents), cols[3], y, 10); y -= 16;
  right(n.vatBp ? `TVA ${n.vatBp / 100} %` : "TVA", cols[2] + 60, y, 10); right(eur(vat), cols[3], y, 10); y -= 18;
  right("Net à payer", cols[2] + 60, y, 12, bold); right(eur(n.totalCents), cols[3], y, 12, bold); y -= 34;

  // Mentions.
  const mentions = [
    d.issuer.vatRegime === "assujetti" ? null : "TVA non applicable, article 293 B du CGI.",
    `Paiement : ${PAYMENT_TERMS.charAt(0).toLowerCase()}${PAYMENT_TERMS.slice(1)}`,
    d.issuer.iban ? `IBAN : ${d.issuer.iban}` : null,
    "En cas de retard de paiement : pénalités au taux de trois fois le taux d'intérêt légal et indemnité forfaitaire pour frais de recouvrement de 40 €.",
  ].filter(Boolean) as string[];
  for (const m of mentions) {
    const words = clean(m).split(" ");
    let line = "";
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(next, 9.5) > W - 2 * M && line) { text(line, M, y, 9.5, font, MUTED); y -= 13; line = w; } else line = next;
    }
    if (line) { text(line, M, y, 9.5, font, MUTED); y -= 17; }
  }
  text("Établie avec KolBase à partir de la convention signée. Vérifiez les mentions applicables à votre situation avec votre comptable.", M, 40, 8, font, MUTED);
  return doc.save();
}
