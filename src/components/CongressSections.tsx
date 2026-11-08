import { CalendarRange, FileText, Handshake } from "lucide-react";
import { SectionHead } from "@/components/UI";
import { AbstractDecisionForm, AbstractReviewForm, AbstractScheduleForm, AbstractsCallForm, PartnerForm, ProgramItemForm, RoomForm } from "@/components/CongressForms";
import { closeAbstracts, removeProgramItem, removeRoom, updatePartner } from "@/lib/congress-actions";
import {
  ABSTRACT_STATUS, abstractFormatLabel, abstractsOpen, PARTNER_STATUS, partnerLevelLabel, partnerTotals, programByDay, programKindLabel, reviewScore, roomConflicts,
} from "@/lib/congress";
import { toParisInput } from "@/lib/events";
import { db } from "@/lib/db";
import { fmtDate, fmtEur, fmtTime, type Locale } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";

const dayLabel = (iso: string, locale: Locale) => fmtDate(locale, new Date(`${iso}T12:00:00Z`), { weekday: "long", day: "numeric", month: "long" });

/**
 * Congrès d'une société savante, d'une association ou d'un organisme : programme en salles, appel à communications
 * et relecture par le comité, partenaires et conventions de partenariat.
 */
export async function CongressSections({ orgId, eventId, readOnly, userId, organizer }: { orgId: string; eventId: string; readOnly: boolean; userId: string; organizer: boolean }) {
  const { t, locale } = await getT();
  const event = await db.event.findFirst({
    where: { id: eventId, organizationId: orgId },
    include: {
      organization: { select: { kind: true } },
      rooms: { orderBy: { position: "asc" } },
      programItems: { include: { room: { select: { name: true } }, partner: { select: { name: true } } } },
      partners: { include: { organization: { select: { name: true } } }, orderBy: { createdAt: "asc" } },
      abstracts: { where: { status: { not: "withdrawn" } }, include: { reviews: true, item: { select: { startsAt: true, room: { select: { name: true } } } } }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!event || event.internal) return null;
  const congress = !["INDUSTRIEL", "PRESTATAIRE"].includes(event.organization.kind);
  if (!congress && !event.programItems.length && !event.partners.length && !event.abstracts.length) return null;
  const ids = { orgId, eventId };
  const firstDay = toParisInput(event.startsAt).slice(0, 10);
  const rooms = event.rooms.map((r) => ({ id: r.id, name: r.name }));
  const days = programByDay(event.programItems);
  const clash = roomConflicts(event.programItems);
  const open = abstractsOpen(event);
  const totals = partnerTotals(event.partners);
  const secured = event.partners.filter((p) => p.status === "signed" || p.status === "paid").map((p) => ({ id: p.id, name: p.name }));
  const orgs = organizer && !readOnly
    ? await db.organization.findMany({ where: { kind: "INDUSTRIEL", verification: "VERIFIED", id: { not: orgId } }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 500 })
    : [];
  const toReview = event.abstracts.filter((a) => a.status === "submitted").length;

  return (
    <>
      <section className="card stack-sm" aria-labelledby="programme-salles-titre" id="programme-salles">
        <SectionHead icon={CalendarRange} id="programme-salles-titre" title={t("Programme par séance")}
          desc={t("Séances par jour et par salle (conférences, ateliers, symposiums, communications) : le programme détaillé de la page de l'événement.")} />
        {event.rooms.length > 0 && (
          <ul className="inline wrap plain">
            {event.rooms.map((r) => (
              <li key={r.id} className="tag">
                {r.name}{r.capacity ? ` · ${t("{n} places", { n: r.capacity })}` : ""}
                {!readOnly && !event.programItems.some((i) => i.roomId === r.id) && (
                  <form action={removeRoom} className="inline">
                    <input type="hidden" name="orgId" value={orgId} /><input type="hidden" name="eventId" value={eventId} /><input type="hidden" name="roomId" value={r.id} />
                    <button className="link danger text-xs" aria-label={t("Retirer la salle {name}", { name: r.name })}>×</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
        {!readOnly && <RoomForm ids={ids} />}
        {days.map((d) => (
          <div key={d.day} className="stack-xs">
            <h3>{dayLabel(d.day, locale)}</h3>
            <ul className="pub-list">
              {d.items.map((i) => (
                <li key={i.id} className="flex-between">
                  <span>
                    <strong>{fmtTime(locale, i.startsAt)}–{fmtTime(locale, i.endsAt)}</strong> · {i.title}
                    <span className="text-xs muted"> · {t(programKindLabel(i.kind))}{i.room ? ` · ${i.room.name}` : ""}{i.partner ? ` · ${i.partner.name}` : ""}{i.speakers ? ` · ${i.speakers}` : ""}</span>
                    {clash.has(i.id) && <span className="text-xs warn-text"> · {t("même salle, même heure qu'une autre séance")}</span>}
                  </span>
                  {!readOnly && (
                    <form action={removeProgramItem}>
                      <input type="hidden" name="orgId" value={orgId} /><input type="hidden" name="eventId" value={eventId} /><input type="hidden" name="itemId" value={i.id} />
                      <button className="link danger">{t("Retirer")}</button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
        {!readOnly && (
          <details className="disclosure" open={event.programItems.length === 0 && event.rooms.length > 0}>
            <summary>{t("Ajouter une séance")}</summary>
            <ProgramItemForm ids={ids} day={firstDay} rooms={rooms} partners={secured} />
          </details>
        )}
      </section>

      {(congress || event.abstracts.length > 0) && (
        <section className="card stack-sm" aria-labelledby="communications-titre" id="communications">
          <SectionHead icon={FileText} id="communications-titre" title={t("Appel à communications")}
            desc={event.abstractsDeadline
              ? open ? t("Ouvert jusqu'au {date} : les soumissions arrivent ici, le comité les note, l'équipe décide et place les communications retenues au programme.", { date: fmtDate(locale, event.abstractsDeadline, { day: "numeric", month: "long", year: "numeric" }) })
                : t("Clos le {date}.", { date: fmtDate(locale, event.abstractsDeadline, { day: "numeric", month: "long", year: "numeric" }) })
              : t("Recueillez les résumés des praticiens et des chercheurs : soumission en ligne, relecture par le comité, décision et place au programme.")}>
            {toReview > 0 && <span className="pill wait">{t("{n} à examiner", { n: toReview })}</span>}
          </SectionHead>
          {organizer && !readOnly && (
            <details className="disclosure" open={!event.abstractsDeadline}>
              <summary>{event.abstractsDeadline ? t("Modifier l'appel") : t("Ouvrir l'appel")}</summary>
              <AbstractsCallForm ids={ids} open={open} deadline={event.abstractsDeadline ? toParisInput(event.abstractsDeadline).slice(0, 10) : ""} topics={event.abstractTopics.join("\n")} />
              {open && (
                <form action={closeAbstracts}>
                  <input type="hidden" name="orgId" value={orgId} /><input type="hidden" name="eventId" value={eventId} />
                  <button className="btn small ghost">{t("Clore l'appel maintenant")}</button>
                </form>
              )}
            </details>
          )}
          {event.abstracts.length === 0 ? <p className="muted text-sm">{t("Aucune communication soumise.")}</p> : (
            <ul className="plain stack">
              {event.abstracts.map((a) => {
                const mine = a.reviews.find((r) => r.reviewerId === userId);
                const sc = reviewScore(a.reviews);
                const st = ABSTRACT_STATUS[a.status] ?? ABSTRACT_STATUS.submitted;
                return (
                  <li key={a.id} className="stack-xs abstract-item">
                    <div className="flex-between">
                      <strong>{a.title}</strong>
                      <span className={`pill ${st.tone}`}>{t(st.label)}{a.acceptedFormat ? ` · ${t(abstractFormatLabel(a.acceptedFormat) ?? "")}` : ""}</span>
                    </div>
                    <span className="text-sm muted">{a.authors}{a.topic ? ` · ${a.topic}` : ""} · {t(abstractFormatLabel(a.format) ?? "")} · {sc ? t("note du comité {avg} / 5 ({n} avis)", { avg: String(sc.avg).replace(".", locale === "fr" ? "," : "."), n: sc.n }) : t("pas encore noté")}</span>
                    <details className="disclosure">
                      <summary>{t("Lire le résumé")}</summary>
                      <p className="pre-line text-sm">{a.body}</p>
                      {a.reviews.filter((r) => r.comment).map((r) => <p key={r.id} className="text-xs muted">« {r.comment} » ({r.score}/5)</p>)}
                    </details>
                    {organizer && !readOnly && a.status === "submitted" && <AbstractReviewForm ids={ids} abstractId={a.id} score={mine?.score ?? null} comment={mine?.comment ?? ""} />}
                    {organizer && !readOnly && a.status === "submitted" && <AbstractDecisionForm ids={ids} abstractId={a.id} wished={a.format} />}
                    {a.status === "accepted" && (a.item
                      ? <span className="text-sm">{t("Au programme : {when}", { when: `${fmtDate(locale, a.item.startsAt, { weekday: "short", day: "numeric", month: "short" })} ${fmtTime(locale, a.item.startsAt)}${a.item.room ? ` · ${a.item.room.name}` : ""}` })}</span>
                      : !readOnly && <AbstractScheduleForm ids={ids} abstractId={a.id} day={firstDay} rooms={rooms} />)}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {(congress || event.partners.length > 0) && (
        <section className="card stack-sm" aria-labelledby="partenaires-titre" id="partenaires">
          <SectionHead icon={Handshake} id="partenaires-titre" title={t("Partenaires")}
            desc={t("Industriels et autres soutiens : niveau, montant, contreparties. Une organisation présente sur KolBase signe ou décline la convention en ligne ; les partenaires acquis figurent sur la page de l'événement.")}>
            {(totals.secured > 0 || totals.pending > 0) && <span className="amount-chip">{fmtEur(locale, totals.secured)} {t("HT acquis")}</span>}
          </SectionHead>
          {totals.pending > 0 && <p className="text-sm muted">{t("{amount} HT en attente de signature", { amount: fmtEur(locale, totals.pending) })}</p>}
          {event.partners.length > 0 && (
            <ul className="pub-list">
              {event.partners.map((p) => {
                const st = PARTNER_STATUS[p.status] ?? PARTNER_STATUS.draft;
                return (
                  <li key={p.id} className="flex-between">
                    <span>
                      <strong>{p.name}</strong>
                      <span className="text-xs muted"> · {t(partnerLevelLabel(p.level))}{p.amountCents != null ? ` · ${fmtEur(locale, p.amountCents)} ${t("HT")}` : ""}{p.counterparts ? ` · ${p.counterparts}` : ""}{p.organizationId ? "" : ` · ${t("hors KolBase")}`}</span>
                      {p.status === "declined" && p.declineNote && <span className="text-xs muted"> · {t("Motif : {note}", { note: p.declineNote })}</span>}
                    </span>
                    <span className="inline wrap">
                      <span className={`pill ${st.tone}`}>{t(st.label)}</span>
                      {organizer && !readOnly && (
                        <form action={updatePartner} className="inline">
                          <input type="hidden" name="orgId" value={orgId} /><input type="hidden" name="eventId" value={eventId} /><input type="hidden" name="partnerId" value={p.id} />
                          {p.organizationId && (p.status === "draft" || p.status === "declined") && <button className="btn small" name="action" value="propose">{t("Proposer la convention")}</button>}
                          {!p.organizationId && p.status === "draft" && <button className="btn small ghost" name="action" value="signed">{t("Convention signée")}</button>}
                          {p.status === "signed" && <button className="btn small ghost" name="action" value="paid">{t("Marquer réglé")}</button>}
                          {(p.status === "draft" || p.status === "declined" || !p.organizationId) && <button className="link danger" name="action" value="remove">{t("Retirer")}</button>}
                        </form>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {organizer && !readOnly && (
            <details className="disclosure" open={event.partners.length === 0}>
              <summary>{t("Ajouter un partenaire")}</summary>
              <PartnerForm ids={ids} orgs={orgs} />
            </details>
          )}
        </section>
      )}
    </>
  );
}
