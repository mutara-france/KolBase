import "server-only";
import QRCode from "qrcode";
import { PDFDocument, rgb, type PDFImage } from "pdf-lib";
import { db } from "@/lib/db";
import { embedPdfFonts } from "@/lib/convention-pdf";
import { certificateUrl, ensureCertificateCode, eventEnd } from "@/lib/event-followup";
import { eventTypeLabel, formatDuration, formatTime, FORMAT_LABEL, TZ } from "@/lib/events";
import { drPrefix } from "@/lib/professions";
import { assessmentLabel, attendedHours, totalHours } from "@/lib/training";

const W = 595.28, H = 841.89, M = 60;
const INK = rgb(0.06, 0.05, 0.2), MUTED = rgb(0.29, 0.28, 0.4), BRAND = rgb(0.094, 0, 0.67), LINE = rgb(0.85, 0.84, 0.9);

/** Inscriptions attestables : présentes au pointage. */
export async function attestableRegistrations(where: { eventId: string; id?: string; userId?: string }) {
  return db.registration.findMany({
    where: { ...where, checkedInAt: { not: null } },
    include: {
      user: { select: { firstName: true, lastName: true, practitioner: { select: { rpps: true, profession: true } } } },
      event: { include: { organization: { select: { id: true, name: true, nda: true, qualiopi: true, logo: { select: { data: true, contentType: true } } } }, training: true, sessions: { orderBy: { startsAt: "asc" } } } },
      attendances: { select: { sessionId: true } },
    },
    orderBy: [{ user: { lastName: "asc" } }, { user: { firstName: "asc" } }],
  });
}
type Reg = Awaited<ReturnType<typeof attestableRegistrations>>[number];

const toParisDay = (d: Date) => d.toLocaleDateString("sv-SE", { timeZone: TZ });
const longDate = (d: Date) => d.toLocaleDateString("fr-FR", { timeZone: TZ, weekday: "long", day: "numeric", month: "long", year: "numeric" });
const duration = (min: number | null) => (min == null ? null : formatDuration(min));

/** Attestations de présence (une page par participant), vérifiables par QR code. */
export async function attestationPdf(regs: Reg[]) {
  const doc = await PDFDocument.create();
  doc.setTitle(regs.length === 1 ? `Attestation de présence — ${regs[0].user.firstName} ${regs[0].user.lastName}` : `Attestations de présence — ${regs[0]?.event.title ?? ""}`);
  doc.setProducer("KolBase");
  const { font, bold, clean } = await embedPdfFonts(doc);
  const logos = new Map<string, PDFImage | null>();
  const wrap = (text: string, f: typeof font, size: number, width: number) => {
    const out: string[] = [];
    let line = "";
    for (const word of clean(text).split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (f.widthOfTextAtSize(next, size) > width && line) { out.push(line); line = word; } else line = next;
    }
    if (line) out.push(line);
    return out;
  };

  for (const r of regs) {
    const ev = r.event;
    const org = ev.organization;
    if (!logos.has(org.id)) {
      const l = org.logo;
      logos.set(org.id, l && l.contentType === "image/png" ? await doc.embedPng(l.data) : l && l.contentType === "image/jpeg" ? await doc.embedJpg(l.data) : null);
    }
    const page = doc.addPage([W, H]);
    page.drawRectangle({ x: 0, y: H - 8, width: W, height: 8, color: BRAND });
    let y = H - 70;
    const logo = logos.get(org.id);
    if (logo) {
      const s = Math.min(150 / logo.width, 50 / logo.height);
      page.drawImage(logo, { x: M, y: y - logo.height * s + 14, width: logo.width * s, height: logo.height * s });
    } else {
      page.drawText(clean(org.name), { x: M, y, size: 14, font: bold, color: INK });
    }
    y -= 90;
    // Formation : attestation de fin de formation (objectifs, nature, durée, évaluation des acquis, art. L.6353-1).
    const training = ev.training;
    page.drawText(clean(training ? "Attestation de fin de formation" : "Attestation de présence"), { x: M, y, size: training ? 24 : 26, font: bold, color: INK });
    y -= 46;
    const p = r.user.practitioner;
    const start = ev.startsAt, end = eventEnd(ev);
    const where = ev.format === "DISTANCIEL" ? "en ligne" : [ev.venue, ev.city].filter(Boolean).join(", ") || null;
    const signed = new Set(r.attendances.map((a) => a.sessionId));
    const first = ev.sessions[0]?.startsAt ?? start, last = ev.sessions.at(-1)?.endsAt ?? end;
    const objectives = training ? (training.objectives.length > 500 ? `${training.objectives.slice(0, 497)}…` : training.objectives) : "";
    const totalH = training?.hours ?? (ev.sessions.length ? totalHours(ev.sessions) : null);
    const h = (n: number) => `${n.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} h`;
    const lines: [string, boolean][] = training ? [
      [`${org.name} atteste que`, false],
      [`${drPrefix(p?.profession ?? r.profession)}${r.user.firstName} ${r.user.lastName.toUpperCase()}`, true],
      [[r.profession ?? p?.profession, p?.rpps ? `RPPS ${p.rpps}` : null, r.structure].filter(Boolean).join(" · "), false],
      [`a suivi l'action de formation « ${ev.title} »`, true],
      [`${eventTypeLabel(ev.typeId)} · ${FORMAT_LABEL[ev.format]}${ev.therapeuticArea ? ` · ${ev.therapeuticArea}` : ""}${training.dpcRef ? ` · action DPC n° ${training.dpcRef}` : ""}`, false],
      [`${toParisDay(first) === toParisDay(last) ? `le ${longDate(first)}` : `du ${longDate(first)} au ${longDate(last)}`}${where ? `, ${where}` : ""}.`, false],
      [`Durée : ${totalH ? h(totalH) : "non précisée"}${ev.sessions.length ? ` · heures suivies : ${h(attendedHours(ev.sessions, signed))} (émargement par demi-journée)` : ""}.`, false],
      [`Objectifs : ${objectives}`, false],
      [`Évaluation des acquis : ${assessmentLabel(r.assessment)?.toLowerCase() ?? "non renseignée"}.`, false],
    ] : [
      [`${org.name} atteste que`, false],
      [`${drPrefix(p?.profession ?? r.profession)}${r.user.firstName} ${r.user.lastName.toUpperCase()}`, true],
      [[r.profession ?? p?.profession, p?.rpps ? `RPPS ${p.rpps}` : null, r.structure].filter(Boolean).join(" · "), false],
      [`a participé à « ${ev.title} »`, true],
      [`${eventTypeLabel(ev.typeId)} · ${FORMAT_LABEL[ev.format]}${ev.therapeuticArea ? ` · ${ev.therapeuticArea}` : ""}`, false],
      [`le ${longDate(start)}, de ${formatTime(start)} à ${formatTime(end)}${duration(ev.durationMinutes) ? ` (${duration(ev.durationMinutes)})` : ""}${where ? `, ${where}` : ""}.`, false],
      [`Arrivée enregistrée à l'accueil à ${formatTime(r.checkedInAt!)}.`, false],
    ];
    for (const [text, strong] of lines) {
      if (!text) continue;
      for (const l of wrap(text, strong ? bold : font, strong ? 15 : 12, W - 2 * M)) {
        page.drawText(l, { x: M, y, size: strong ? 15 : 12, font: strong ? bold : font, color: strong ? INK : MUTED });
        y -= strong ? 22 : 18;
      }
      y -= 6;
    }
    y -= 20;
    page.drawText(clean(`Fait le ${longDate(new Date())}, pour ${org.name}.`), { x: M, y, size: 11, font, color: INK });

    // Vérification : QR code et adresse publique.
    const code = (await ensureCertificateCode(r.id))!;
    const url = certificateUrl(code);
    const qr = await doc.embedPng(await QRCode.toBuffer(url, { margin: 1, width: 240, errorCorrectionLevel: "M" }));
    const qy = 90;
    page.drawLine({ start: { x: M, y: qy + 110 }, end: { x: W - M, y: qy + 110 }, thickness: 0.6, color: LINE });
    page.drawImage(qr, { x: M, y: qy, width: 90, height: 90 });
    page.drawText(clean("Vérifier cette attestation"), { x: M + 106, y: qy + 66, size: 11, font: bold, color: INK });
    for (const [i, l] of wrap(url, font, 9, W - 2 * M - 110).entries()) page.drawText(l, { x: M + 106, y: qy + 48 - i * 12, size: 9, font, color: BRAND });
    page.drawText(clean(`Code : ${code}`), { x: M + 106, y: qy + 16, size: 9, font, color: MUTED });
    page.drawText(clean(training ? "Établie par KolBase à partir de l'émargement et de l'évaluation saisie par l'organisme (article L.6353-1 du Code du travail)." : "Établie par KolBase à partir du pointage à l'accueil de l'événement."), { x: M, y: 40, size: 8.5, font, color: MUTED });
    if (training && (org.nda || org.qualiopi))
      page.drawText(clean([org.nda ? `Déclaration d'activité n° ${org.nda}` : null, org.qualiopi ? `Certification Qualiopi : ${org.qualiopi}` : null].filter(Boolean).join(" · ")), { x: M, y: 28, size: 8.5, font, color: MUTED });
  }
  return doc.save();
}
