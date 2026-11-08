import { ClipboardCheck, FileDown, GraduationCap, Signature } from "lucide-react";
import { SectionHead } from "@/components/UI";
import { AssessmentForm, AttendanceForm, HalfDaysForm, TrainingSheetForm } from "@/components/TrainingForms";
import { removeSession } from "@/lib/training-actions";
import { acquisition, attendedHours, satisfaction, selfProgress, sessionHours, sheetMissing, totalHours } from "@/lib/training";
import { eventEnded, toParisInput } from "@/lib/events";
import { db } from "@/lib/db";
import { fmtDate, fmtTime, intlLocale, type Locale } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";

/** Types d'événement de formation : les rubriques Formation et Émargement y sont proposées d'emblée. */
const TRAINING_TYPES = ["dpc", "travaux-pratiques"];

const hoursText = (h: number, locale: Locale) => `${h.toLocaleString(intlLocale(locale), { maximumFractionDigits: 2 })} h`;
const sessionLabel = (s: { startsAt: Date; endsAt: Date }, locale: Locale) => `${fmtDate(locale, s.startsAt, { weekday: "short", day: "numeric", month: "short" })} ${fmtTime(locale, s.startsAt)}–${fmtTime(locale, s.endsAt)}`;

/**
 * Rubriques d'une formation dans la fiche de l'événement : fiche d'information du public (Qualiopi), demi-journées
 * et émargement, évaluation des acquis et résultats. Proposées aux organisations qui forment et aux formations.
 */
export async function TrainingSections({ orgId, eventId, readOnly }: { orgId: string; eventId: string; readOnly: boolean }) {
  const { t, locale } = await getT();
  const event = await db.event.findFirst({
    where: { id: eventId, organizationId: orgId },
    include: {
      organization: { select: { kind: true, nda: true, handicapContact: true } },
      training: true,
      sessions: { orderBy: { startsAt: "asc" }, include: { _count: { select: { attendances: true } } } },
      registrations: {
        where: { cancelledAt: null },
        include: { user: { select: { firstName: true, lastName: true } }, attendances: { select: { sessionId: true, method: true } }, survey: { select: { overall: true, selfBefore: true, selfAfter: true } } },
        orderBy: [{ user: { lastName: "asc" } }, { user: { firstName: "asc" } }],
      },
    },
  });
  if (!event || event.internal) return null;
  const sheet = event.training;
  const trainer = !["INDUSTRIEL", "PRESTATAIRE"].includes(event.organization.kind);
  if (!sheet && event.sessions.length === 0 && !trainer && !TRAINING_TYPES.includes(event.typeId)) return null;
  const ids = { orgId, eventId };
  const missing = sheetMissing(sheet, event.organization);
  const ended = eventEnded(event);
  const now = new Date();
  const regs = event.registrations;
  const name = (r: (typeof regs)[number]) => `${r.user.firstName} ${r.user.lastName}`;
  const surveys = regs.flatMap((r) => (r.survey ? [r.survey] : []));
  const present = regs.filter((r) => r.checkedInAt || r.attendances.length).length;
  const sat = satisfaction(surveys, present);
  const acq = acquisition(regs.map((r) => r.assessment));
  const prog = selfProgress(surveys);
  return (
    <>
      <section className="card stack-sm" aria-labelledby="formation-titre" id="formation">
        <SectionHead icon={GraduationCap} id="formation-titre" title={t("Fiche de formation")} tone={sheet && missing.length === 0 ? "ok" : "brand"}
          desc={t("Ce que le public doit savoir avant de s'inscrire : objectifs, prérequis, durée, modalités, accès, tarif et financement (Qualiopi). Affichée sur la page de l'événement.")} />
        {sheet && (missing.length
          ? <p className="notice warn">{t("À compléter : {list}.", { list: missing.map((m) => t(m)).join(", ") })}</p>
          : <p className="notice ok">{t("Fiche complète.")}</p>)}
        {(sat || acq || prog) && (
          <dl className="budget-lines">
            {sat && <div><dt>{t("Satisfaction (note de 4 ou 5 sur 5)")}</dt><dd>{sat.rate} %<small>{t(sat.respondents > 1 ? "{n} répondants" : "{n} répondant", { n: sat.respondents })}</small></dd></div>}
            {acq && <div><dt>{t("Acquis validés")}</dt><dd>{acq.rate} %<small>{t(acq.assessed > 1 ? "{n} évalués" : "{n} évalué", { n: acq.assessed })}</small></dd></div>}
            {prog && <div><dt>{t("Progression perçue (sur 5)")}</dt><dd>{String(prog.before).replace(".", locale === "fr" ? "," : ".")} → {String(prog.after).replace(".", locale === "fr" ? "," : ".")}</dd></div>}
          </dl>
        )}
        {!readOnly && (
          <details className="disclosure" open={!sheet}>
            <summary>{sheet ? t("Modifier la fiche") : t("Rédiger la fiche")}</summary>
            <TrainingSheetForm ids={ids} init={{
              objectives: sheet?.objectives ?? "", audience: sheet?.audience ?? "", prerequisites: sheet?.prerequisites ?? "",
              hours: sheet?.hours != null ? String(sheet.hours) : event.sessions.length ? String(totalHours(event.sessions)) : "",
              methods: sheet?.methods ?? "", assessment: sheet?.assessment ?? "", accessDelay: sheet?.accessDelay ?? "", accessibility: sheet?.accessibility ?? "",
              price: sheet?.price ?? "", funding: sheet?.funding ?? [], fundingNote: sheet?.fundingNote ?? "", dpcRef: sheet?.dpcRef ?? "", contact: sheet?.contact ?? "",
            }} />
          </details>
        )}
      </section>

      <section className="card stack-sm" aria-labelledby="emargement-titre" id="emargement">
        <SectionHead icon={Signature} id="emargement-titre" title={t("Demi-journées et émargement")}
          desc={t("Une feuille d'émargement par demi-journée, exigée par les financeurs (DPC, FIF-PL, OPCO) : chaque participant signe depuis son téléphone, connecté à son compte, ou l'équipe relève sa présence.")}>
          {event.sessions.length > 0 && <a className="btn ghost small" href={`/organisations/${orgId}/evenements/${eventId}/emargement`}><FileDown size={15} aria-hidden />{t("Feuilles d'émargement (PDF)")}</a>}
        </SectionHead>
        {event.sessions.length > 0 && (
          <ul className="pub-list">
            {event.sessions.map((s) => (
              <li key={s.id} className="flex-between">
                <span><strong>{sessionLabel(s, locale)}</strong> <span className="text-xs muted">· {hoursText(sessionHours(s), locale)} · {t(s._count.attendances > 1 ? "{n} émargements" : "{n} émargement", { n: s._count.attendances })}</span></span>
                {!readOnly && s._count.attendances === 0 && (
                  <form action={removeSession}>
                    <input type="hidden" name="orgId" value={orgId} /><input type="hidden" name="eventId" value={eventId} /><input type="hidden" name="sessionId" value={s.id} />
                    <button className="link danger">{t("Retirer")}</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
        {!readOnly && event.sessions.every((s) => s._count.attendances === 0) && (
          <details className="disclosure" open={event.sessions.length === 0}>
            <summary>{event.sessions.length ? t("Refaire les demi-journées") : t("Créer les demi-journées")}</summary>
            <HalfDaysForm ids={ids} firstDay={toParisInput(event.startsAt).slice(0, 10)} replace={event.sessions.length > 0} />
          </details>
        )}
        {event.sessions.length > 0 && regs.length > 0 && !readOnly && (
          <AttendanceForm ids={ids} grid={{
            sessions: event.sessions.map((s) => ({ id: s.id, label: sessionLabel(s, locale), open: s.startsAt.getTime() - 30 * 60e3 <= now.getTime() })),
            rows: regs.map((r) => ({ id: r.id, name: name(r), cells: event.sessions.map((s) => { const a = r.attendances.find((x) => x.sessionId === s.id); return { sessionId: s.id, checked: !!a, self: a?.method === "self" }; }) })),
          }} />
        )}
      </section>

      {sheet && ended && regs.length > 0 && (
        <section className="card stack-sm" aria-labelledby="acquis-titre" id="acquis">
          <SectionHead icon={ClipboardCheck} id="acquis-titre" title={t("Évaluation des acquis")}
            desc={t("Résultat de chaque participant, repris sur son attestation de fin de formation et dans le taux d'acquis publié.")} />
          {readOnly
            ? <p className="text-sm">{t("{n} participants évalués.", { n: regs.filter((r) => r.assessment).length })}</p>
            : <AssessmentForm ids={ids} rows={regs.map((r) => {
                const signed = new Set(r.attendances.map((a) => a.sessionId));
                return { id: r.id, name: name(r), value: r.assessment ?? "", hours: event.sessions.length ? t("{h} suivies sur {total}", { h: hoursText(attendedHours(event.sessions, signed), locale), total: hoursText(totalHours(event.sessions), locale) }) : null };
              })} />}
        </section>
      )}
    </>
  );
}
