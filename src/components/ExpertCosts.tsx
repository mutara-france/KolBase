import { CalendarRange, Plane, Receipt } from "lucide-react";
import { SectionHead } from "@/components/UI";
import { TableWrap } from "@/components/TableWrap";
import { ConfirmButton } from "@/components/ConfirmButton";
import { ExpenseDecisionForm, ExpertExpenseForm, ExpertTravelForm, FrameworkMissionForm } from "@/components/ExpertCostForms";
import { markExpertExpensePaid, removeFrameworkMission, withdrawExpertExpense } from "@/lib/expert-cost-actions";
import { EXPENSE_STATUS_LABEL, EXPENSE_STATUS_TONE, expenseCategoryLabel, expenseOverCap, expensesOpen, expenseStatus, expenseTotals, frameworkStart, frameworkUsage } from "@/lib/expert-costs";
import { complianceSettings } from "@/lib/compliance";
import { collabType } from "@/lib/projects";
import { nights, roomTypeLabel } from "@/lib/travel";
import { drPrefix } from "@/lib/professions";
import { storageEnabled } from "@/lib/storage";
import { db } from "@/lib/db";
import { fmtDate, fmtEur, intlLocale, type Locale, type T } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";

type Travel = { hotel: string | null; hotelRef: string | null; checkIn: Date | null; checkOut: Date | null; roomType: string | null; outbound: string | null; returnTrip: string | null; ticketRef: string | null; notes: string | null; sentAt: Date | null };
type Expense = { id: string; category: string; label: string; date: Date; amountCents: number; documentId: string | null; status: string; decisionNote: string | null; paidAt: Date | null };

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

/** Détail d'un voyage réservé (hôtel, dates, chambre, trajets, billets). */
function TravelSummary({ tr, t, locale }: { tr: Travel; t: T; locale: Locale }) {
  const n = nights(tr);
  const items = [
    tr.hotel ? `${t("Hôtel")} : ${tr.hotel}${tr.hotelRef ? ` (${t("réservation {ref}", { ref: tr.hotelRef })})` : ""}` : null,
    tr.checkIn || tr.checkOut ? `${t("Séjour")} : ${tr.checkIn ? fmtDate(locale, tr.checkIn) : "?"} → ${tr.checkOut ? fmtDate(locale, tr.checkOut) : "?"}${n ? ` · ${t(n > 1 ? "{n} nuits" : "{n} nuit", { n })}` : ""}` : null,
    tr.roomType ? `${t("Chambre")} : ${t(roomTypeLabel(tr.roomType) ?? tr.roomType)}` : null,
    tr.outbound ? `${t("Aller")} : ${tr.outbound}` : null,
    tr.returnTrip ? `${t("Retour")} : ${tr.returnTrip}` : null,
    tr.ticketRef ? `${t("Billets")} : ${tr.ticketRef}` : null,
    tr.notes,
  ].filter(Boolean);
  return <ul className="plain stack-xs text-sm">{items.map((x, i) => <li key={i}>{x}</li>)}</ul>;
}

/** Liste des notes de frais (côté organisation : examen et remboursement ; côté expert : retrait d'une note en attente). */
function ExpenseTable({ list, t, locale, org, expert, warn }: { list: Expense[]; t: T; locale: Locale; org?: { orgId: string; canEdit: boolean }; expert?: boolean; warn: (e: Expense) => { amount: number; cap: number } | null }) {
  return (
    <TableWrap label={t("Notes de frais")}>
      <table className="table">
        <thead><tr><th>{t("Date")}</th><th>{t("Nature")}</th><th>{t("Objet")}</th><th className="num">{t("Montant TTC")}</th><th>{t("Justificatif")}</th><th>{t("Statut")}</th>{(org?.canEdit || expert) && <th />}</tr></thead>
        <tbody>
          {list.map((e) => {
            const st = expenseStatus(e.status);
            const over = warn(e);
            return (
              <tr key={e.id}>
                <td data-label="Date">{fmtDate(locale, e.date)}</td>
                <td data-label="Nature">{t(expenseCategoryLabel(e.category))}</td>
                <td data-label="Objet">
                  {e.label}
                  {over && <span className="text-xs warn-text"> · {t("au-delà du plafond ({cap} €)", { cap: over.cap.toLocaleString(intlLocale(locale)) })}</span>}
                  {st === "rejected" && e.decisionNote && <span className="text-xs muted"> · {t("Motif : {note}", { note: e.decisionNote })}</span>}
                </td>
                <td data-label="Montant TTC" className="num">{fmtEur(locale, e.amountCents)}</td>
                <td data-label="Justificatif">{e.documentId ? <a className="link" href={`/documents/${e.documentId}`}>{t("Ouvrir")}</a> : "—"}</td>
                <td data-label="Statut"><span className={`pill ${EXPENSE_STATUS_TONE[st]}`}>{t(EXPENSE_STATUS_LABEL[st])}{st === "paid" && e.paidAt ? ` ${t("le {date}", { date: fmtDate(locale, e.paidAt) })}` : ""}</span></td>
                {org?.canEdit && (
                  <td>
                    {st === "submitted" && <ExpenseDecisionForm orgId={org.orgId} expenseId={e.id} />}
                    {st === "approved" && (
                      <form action={markExpertExpensePaid}>
                        <input type="hidden" name="orgId" value={org.orgId} />
                        <input type="hidden" name="expenseId" value={e.id} />
                        <button className="btn small secondary">{t("Marquer remboursée")}</button>
                      </form>
                    )}
                  </td>
                )}
                {expert && (
                  <td>
                    {st === "submitted" && (
                      <form action={withdrawExpertExpense}>
                        <input type="hidden" name="expenseId" value={e.id} />
                        <ConfirmButton className="link danger" confirm={t("retirer la note de frais")} summary={t("La note et son justificatif sont supprimés.")} localized>{t("Retirer")}</ConfirmButton>
                      </form>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableWrap>
  );
}

/** Onglet « Frais et voyages » d'un dossier : voyage réservé et notes de frais de chaque expert engagé. */
export async function ExpertCostsTab({ orgId, projectId, canEdit }: { orgId: string; projectId: string; canEdit: boolean }) {
  const { t, locale } = await getT();
  const [project, org] = await Promise.all([
    db.project.findFirst({
      where: { id: projectId, organizationId: orgId },
      include: {
        experts: {
          where: { status: { notIn: ["ATT_EXPERTS", "DECLINE"] } },
          include: {
            practitioner: { include: { user: { select: { firstName: true, lastName: true } } } },
            expenses: { orderBy: { date: "asc" } },
            travel: true,
          },
          orderBy: { createdAt: "asc" },
        },
      },
    }),
    db.organization.findUnique({ where: { id: orgId }, select: { complianceSettings: true } }),
  ]);
  if (!project) return null;
  const limits = complianceSettings(org?.complianceSettings);
  const all = project.experts.flatMap((e) => e.expenses);
  const totals = expenseTotals(all);
  const open = expensesOpen("ACCORD", project.status);
  return (
    <div className="stack">
      <section className="card stack-sm" aria-labelledby="frais-titre">
        <SectionHead icon={Receipt} id="frais-titre" title={t("Frais et voyages des experts")} desc={t("Réservez le voyage de chaque expert, examinez ses notes de frais (frais réels sur justificatif) et indiquez leur remboursement. Les frais remboursés sont déclarés avec sa convention (Transparence Santé, betransparent.be).")}>
          {all.length > 0 && <span className="amount-chip">{fmtEur(locale, totals.engaged)}{" "}{t("TTC")}</span>}
        </SectionHead>
        {all.length > 0 && (
          <p className="text-sm">
            {[
              totals.submitted ? t("{montant} à examiner", { montant: fmtEur(locale, totals.submitted) }) : null,
              totals.approved ? t("{montant} à rembourser", { montant: fmtEur(locale, totals.approved) }) : null,
              totals.paid ? t("{montant} remboursés", { montant: fmtEur(locale, totals.paid) }) : null,
            ].filter(Boolean).join(" · ")}
          </p>
        )}
        {!open && <p className="hint">{t("Les experts déposent leurs notes de frais une fois la convention en signature.")}</p>}
      </section>
      {project.experts.length === 0 && <p className="muted">{t("Aucun expert engagé pour l'instant.")}</p>}
      {project.experts.map((e) => {
        const name = `${drPrefix(e.practitioner.profession)}${e.practitioner.user.firstName} ${e.practitioner.user.lastName}`;
        const n = e.travel ? nights(e.travel) ?? 1 : 1;
        const tr = e.travel;
        return (
          <section key={e.id} className="card stack-sm" aria-labelledby={`frais-${e.id}`}>
            <SectionHead icon={Plane} level={3} id={`frais-${e.id}`} title={name} desc={tr?.sentAt ? t("Voyage envoyé le {date}", { date: fmtDate(locale, tr.sentAt) }) : tr ? t("Voyage enregistré, pas encore envoyé") : t("Aucun voyage réservé")} />
            {tr && <TravelSummary tr={tr} t={t} locale={locale} />}
            {canEdit && (
              <details className="disclosure">
                <summary>{tr ? t("Modifier le voyage") : t("Réserver le voyage")}</summary>
                <ExpertTravelForm orgId={orgId} linkId={e.id} sent={!!tr?.sentAt} initial={{ checkIn: day(tr?.checkIn ?? null), checkOut: day(tr?.checkOut ?? null), roomType: tr?.roomType ?? "", hotel: tr?.hotel ?? "", hotelRef: tr?.hotelRef ?? "", outbound: tr?.outbound ?? "", returnTrip: tr?.returnTrip ?? "", ticketRef: tr?.ticketRef ?? "", notes: tr?.notes ?? "" }} />
              </details>
            )}
            <h4 className="eyebrow-sm">{t("Notes de frais")}</h4>
            {e.expenses.length === 0
              ? <p className="muted text-sm">{t("Aucune note de frais.")}</p>
              : <ExpenseTable list={e.expenses} t={t} locale={locale} org={{ orgId, canEdit }} warn={(x) => expenseOverCap(x, e.practitioner.country, limits, n)} />}
          </section>
        );
      })}
    </div>
  );
}

/** Onglet « Frais et voyage » de l'expert : voyage réservé par l'organisation, ses notes de frais et leur suivi. */
export async function ExpertCostsPanel({ linkId }: { linkId: string }) {
  const { t, locale } = await getT();
  const link = await db.projectExpert.findUnique({
    where: { id: linkId },
    include: { expenses: { orderBy: { date: "asc" } }, travel: true, practitioner: { select: { country: true } }, project: { select: { status: true, organization: { select: { name: true, complianceSettings: true } } } } },
  });
  if (!link) return null;
  const limits = complianceSettings(link.project.organization.complianceSettings);
  const open = expensesOpen(link.status, link.project.status);
  const n = link.travel ? nights(link.travel) ?? 1 : 1;
  const totals = expenseTotals(link.expenses);
  return (
    <div className="stack">
      <section className="card stack-sm" aria-labelledby="voyage-titre">
        <SectionHead icon={Plane} id="voyage-titre" title={t("Votre voyage")} desc={link.travel ? t("Réservé par {org}.", { org: link.project.organization.name }) : t("{org} n'a pas encore indiqué de réservation. Si vous réservez vous-même, déposez ensuite vos frais ci-dessous.", { org: link.project.organization.name })} />
        {link.travel && <TravelSummary tr={link.travel} t={t} locale={locale} />}
      </section>
      <section className="card stack-sm" aria-labelledby="mes-frais-titre">
        <SectionHead icon={Receipt} id="mes-frais-titre" title={t("Vos notes de frais")} desc={t("Frais réels engagés pour la prestation (transport, hôtel, repas), remboursés sur justificatif. Ils sont déclarés par l'organisation avec votre convention.")}>
          {link.expenses.length > 0 && <span className="amount-chip">{fmtEur(locale, totals.engaged + totals.submitted)}{" "}{t("TTC")}</span>}
        </SectionHead>
        {link.expenses.length > 0 && <ExpenseTable list={link.expenses} t={t} locale={locale} expert warn={(x) => expenseOverCap(x, link.practitioner.country, limits, n)} />}
        {open
          ? <details className="disclosure" open={link.expenses.length === 0}><summary>{t("Déposer une note de frais")}</summary><ExpertExpenseForm linkId={link.id} proofRequired={storageEnabled()} /></details>
          : <p className="hint">{t("Les notes de frais s'ouvrent avec la signature de la convention.")}</p>}
      </section>
    </div>
  );
}

/** Contrat-cadre : période, unités prévues et consommées par expert, missions consignées. */
export async function FrameworkPanel({ orgId, projectId, canEdit, linkId }: { orgId: string; projectId: string; canEdit: boolean; linkId?: string }) {
  const { t, locale } = await getT();
  const project = await db.project.findFirst({
    where: { id: projectId, organizationId: orgId },
    include: {
      experts: {
        where: { status: { notIn: ["ATT_EXPERTS", "DECLINE"] }, ...(linkId ? { id: linkId } : {}) },
        include: { practitioner: { include: { user: { select: { firstName: true, lastName: true } } } }, missions: { orderBy: { date: "asc" } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!project?.framework || !project.periodEnd) return null;
  const unit = collabType(project.typeId)?.unit ?? "unité";
  const start = frameworkStart(project);
  const signed = project.status === "SIGNE";
  return (
    <section className="card stack-sm" aria-labelledby="cadre-titre">
      <SectionHead icon={CalendarRange} id="cadre-titre" title={t("Contrat-cadre")} desc={t("Du {debut} au {fin} : chaque mission réalisée est consignée, dans la limite des unités prévues à la convention.", { debut: fmtDate(locale, start), fin: fmtDate(locale, project.periodEnd) })} />
      {project.experts.length === 0 && <p className="muted text-sm">{t("Aucun expert engagé pour l'instant.")}</p>}
      {project.experts.map((e) => {
        const usage = frameworkUsage(e.days, e.missions);
        return (
          <div key={e.id} className="stack-sm">
            {!linkId && <h3>{drPrefix(e.practitioner.profession)}{e.practitioner.user.firstName} {e.practitioner.user.lastName}</h3>}
            <p className="text-sm">{t("{used} sur {planned} {unit} consommées · reste {remaining}", { used: String(usage.used), planned: String(usage.planned), unit: t(`${unit}s`), remaining: String(usage.remaining) })}</p>
            {e.missions.length > 0 && (
              <ul className="pub-list">
                {e.missions.map((m) => (
                  <li key={m.id} className="flex-between">
                    <span><strong>{fmtDate(locale, m.date)}</strong> · {m.label} <span className="text-xs muted">· {t("{n} {unit}", { n: String(m.units), unit: t(m.units > 1 ? `${unit}s` : unit) })}</span></span>
                    {canEdit && signed && (
                      <form action={removeFrameworkMission}>
                        <input type="hidden" name="orgId" value={orgId} />
                        <input type="hidden" name="missionId" value={m.id} />
                        <button className="link danger">{t("Retirer")}</button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {canEdit && signed && usage.remaining > 0 && (
              <details className="disclosure">
                <summary>{t("Consigner une mission")}</summary>
                <FrameworkMissionForm orgId={orgId} linkId={e.id} unit={unit} remaining={usage.remaining} />
              </details>
            )}
            {canEdit && signed && usage.remaining <= 0 && <p className="hint">{t("Toutes les unités sont consommées : au-delà, un avenant à la convention est nécessaire.")}</p>}
          </div>
        );
      })}
      {!signed && !linkId && <p className="hint">{t("Les missions se consignent une fois le contrat-cadre signé, jusqu'à sa clôture.")}</p>}
    </section>
  );
}
