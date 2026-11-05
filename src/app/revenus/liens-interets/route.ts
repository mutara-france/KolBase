import { PDFDocument, rgb } from "pdf-lib";
import { requireUser } from "@/lib/auth";
import { embedPdfFonts, pdfResponse } from "@/lib/convention-pdf";
import { INTEREST_YEARS, interestLines, practitionerLedger } from "@/lib/revenues";
import { drPrefix } from "@/lib/professions";
import { getT } from "@/lib/i18n/server";
import { intlLocale } from "@/lib/i18n";

const W = 960, H = 540, M = 56;
const INK = rgb(0.06, 0.05, 0.2), MUTED = rgb(0.29, 0.28, 0.4), BRAND = rgb(0.094, 0, 0.67);

/** Diapositive 16:9 « Déclaration de liens d'intérêts », à projeter en début d'intervention. */
export async function GET() {
  const user = await requireUser();
  const p = user.practitioner;
  const { t, locale } = await getT();
  if (!p) return new Response(t("Réservé aux praticiens."), { status: 404 });
  // Dans la langue de l'interface : la diapositive se projette aussi dans un congrès international.
  const lines = interestLines(await practitionerLedger(user.id, p.id), t);
  const doc = await PDFDocument.create();
  doc.setTitle(t("Déclaration de liens d'intérêts"));
  doc.setProducer("KolBase");
  const { font, bold, clean } = await embedPdfFonts(doc);
  const page = doc.addPage([W, H]);
  page.drawRectangle({ x: 0, y: H - 8, width: W, height: 8, color: BRAND });
  page.drawText(clean(t("Déclaration de liens d'intérêts")), { x: M, y: H - 80, size: 30, font: bold, color: INK });
  const today = new Date().toLocaleDateString(intlLocale(locale), { timeZone: "Europe/Paris", day: "numeric", month: "long", year: "numeric" });
  page.drawText(clean(t("{name} — au {date}, {n} dernières années", { name: `${drPrefix(p.profession)}${user.firstName} ${user.lastName}`, date: today, n: INTEREST_YEARS })), { x: M, y: H - 112, size: 14, font, color: MUTED });

  // Texte sur la largeur utile, police réduite si la liste est longue.
  const size = lines.length > 8 ? 12 : 15;
  const width = W - 2 * M;
  const wrap = (text: string, f: typeof font, s: number) => {
    const out: string[] = [];
    let line = "";
    for (const word of clean(text).split(/\s+/)) {
      const tryLine = line ? `${line} ${word}` : word;
      if (f.widthOfTextAtSize(tryLine, s) > width - 20 && line) { out.push(line); line = word; } else line = tryLine;
    }
    if (line) out.push(line);
    return out;
  };
  let y = H - 160;
  if (lines.length === 0) {
    page.drawText(clean(t("Aucun lien d'intérêts avec une entreprise du secteur au cours des {n} dernières années.", { n: INTEREST_YEARS })), { x: M, y, size: 17, font, color: INK });
  } else {
    for (const l of lines) {
      if (y < 70) { page.drawText(clean(t("… (liste complète sur demande)")), { x: M, y, size, font, color: MUTED }); break; }
      const rows = wrap(`${l.org} : ${l.natures.join(" ; ")}`, font, size);
      page.drawText("•", { x: M, y, size, font: bold, color: BRAND });
      rows.forEach((r, i) => page.drawText(r, { x: M + 18, y: y - i * (size + 5), size, font: i === 0 ? font : font, color: INK }));
      y -= rows.length * (size + 5) + 8;
    }
  }
  page.drawText(clean(t("Établie avec KolBase à partir des conventions, des hospitalités et des liens déclarés par l'intervenant.")), { x: M, y: 28, size: 9, font, color: MUTED });
  return pdfResponse(await doc.save(), "liens-interets.pdf");
}
