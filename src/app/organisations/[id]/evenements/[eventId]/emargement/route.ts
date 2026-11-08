import { PDFDocument, rgb, type PDFPage } from "pdf-lib";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { embedPdfFonts, pdfResponse } from "@/lib/convention-pdf";
import { canCheckIn } from "@/lib/checkin";
import { formatDate, formatTime } from "@/lib/events";

const W = 595.28, H = 841.89, M = 40;
const INK = rgb(0.06, 0.05, 0.2), MUTED = rgb(0.29, 0.28, 0.4), BRAND = rgb(0.094, 0, 0.67), LINE = rgb(0.85, 0.84, 0.9);
const COLS = [{ label: "Nom", w: 150 }, { label: "Profession · structure", w: 175 }, { label: "Arrivée", w: 55 }, { label: "Signature", w: 135 }];
const ROW = 30;

/**
 * Feuille d'émargement (A4) : participants par ordre alphabétique, heure de pointage, colonne de signature.
 * Événement en demi-journées : une feuille par demi-journée, avec la signature électronique de chaque participant
 * (signée connecté à son compte, ou présence relevée par l'équipe) ; la colonne reste vide pour signer sur papier.
 */
export async function GET(_: Request, { params }: { params: Promise<{ id: string; eventId: string }> }) {
  const { id, eventId } = await params;
  const user = await getCurrentUser();
  const event = await db.event.findFirst({
    where: { id: eventId, organizationId: id },
    include: {
      organization: { select: { name: true, nda: true } },
      registrations: { where: { cancelledAt: null }, include: { user: { select: { firstName: true, lastName: true } }, attendances: true }, orderBy: [{ user: { lastName: "asc" } }, { user: { firstName: "asc" } }] },
      sessions: { orderBy: { startsAt: "asc" } },
    },
  });
  if (!user || !event || !canCheckIn(user, event)) return new Response("Introuvable.", { status: 404 });

  const doc = await PDFDocument.create();
  doc.setTitle(`Feuille d'émargement — ${event.title}`);
  doc.setProducer("KolBase");
  const { font, bold, clean } = await embedPdfFonts(doc);
  const fit = (text: string, f: typeof font, size: number, max: number) => {
    let t = clean(text);
    while (t.length > 1 && f.widthOfTextAtSize(t, size) > max) t = t.slice(0, -2) + "…";
    return t;
  };
  const present = event.registrations.filter((r) => r.checkedInAt).length;
  const sessions = event.sessions.length ? event.sessions : [null];
  let page = null as unknown as PDFPage;
  let y = 0;
  const header = (first: boolean, s: (typeof event.sessions)[number] | null) => {
    page = doc.addPage([W, H]);
    page.drawRectangle({ x: 0, y: H - 6, width: W, height: 6, color: BRAND });
    y = H - 50;
    if (first) {
      page.drawText(clean("Feuille d'émargement"), { x: M, y, size: 20, font: bold, color: INK });
      y -= 22;
      page.drawText(fit(event.title, bold, 12, W - 2 * M), { x: M, y, size: 12, font: bold, color: INK });
      y -= 16;
      const where = [event.venue, event.city].filter(Boolean).join(", ");
      const when = s ? `${formatDate(s.startsAt)}, de ${formatTime(s.startsAt)} à ${formatTime(s.endsAt)}` : `${formatDate(event.startsAt)} à ${formatTime(event.startsAt)}`;
      page.drawText(fit(`${when}${where ? ` · ${where}` : ""} · organisé par ${event.organization.name}${event.organization.nda ? ` (déclaration d'activité n° ${event.organization.nda})` : ""}`, font, 10, W - 2 * M), { x: M, y, size: 10, font, color: MUTED });
      y -= 14;
      const signed = s ? event.registrations.filter((r) => r.attendances.some((a) => a.sessionId === s.id)).length : present;
      page.drawText(clean(s ? `Demi-journée · ${event.registrations.length} inscrit(s) · ${signed} émargement(s) · éditée le ${formatDate(new Date())} à ${formatTime(new Date())}` : `${event.registrations.length} inscrit(s) · ${present} présent(s) au pointage · éditée le ${formatDate(new Date())} à ${formatTime(new Date())}`), { x: M, y, size: 10, font, color: MUTED });
      y -= 26;
    }
    let x = M;
    for (const c of COLS) {
      page.drawText(clean((s && c.label === "Arrivée" ? "Émargé" : c.label).toUpperCase()), { x: x + 4, y, size: 8, font: bold, color: MUTED });
      x += c.w;
    }
    y -= 8;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1, color: INK });
  };
  for (const s of sessions) {
    header(true, s);
    for (const r of event.registrations) {
      if (y - ROW < 50) header(false, s);
      const a = s ? r.attendances.find((x) => x.sessionId === s.id) : null;
      const cells = [
        `${r.user.lastName.toUpperCase()} ${r.user.firstName}`,
        [r.profession, r.structure].filter(Boolean).join(" · ") || "—",
        s ? (a ? formatTime(a.signedAt) : "") : r.checkedInAt ? formatTime(r.checkedInAt) : "",
        a ? (a.method === "self" ? "Signé en ligne (compte KolBase)" : "Présence relevée par l'équipe") : "",
      ];
      let x = M;
      cells.forEach((c, i) => {
        page.drawText(fit(c, i === 0 ? bold : font, i === 3 ? 8.5 : 9.5, COLS[i].w - 8), { x: x + 4, y: y - 19, size: i === 3 ? 8.5 : 9.5, font: i === 0 ? bold : font, color: i === 3 ? MUTED : INK });
        x += COLS[i].w;
      });
      y -= ROW;
      page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: LINE });
    }
    if (event.registrations.length === 0) page.drawText(clean("Aucune inscription."), { x: M, y: y - 20, size: 10, font, color: MUTED });
  }
  const pages = doc.getPages();
  pages.forEach((p, i) => p.drawText(clean(`KolBase · ${event.title} · page ${i + 1}/${pages.length}`), { x: M, y: 24, size: 8, font, color: MUTED }));
  return pdfResponse(await doc.save(), `emargement-${event.startsAt.toISOString().slice(0, 10)}.pdf`);
}
