import { db } from "@/lib/db";
import { getT } from "@/lib/i18n/server";
import { fmtDate } from "@/lib/i18n";
import { detailLines } from "@/lib/supplier-profiles";
import { needsSummary } from "@/lib/registration-needs";

type BriefRfq = {
  category: string;
  details: unknown;
  serviceStart: Date | null;
  serviceEnd: Date | null;
  finalHeadcount: number | null;
  finalHeadcountAt: Date | null;
  eventId: string | null;
};

/** Repas, salle, hébergement : les besoins des inscrits (sans les noms) intéressent le prestataire. */
const NEEDS_CATEGORIES = ["restauration", "salle", "hebergement"];

/**
 * Ce qu'il faut au prestataire pour chiffrer, au-delà du texte libre : dates de la prestation, réponses aux questions
 * de sa catégorie, nombre définitif s'il est confirmé et, pour un traiteur, un lieu ou un hôtel, les régimes,
 * allergies et besoins d'accessibilité déclarés par les inscrits (sans leurs noms).
 */
export async function RfqBrief({ rfq }: { rfq: BriefRfq }) {
  const { t, locale } = await getT();
  const day = (iso: string) => fmtDate(locale, new Date(`${iso}T12:00:00Z`));
  const lines = detailLines(rfq.category, rfq.details, day);
  const regs = rfq.eventId && NEEDS_CATEGORIES.includes(rfq.category)
    ? await db.registration.findMany({ where: { eventId: rfq.eventId, cancelledAt: null }, select: { diet: true, allergies: true, needs: true } })
    : [];
  const needs = needsSummary(regs);
  const dates = rfq.serviceStart
    ? rfq.serviceEnd && rfq.serviceEnd.toDateString() !== rfq.serviceStart.toDateString()
      ? t("du {start} au {end}", { start: fmtDate(locale, rfq.serviceStart), end: fmtDate(locale, rfq.serviceEnd) })
      : fmtDate(locale, rfq.serviceStart)
    : null;
  if (!dates && lines.length === 0 && needs.total === 0 && rfq.finalHeadcount == null) return null;
  return (
    <div className="rfq-brief stack-sm">
      <dl className="brief-list">
        {dates && <div><dt>{t("Dates de la prestation")}</dt><dd>{dates}</dd></div>}
        {lines.map((l) => <div key={l.label}><dt>{t(l.label)}</dt><dd className={l.value.includes("\n") ? "pre-line" : undefined}>{l.translate ? l.value.split(", ").map((v) => t(v)).join(", ") : l.value}</dd></div>)}
        {rfq.finalHeadcount != null && <div><dt>{t("Nombre définitif")}</dt><dd><strong>{rfq.finalHeadcount}</strong>{rfq.finalHeadcountAt && <small> · {t("confirmé le {date}", { date: fmtDate(locale, rfq.finalHeadcountAt) })}</small>}</dd></div>}
      </dl>
      {needs.total > 0 && (
        <p className="text-sm">
          <strong>{t("Besoins déclarés par les inscrits")}</strong>{" "}
          {[
            ...needs.diets.map((d) => `${t(d.label)} : ${d.count}`),
            ...(needs.allergies.length ? [t("allergies : {list}", { list: needs.allergies.join(" ; ") })] : []),
            ...(needs.needs.length ? [t("accessibilité : {list}", { list: needs.needs.join(" ; ") })] : []),
          ].join(" · ")}
        </p>
      )}
    </div>
  );
}
