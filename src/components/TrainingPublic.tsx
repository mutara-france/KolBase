import { Fragment } from "react";
import { GraduationCap, Signature } from "lucide-react";
import { SectionHead } from "@/components/UI";
import { signAttendance } from "@/lib/training-actions";
import { ACQUISITION_METHOD, fundingLabel, SATISFACTION_METHOD, selfSignOpen, sessionHours } from "@/lib/training";
import { trainingIndicators } from "@/lib/training-data";
import { db } from "@/lib/db";
import { fmtDate, fmtTime, intlLocale, type Locale, type T } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";

const sessionLabel = (s: { startsAt: Date; endsAt: Date }, locale: Locale) => `${fmtDate(locale, s.startsAt, { weekday: "long", day: "numeric", month: "long" })}, ${fmtTime(locale, s.startsAt)}–${fmtTime(locale, s.endsAt)}`;
const hours = (h: number, locale: Locale) => `${h.toLocaleString(intlLocale(locale), { maximumFractionDigits: 2 })} h`;

/** Indicateurs de résultats d'un organisme, avec leur mode de calcul (page d'une formation, page de l'organisation). */
export async function TrainingIndicators({ orgId, t }: { orgId: string; t: T }) {
  const ind = await trainingIndicators(orgId);
  if (!ind.satisfaction && !ind.acquisition) return null;
  return (
    <div className="stack-xs">
      <h3>{t("Indicateurs de résultats")}</h3>
      <ul className="plain stack-xs text-sm">
        {ind.satisfaction && (
          <li>
            <strong>{t("Taux de satisfaction : {rate} %", { rate: ind.satisfaction.rate })}</strong>{" "}
            <span className="muted">({t(ind.satisfaction.respondents > 1 ? "{n} répondants" : "{n} répondant", { n: ind.satisfaction.respondents })}{ind.satisfaction.responseRate != null ? `, ${t("taux de réponse {rate} %", { rate: ind.satisfaction.responseRate })}` : ""})</span>
            <div className="hint">{t(SATISFACTION_METHOD)}</div>
          </li>
        )}
        {ind.acquisition && (
          <li>
            <strong>{t("Acquis validés : {rate} %", { rate: ind.acquisition.rate })}</strong>{" "}
            <span className="muted">({t(ind.acquisition.assessed > 1 ? "{n} participants évalués" : "{n} participant évalué", { n: ind.acquisition.assessed })})</span>
            <div className="hint">{t(ACQUISITION_METHOD)}</div>
          </li>
        )}
      </ul>
    </div>
  );
}

/** Résultats des formations d'un organisme, sur sa page publique (rien sans formation évaluée). */
export async function OrgTrainingResults({ orgId }: { orgId: string }) {
  const { t } = await getT();
  const block = await TrainingIndicators({ orgId, t });
  if (!block) return null;
  return (
    <section className="card stack-sm" aria-labelledby="resultats-formation">
      <SectionHead icon={GraduationCap} id="resultats-formation" title={t("Résultats de nos formations")} />
      {block}
    </section>
  );
}

/** Fiche de la formation sur la page publique : informations dues au public avant l'inscription, demi-journées. */
export async function TrainingSheetPanel({ eventId }: { eventId: string }) {
  const { t, locale } = await getT();
  const e = await db.event.findUnique({
    where: { id: eventId },
    select: { organizationId: true, training: true, sessions: { orderBy: { startsAt: "asc" } }, organization: { select: { nda: true, qualiopi: true, handicapContact: true } } },
  });
  if (!e || (!e.training && e.sessions.length === 0)) return null;
  const s = e.training;
  const rows: [string, string | null | undefined][] = s
    ? [
        ["Objectifs", s.objectives],
        ["Public visé", s.audience],
        ["Prérequis", s.prerequisites],
        ["Durée", s.hours ? hours(s.hours, locale) : null],
        ["Modalités pédagogiques", s.methods],
        ["Modalités d'évaluation", s.assessment],
        ["Modalités et délai d'accès", s.accessDelay],
        ["Accessibilité", [s.accessibility, e.organization.handicapContact ? t("Référent handicap : {contact}", { contact: e.organization.handicapContact }) : null].filter(Boolean).join(" · ") || null],
        ["Tarif", s.price],
        ["Financement", [s.funding.map((f) => t(fundingLabel(f))).join(", "), s.fundingNote].filter(Boolean).join(" · ") || null],
        ["Référence DPC", s.dpcRef],
        ["Contact", s.contact],
      ]
    : [];
  return (
    <section className="card stack-sm" aria-labelledby="fiche-formation">
      <SectionHead icon={GraduationCap} id="fiche-formation" title={t("Fiche de la formation")} />
      {rows.some(([, v]) => v) && (
        <dl className="facts">
          {rows.filter(([, v]) => v).map(([k, v]) => <Fragment key={k}><dt>{t(k)}</dt><dd className="pre-line">{v}</dd></Fragment>)}
        </dl>
      )}
      {e.sessions.length > 0 && (
        <>
          <h3>{t("Demi-journées")}</h3>
          <ul className="plain stack-xs text-sm">{e.sessions.map((x) => <li key={x.id}>{sessionLabel(x, locale)} <span className="muted">· {hours(sessionHours(x), locale)}</span></li>)}</ul>
        </>
      )}
      {(e.organization.nda || e.organization.qualiopi) && (
        <p className="hint">
          {[e.organization.nda ? t("Déclaration d'activité n° {nda} (cet enregistrement ne vaut pas agrément de l'État)", { nda: e.organization.nda }) : null, e.organization.qualiopi ? t("Certification Qualiopi : {ref}", { ref: e.organization.qualiopi }) : null].filter(Boolean).join(" · ")}
        </p>
      )}
      {s && <TrainingIndicators orgId={e.organizationId} t={t} />}
    </section>
  );
}

/** Émargement du participant connecté : une signature par demi-journée, pendant la demi-journée. */
export async function SignPanel({ eventId, registrationId }: { eventId: string; registrationId: string }) {
  const { t, locale } = await getT();
  const sessions = await db.eventSession.findMany({ where: { eventId }, orderBy: { startsAt: "asc" }, include: { attendances: { where: { registrationId }, select: { signedAt: true } } } });
  if (!sessions.length) return null;
  const now = new Date();
  return (
    <section className="card stack-sm" aria-labelledby="emarger-titre">
      <SectionHead icon={Signature} id="emarger-titre" title={t("Émargement")} desc={t("Signez à chaque demi-journée, depuis votre téléphone : votre signature est horodatée et reprise sur la feuille d'émargement.")} />
      <ul className="plain stack-xs text-sm">
        {sessions.map((s) => {
          const signed = s.attendances[0];
          return (
            <li key={s.id} className="flex-between">
              <span>{sessionLabel(s, locale)}</span>
              {signed ? <span className="pill ok">{t("Émargé à {time}", { time: fmtTime(locale, signed.signedAt) })}</span>
                : selfSignOpen(s, now) ? (
                  <form action={signAttendance}>
                    <input type="hidden" name="sessionId" value={s.id} />
                    <button className="btn small">{t("Émarger")}</button>
                  </form>
                ) : <span className="muted">{s.endsAt < now ? t("Non émargé") : t("À venir")}</span>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
