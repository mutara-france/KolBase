import Link from "next/link";
import { RfqBrief } from "@/components/RfqBrief";
import { FINAL_COUNT_BENEFITS, FINAL_COUNT_CATEGORIES, FINAL_COUNT_DAYS, termsParts } from "@/lib/supplier-profiles";
import { notFound } from "next/navigation";
import { ArrowLeft, BellRing, CalendarClock, Check, Clock, FileSignature, FileText, Info, MessageSquare, Plus, Receipt, Send, Star, UserPlus, Users, X } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { SectionNav } from "@/components/SectionNav";
import { SectionHead } from "@/components/UI";
import { Avatar } from "@/components/Avatar";
import { CategoryIcon, PerHeadGauge, StepTrail, type Step } from "@/components/SupplierBits";
import { FinalHeadcountForm, RfqMessageForm } from "@/components/RfqForms";
import { db } from "@/lib/db";
import { ReviewForm } from "@/components/BookForms";
import { Thread } from "@/components/ProjectBits";
import { ConfirmButton } from "@/components/ConfirmButton";
import { orgTabs } from "@/lib/org-overview";
import { requireMembership } from "@/lib/orgs";
import { EVENT_MANAGER_ROLES, eventEnded } from "@/lib/events";
import { canCancelRfq, QUOTE_STATUS, RFQ_STATUS, rfqDisplayStatus, remindable, supplierCategoryLabel, rfqTitle } from "@/lib/suppliers";
import { addRfqSuppliers, awardQuote, cancelRfq, markInvoicePaid, proposeQuote, remindRfqSuppliers, requestQuoteUpdate, sendRfq } from "@/lib/rfq-actions";
import { lineTotal, lineVat, perHeadLabel, perParticipant, quoteTtc, quoteVatLabel, readLines, vatLabel } from "@/lib/quotes";
import { costPerHead } from "@/lib/indicators";
import { complianceSettings } from "@/lib/compliance";
import { orgRfqs, supplierDirectory, type OrgRfq } from "@/lib/rfq-org";
import { logoSrc } from "@/lib/logos";
import { engagementBlock } from "@/lib/billing";
import { de } from "@/lib/elision";
import { getT } from "@/lib/i18n/server";
import { fmtDate, fmtEur, intlLocale, type Locale, type T } from "@/lib/i18n";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: `${t("Demande de devis")} — KolBase` };
}

type Quote = OrgRfq["quotes"][number];

/** Page d'une demande de devis : où elle en est, les devis côte à côte, les échanges avec chaque prestataire. */
export default async function Page({ params }: { params: Promise<{ id: string; rfqId: string }> }) {
  const { t, locale } = await getT();
  const { id, rfqId } = await params;
  const { org, user, roles } = await requireMembership(id, EVENT_MANAGER_ROLES);
  const { rfqs, agencyName, creators, presentBy, rightFor, isOrganizer, own, keptElsewhere, now } = await orgRfqs(id, user, roles, rfqId);
  const r = rfqs[0];
  if (!r) notFound();
  const settings = complianceSettings(org.complianceSettings);
  const blocked = await engagementBlock(id, "devis");
  const base = `/organisations/${id}`;
  const st = RFQ_STATUS[rfqDisplayStatus(r)];
  const kept = r.quotes.find((q) => q.status === "retained");
  // Nombre définitif (traiteur, hôtel, transport, lieu) : proposé d'après les inscrits et les prestations acceptées.
  const serviceAt = r.serviceStart ?? r.event?.startsAt ?? null;
  const finalCount = kept && r.status === "awarded" && !r.conflicted && FINAL_COUNT_CATEGORIES.includes(r.category) && (!serviceAt || serviceAt > new Date())
    ? await (async () => {
        const regs = r.eventId ? await db.registration.findMany({ where: { eventId: r.eventId, cancelledAt: null }, select: { benefits: { select: { benefit: { select: { catalogId: true } } } } } }) : [];
        const wanted = FINAL_COUNT_BENEFITS[r.category];
        const accepted = wanted ? regs.filter((g) => g.benefits.some((b) => wanted.includes(b.benefit.catalogId))).length : 0;
        const suggested = accepted || regs.length || r.headcount || null;
        const basis = !r.eventId ? null : accepted
          ? t("Proposé : {n} inscrits ont accepté cette prestation ({m} inscrits en tout).", { n: accepted, m: regs.length })
          : t("Proposé : {n} inscrits à ce jour.", { n: regs.length });
        const soon = !!serviceAt && serviceAt.getTime() - Date.now() < (FINAL_COUNT_DAYS + 5) * 86400e3;
        return { suggested, basis, soon };
      })()
    : null;
  const best = r.quotes.length > 1 && !r.conflicted ? r.quotes[0].id : null;
  const ended = !!r.event && eventEnded(r.event, now);
  const present = r.event ? presentBy.get(r.event.id) ?? 0 : 0;
  const right = rightFor(r);
  const cancellable = (r.status === "draft" || r.status === "sent") && canCancelRfq({ organizer: isOrganizer, author: r.createdById === user.id, conflicted: r.conflicted });
  const canManage = r.status === "sent" && !r.conflicted;
  const toRemind = canManage ? remindable(r, now) : [];
  // Autres prestataires de la catégorie, pas encore consultés (une agence ne se consulte pas elle-même).
  const others = canManage ? (await supplierDirectory(user.memberships.map((m) => m.organizationId))).filter((s) => s.categories.includes(r.category) && !r.suppliers.some((x) => x.supplierId === s.id)) : [];
  const who = (uid: string | null) => {
    const c = uid ? creators.get(uid) : null;
    return c ? `${c.name}${c.agency ? ` (${c.agency}, ${t("agence mandatée")})` : ""}` : null;
  };
  const elsewhere = r.conflicted && r.status === "awarded" && !kept ? keptElsewhere(r.id) : null;
  const pending = r.suppliers.filter((s) => !r.quotes.some((q) => q.supplierId === s.supplierId));
  const declinedCount = pending.filter((s) => s.declined).length;
  const waitingFor = pending.length - declinedCount;
  const sectionTabs = await orgTabs("evenements", id);

  // Étapes : envoyée, devis reçus, attribuée, prestation, avis (annulée : l'étape atteinte barrée).
  const steps: Step[] = [
    { key: "envoi", label: t("Envoyée"), detail: r.sentAt ? fmtDate(locale, r.sentAt) : t("brouillon"), state: r.sentAt ? "done" : "current" },
    { key: "devis", label: t("Devis reçus"), detail: r.sentAt ? t("{n} sur {m}", { n: r.quotes.length, m: r.suppliers.length }) : null, state: r.status === "awarded" ? "done" : r.status === "sent" ? (r.quotes.length ? "done" : "current") : "todo" },
    { key: "choix", label: t("Devis retenu"), detail: kept ? kept.supplier.name : elsewhere, state: r.status === "awarded" ? "done" : r.status === "sent" && r.quotes.length ? "current" : "todo" },
    { key: "prestation", label: t("Prestation"), detail: r.event ? fmtDate(locale, r.event.startsAt) : null, state: r.status === "awarded" ? (ended || !r.event ? "done" : "current") : "todo" },
    { key: "avis", label: t("Avis"), detail: r.review ? "★".repeat(r.review.rating) : null, state: r.review ? "done" : r.status === "awarded" && (ended || !r.event) ? "current" : "todo" },
  ];
  if (r.status === "cancelled") {
    const at = steps.findIndex((s) => s.state === "current" || s.state === "todo");
    if (at >= 0) steps[at] = { ...steps[at], state: "bad", label: t("Annulée"), detail: r.cancelledAt ? fmtDate(locale, r.cancelledAt) : null };
    for (let i = at + 1; i < steps.length; i++) steps[i] = { ...steps[i], state: "todo" };
  }
  const late = r.status === "sent" && !!r.deadline && r.deadline < now;

  return (
    <>
      <SiteHeader />
      <main className="stack">
        <SectionNav tabs={sectionTabs} active="prestataires" label={t("Rubrique Événements")} />
        <Link href={`${base}/prestataires`} className="back-link"><ArrowLeft size={14} /> {t("Prestataires et devis")}</Link>
        <section id={`rfq-${r.id}`} className="stack rfq-page" aria-label={rfqTitle(r)}>
          <header className="card rfq-hero">
            <div className="rfq-hero-top">
              <CategoryIcon category={r.category} size={24} className="lg" />
              <div className="grow">
                <div className="eyebrow-sm">{t(supplierCategoryLabel(r.category))}{r.city ? ` · ${r.city}` : ""}</div>
                <h1>{rfqTitle(r)}</h1>
                <p className="muted">
                  {[r.event ? fmtDate(locale, r.event.startsAt) : null, r.event?.venue, r.headcount ? t("{headcount} participants attendus", { headcount: r.headcount }) : null].filter(Boolean).join(" · ")}
                  {r.event && <>{" · "}<Link href={`${base}/evenements/${r.event.id}`}>{t("Voir l'événement")}</Link></>}
                </p>
              </div>
              <span className={`pill ${st.tone}`}>{t(st.label)}</span>
            </div>
            <StepTrail steps={steps} label={t("Étapes de la demande")} />
            {!r.conflicted && (
              <dl className="hero-facts">
                <div><dt><Users size={13} /> {t("Prestataires consultés")}</dt><dd>{r.suppliers.length}<small>{waitingFor === 0 ? (r.status === "draft" ? t("à l'envoi") : t("tous ont répondu")) : t("{n} sans réponse", { n: waitingFor })}{declinedCount ? ` · ${t(declinedCount > 1 ? "{n} ont décliné" : "{n} a décliné", { n: declinedCount })}` : ""}</small></dd></div>
                <div><dt><FileText size={13} /> {t("Devis reçus")}</dt><dd>{r.quotes.length}<small>{r.quotes.length ? t("dès {montant} TTC", { montant: fmtEur(locale, quoteTtc(r.quotes[0])) }) : t("aucun pour l'instant")}</small></dd></div>
                {kept ? (
                  <div><dt><Check size={13} /> {t("Montant retenu")}</dt><dd>{t("{amount} HT", { amount: fmtEur(locale, kept.amountCents) })}<small>{t("{amount} TTC", { amount: fmtEur(locale, quoteTtc(kept)) })}</small></dd></div>
                ) : (
                  <div className={late ? "warn" : ""}><dt><CalendarClock size={13} /> {t("Réponse attendue")}</dt><dd>{r.deadline ? fmtDate(locale, r.deadline) : t("à définir")}<small>{late ? t("échéance dépassée") : r.deadline ? t("avant minuit") : t("sans date limite")}</small></dd></div>
                )}
              </dl>
            )}
          </header>

          {r.conflicted && (
            <div className="info-note">
              <Info size={15} />
              <span>
                {t("Votre organisation est consultée sur cette demande : l'organisation la conduit seule. Vous n'y voyez que votre devis et vos échanges ; répondez depuis")}{" "}<Link href={`/organisations/${r.suppliers[0]?.supplierId}/devis/${r.id}`}>{t("vos demandes de devis")}</Link>.
              </span>
            </div>
          )}

          {elsewhere && <p className="notice">{t("Attribuée à {keptElsewhere}", { keptElsewhere: elsewhere })}</p>}

          <section className="card stack-sm">
            <SectionHead icon={FileText} title={t("Le besoin")} desc={who(r.createdById) ? t("Créée par {v} le {date}", { v: who(r.createdById)!, date: fmtDate(locale, r.createdAt) }) : t("Créée le {date}", { date: fmtDate(locale, r.createdAt) })} />
            <p className="rfq-needs">{r.needs}</p>
            <RfqBrief rfq={r} />
            {r.status === "cancelled" && r.cancelledAt && (
              <p className="notice warn">{who(r.cancelledById) ? t("Annulée par {v} le {date}", { v: who(r.cancelledById)!, date: fmtDate(locale, r.cancelledAt) }) : t("Annulée le {date}", { date: fmtDate(locale, r.cancelledAt) })}</p>
            )}
            {r.status === "draft" && !r.conflicted && (
              <>
                <p className="muted">{t("Prestataires sélectionnés : {join}.", { join: r.suppliers.map((s) => s.supplier.name + (agencyName.has(s.supplierId) ? ` (${t("agence mandatée")})` : "")).join(", ") })}</p>
                <form action={sendRfq} className="actions">
                  <input type="hidden" name="orgId" value={id} />
                  <input type="hidden" name="rfqId" value={r.id} />
                  <button className="btn" disabled={!!blocked}><Send size={14} /> {r.suppliers.length > 1 ? t("Envoyer aux {suppliers} prestataires", { suppliers: r.suppliers.length }) : t("Envoyer au prestataire")}</button>
                </form>
              </>
            )}
          </section>

          {(r.status !== "draft" || r.conflicted) && (
            <section className="stack-sm" aria-labelledby="devis-titre">
              <SectionHead icon={FileSignature} id="devis-titre" title={t("Devis ({n})", { n: r.quotes.length })} desc={r.quotes.length > 1 ? t("Du moins cher au plus cher (TTC). Chaque prestataire ne voit que son propre devis.") : t("Chaque prestataire ne voit que son propre devis et ses échanges avec vous.")}>
                {toRemind.length > 0 && (
                  <form action={remindRfqSuppliers}>
                    <input type="hidden" name="orgId" value={id} />
                    <input type="hidden" name="rfqId" value={r.id} />
                    <ConfirmButton className="btn ghost small" confirm={t("relancer les prestataires")} summary={t(toRemind.length > 1 ? "Les {n} prestataires sans réponse reçoivent un rappel par e-mail ({names})." : "Le prestataire sans réponse reçoit un rappel par e-mail ({names}).", { n: toRemind.length, names: toRemind.map((s) => s.supplier.name).join(", ") })}>
                      <BellRing size={13} /> {t(toRemind.length > 1 ? "Relancer les {n} sans réponse" : "Relancer le prestataire sans réponse", { n: toRemind.length })}
                    </ConfirmButton>
                  </form>
                )}
              </SectionHead>
              <div className="quote-compare">
                {r.quotes.map((q) => (
                  <QuoteCard
                    key={q.id} q={q} r={r} t={t} locale={locale} orgId={id} meId={user.id} best={q.id === best} ended={ended} present={present} settings={settings} right={right}
                    ownSupplier={own(q.supplierId)} agency={agencyName.has(q.supplierId) ? (q.supplierId === r.event?.agencyId ? "event" : "mandate") : null} proposedBy={r.proposedById ? who(r.proposedById) : null} now={now}
                  />
                ))}
                {!r.conflicted && pending.map((s) => (
                  <article key={s.supplierId} className={`quote q-card waiting${s.declined ? " out" : ""}`}>
                    <header className="q-head">
                      <Avatar name={s.supplier.name} size={36} square src={logoSrc(s.supplier)} />
                      <div className="grow">
                        <strong>{s.supplier.name}</strong>
                        <a className="text-xs" href={`/structures/${s.supplierId}`} target="_blank" rel="noreferrer">{t("Voir sa page")}</a>
                      </div>
                      {agencyName.has(s.supplierId) && <span className="pill wait">{t("Agence mandatée")}</span>}
                    </header>
                    <div className="q-empty">
                      {s.declined ? (
                        <>
                          <X size={18} />
                          <strong>{t("{name} a décliné", { name: s.supplier.name })}</strong>
                          {s.declineNote && <span className="text-sm muted">« {s.declineNote} »</span>}
                        </>
                      ) : r.status === "sent" ? (
                        <>
                          <Clock size={18} />
                          <strong>{t("Devis attendu")}</strong>
                          <span className="text-sm muted">{s.remindedAt ? t("Relancé le {date}", { date: fmtDate(locale, s.remindedAt) }) : t("Consulté le {date}", { date: fmtDate(locale, r.sentAt ?? r.createdAt) })}</span>
                        </>
                      ) : (
                        <>
                          <Clock size={18} />
                          <strong>{t("Pas de devis")}</strong>
                        </>
                      )}
                    </div>
                    <SupplierThread r={r} supplierId={s.supplierId} name={s.supplier.name} t={t} orgId={id} meId={user.id} canWrite={r.status === "sent" && !s.declined} />
                  </article>
                ))}
                {canManage && others.length > 0 && (
                  <details className="quote q-card add-supplier">
                    <summary><UserPlus size={18} /> <strong>{t("Consulter un autre prestataire")}</strong><span className="text-sm muted">{t(others.length > 1 ? "{n} autres prestataires référencés dans la catégorie" : "{n} autre prestataire référencé dans la catégorie", { n: others.length })}</span></summary>
                    <form action={addRfqSuppliers} className="stack-sm">
                      <input type="hidden" name="orgId" value={id} />
                      <input type="hidden" name="rfqId" value={r.id} />
                      {others.map((s) => (
                        <label key={s.id} className="check pick-line">
                          <input type="checkbox" name="supplierIds" value={s.id} />
                          <Avatar name={s.name} size={26} square src={logoSrc(s)} />
                          <span className="grow"><strong>{s.name}</strong> <span className="muted text-xs">{s.coverage ?? s.city ?? ""}{s.rating != null ? ` · ★ ${s.rating.toFixed(1).replace(".", ",")}` : ""}</span></span>
                        </label>
                      ))}
                      <p className="hint">{t("Ils reçoivent la même demande, avec la même date de réponse.")}</p>
                      <button className="btn small"><Plus size={13} /> {t("Consulter")}</button>
                    </form>
                  </details>
                )}
              </div>
              {right === "propose" && r.status === "sent" && <p className="hint">{t("Votre mandat ne vous permet pas de retenir un devis : proposez-en un, l'organisation décide.")}</p>}
            </section>
          )}

          {finalCount && (
            <section className="card stack-sm" id="nombre-definitif">
              <SectionHead icon={Users} title={t("Nombre définitif")} desc={t("{name} facture sur ce nombre : il le demande en général 7 à 15 jours avant la prestation.", { name: kept!.supplier.name })} tone={r.finalHeadcount == null && finalCount.soon ? "warn" : undefined} />
              {r.finalHeadcount != null && r.finalHeadcountAt && <p className="text-sm">{t("Confirmé : {n}, le {date}.", { n: r.finalHeadcount, date: fmtDate(locale, r.finalHeadcountAt) })}</p>}
              <FinalHeadcountForm orgId={id} rfqId={r.id} current={r.finalHeadcount} suggested={finalCount.suggested} basis={finalCount.basis} />
            </section>
          )}

          {kept && r.status === "awarded" && (
            <section className="card stack-sm" id="facture">
              <SectionHead icon={Receipt} title={t("Facture de {name}", { name: kept.supplier.name })} desc={t("Rapprochée du devis retenu ({amount} TTC).", { amount: fmtEur(locale, quoteTtc(kept)) })} />
              {kept.invoicedAt ? (
                <>
                  <p className="text-sm">
                    {t("Transmise le {date} : {amount} TTC", { date: fmtDate(locale, kept.invoicedAt), amount: fmtEur(locale, kept.invoiceCents ?? 0) })}
                    {kept.invoiceCents != null && kept.invoiceCents !== quoteTtc(kept) ? <> · <span className="warn-text">{kept.invoiceCents > quoteTtc(kept) ? t("{d} de plus que le devis", { d: fmtEur(locale, kept.invoiceCents - quoteTtc(kept)) }) : t("{d} de moins que le devis", { d: fmtEur(locale, quoteTtc(kept) - kept.invoiceCents) })}</span></> : <> · <span className="ok-text">{t("conforme au devis")}</span></>}
                    {kept.invoiceKey && <> · <a href={`/devis/${kept.id}?facture=1`}>{t("Télécharger (PDF)")}</a></>}
                  </p>
                  {kept.invoicePaidAt ? <p className="notice ok">{t("Payée le {date}.", { date: fmtDate(locale, kept.invoicePaidAt) })}</p> : isOrganizer && (
                    <form action={markInvoicePaid} className="inline">
                      <input type="hidden" name="orgId" value={id} />
                      <input type="hidden" name="quoteId" value={kept.id} />
                      <button className="btn small">{t("Marquer la facture payée")}</button>
                    </form>
                  )}
                </>
              ) : <p className="muted">{t("Aucune facture transmise pour l'instant : le prestataire la dépose depuis sa page de la demande après la prestation.")}</p>}
            </section>
          )}

          {kept && r.status === "awarded" && isOrganizer && (!r.event || r.event.startsAt < now) && (
            <section className="card stack-sm">
              <SectionHead icon={Star} title={t("Votre avis sur {name}", { name: kept.supplier.name })} desc={t("Publié sur la page du prestataire avec le nom de votre organisation ; il aide les autres organisations à choisir.")} />
              {r.review
                ? <p className="text-sm">{t("Votre avis :")}{" "}<span className="rating">{"★".repeat(r.review.rating)}</span> {r.review.comment ? `« ${r.review.comment} »` : ""}{r.review.hiddenAt ? ` · ${t("masqué par l'équipe KolBase : {note}", { note: r.review.hiddenReason ?? "" })}` : ""}</p>
                : <ReviewForm orgId={id} rfqId={r.id} supplier={kept.supplier.name} />}
            </section>
          )}

          {cancellable && (
            <div className="actions">
              <form action={cancelRfq}>
                <input type="hidden" name="orgId" value={id} />
                <input type="hidden" name="rfqId" value={r.id} />
                <ConfirmButton
                  className="btn ghost small"
                  confirm={t("annuler la demande")}
                  summary={<>{r.status === "sent" ? t(r.suppliers.length > 1 ? "Les {n} prestataires consultés sont prévenus par e-mail ; aucun devis ne pourra plus être retenu sur cette demande." : "Le prestataire consulté est prévenu par e-mail ; aucun devis ne pourra plus être retenu sur cette demande.", { n: r.suppliers.length }) : t("Le brouillon n'a pas été envoyé : aucun prestataire n'est prévenu.")}{!isOrganizer ? t(" Les organisateurs sont prévenus par e-mail.") : ""}</>}
                >
                  <X size={13} />{" "}{t("Annuler la demande")}
                </ConfirmButton>
              </form>
            </div>
          )}
        </section>
      </main>
    </>
  );
}

/** Un devis, dans la grille de comparaison : prix TTC en avant, coût par participant, conditions, détail, décision, échanges. */
function QuoteCard({ q, r, t, locale, orgId, meId, best, ended, present, settings, right, ownSupplier, agency, proposedBy, now }: {
  q: Quote; r: OrgRfq; t: T; locale: Locale; orgId: string; meId: string; best: boolean; ended: boolean; present: number; settings: ReturnType<typeof complianceSettings>;
  right: "award" | "propose" | "none"; ownSupplier: boolean; agency: "event" | "mandate" | null; proposedBy: string | null; now: Date;
}) {
  const loc = intlLocale(locale);
  const lines = readLines(q.lines);
  const ttc = quoteTtc(q);
  // Seuils sur le prix par couvert commandé ; coût par présent après l'événement, pour information.
  const head = costPerHead(ttc, r.headcount, present, ended);
  const pp = perParticipant(r.category, ttc, r.headcount, settings);
  const expired = !!q.validUntil && q.validUntil < now;
  const open = r.status === "sent";
  return (
    <article className={`quote q-card${best ? " best" : ""}${q.status === "retained" ? " kept" : ""}${q.status === "rejected" ? " out" : ""}`}>
      <header className="q-head">
        <Avatar name={q.supplier.name} size={36} square src={logoSrc(q.supplier)} />
        <div className="grow">
          <strong>{q.supplier.name}</strong>
          <a className="text-xs" href={`/structures/${q.supplierId}`} target="_blank" rel="noreferrer">{t("Voir sa page")}</a>
        </div>
        {q.status !== "submitted" && <span className={`pill ${q.status === "retained" ? "ok" : "done"}`}>{t(QUOTE_STATUS[q.status])}</span>}
      </header>
      <div className="q-badges">
        {best && <span className="pill ok" title={t("Total TTC le plus bas")}>{t("Meilleure offre")}</span>}
        {agency && <span className="pill wait">{agency === "event" ? t("Agence mandatée sur cet événement") : t("Agence mandatée")}</span>}
        {open && r.proposedQuoteId === q.id && <span className="pill electric" title={proposedBy ? t("Proposé par {v}", { v: proposedBy }) : undefined}>{t("Proposé par l'agence mandatée")}</span>}
        {q.revision > 1 && <span className="pill">{t("Version {revision}", { revision: q.revision })}</span>}
      </div>
      <div className="q-price">
        <span className="q-ttc">{fmtEur(locale, ttc)} <small>{t("TTC")}</small></span>
        <span className="muted text-sm">{t("{amount} HT · TVA {rate}", { amount: fmtEur(locale, q.amountCents), rate: quoteVatLabel(q, loc, t(" et ")) })}</span>
      </div>
      {pp && (
        <PerHeadGauge
          each={pp.each}
          max={pp.limit?.max}
          over={pp.over}
          label={t("≈ {amount} € TTC {per}", { amount: pp.each.toLocaleString(loc, { maximumFractionDigits: 2 }), per: t(perHeadLabel(r.category)) })}
          limitLabel={pp.limit ? (pp.over ? t("au-dessus du seuil {of} ({max} € TTC) : autorisation de l'Ordre à prévoir pour les professionnels de santé", { of: t(pp.limit.of), max: pp.limit.max }) : t("sous le seuil {of} ({max} € TTC)", { of: t(pp.limit.of), max: pp.limit.max })) : null}
        />
      )}
      {head.perPresent != null && <p className="text-xs muted">{t("Pour information : {toLocaleString} € TTC par présent ({present} au pointage)", { toLocaleString: head.perPresent.toLocaleString(loc, { maximumFractionDigits: 2 }), present })}</p>}
      <ul className="q-facts">
        <li className={expired ? "warn-text" : ""}><CalendarClock size={14} /> {q.validUntil ? t(expired ? "expiré le {date}" : "valable jusqu'au {date}", { date: fmtDate(locale, q.validUntil) }) : t("sans date de validité")}</li>
        {q.delay && <li><Clock size={14} /> {q.delay}</li>}
        {termsParts(q).length > 0 && <li><FileSignature size={14} /> {t("Acompte et annulation : {terms}", { terms: termsParts(q).map((p) => t(p.key, p.vars)).join(", ") })}</li>}
        {q.conditions && <li><FileSignature size={14} /> {t("Conditions : {conditions}", { conditions: q.conditions })}</li>}
      </ul>
      {q.note && <p className="q-note">{q.note}</p>}
      {(lines.length > 0 || q.fileKey) && (
        <details className="quote-detail">
          <summary>{t("Détail de l'offre")}{lines.length ? ` ${t(lines.length > 1 ? "({lines} lignes)" : "({lines} ligne)", { lines: lines.length })}` : ""}</summary>
          {lines.length > 0 && (
            <table>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i}>
                    <td>{l.label}</td>
                    <td>{l.qty.toLocaleString(loc)} × {fmtEur(locale, l.unitCents)}</td>
                    <td>{t("TVA")} {vatLabel(lineVat(l, q.vatBp), loc)}</td>
                    <td>{fmtEur(locale, lineTotal(l))} {t("HT")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {q.fileKey && <a href={`/devis/${q.id}`} target="_blank" rel="noreferrer">{t("Devis signé (PDF)")}</a>}
        </details>
      )}
      <div className="q-actions">
        {open && ownSupplier && <span className="text-xs muted" title={t("Conflit d'intérêts : vous êtes membre de ce prestataire.")}>{t("À retenir par l'organisation (conflit d'intérêts)")}</span>}
        {open && expired && !ownSupplier && (
          <>
            <span className="text-xs warn-text" title={t("Une offre expirée n'engage plus le prestataire.")}>{t("Offre expirée : demandez une version à jour")}</span>
            {right !== "none" && (
              <form action={requestQuoteUpdate}>
                <input type="hidden" name="orgId" value={orgId} />
                <input type="hidden" name="quoteId" value={q.id} />
                <button className="btn ghost small"><MessageSquare size={13} /> {t("Demander une version à jour")}</button>
              </form>
            )}
          </>
        )}
        {open && !expired && !ownSupplier && right === "award" && (
          <form action={awardQuote} className="award-form">
            <input type="hidden" name="orgId" value={orgId} />
            <input type="hidden" name="quoteId" value={q.id} />
            <ConfirmButton
              className="btn small"
              confirm={t("retenir le devis {de}", { de: de(q.supplier.name) })}
              summary={
                <>
                  <strong>{q.supplier.name}</strong>{" "}{t(": {montant} HT, soit {montant2} TTC (TVA {quoteVatLabel}).", { montant: fmtEur(locale, q.amountCents), montant2: fmtEur(locale, ttc), quoteVatLabel: quoteVatLabel(q, loc, t(" et ")) })}
                  {r.quotes.length > 1 && <>{" "}{t("Devis écartés : {join}.", { join: r.quotes.filter((x) => x.id !== q.id).map((x) => `${x.supplier.name} (${fmtEur(locale, x.amountCents)} HT)`).join(", ") })}</>}
                  {t("Chaque prestataire est prévenu par e-mail ; la décision est définitive.")}
                </>
              }
            >
              <Check size={13} />{" "}{t("Retenir")}
            </ConfirmButton>
          </form>
        )}
        {open && !expired && !ownSupplier && right === "propose" && (
          r.proposedQuoteId === q.id
            ? <span className="text-xs muted">{t("Proposé à l'organisation, qui retient")}</span>
            : (
              <form action={proposeQuote}>
                <input type="hidden" name="orgId" value={orgId} />
                <input type="hidden" name="quoteId" value={q.id} />
                <button className="btn small secondary" title={t("Votre mandat ne permet pas de retenir un devis : l'organisation décide.")}>{t("Proposer à l'organisation")}</button>
              </form>
            )
        )}
      </div>
      <SupplierThread r={r} supplierId={q.supplierId} name={q.supplier.name} t={t} orgId={orgId} meId={meId} canWrite={!r.conflicted && (open || q.status === "retained")} />
    </article>
  );
}

/** Échanges privés avec un prestataire consulté, ouverts quand il attend une réponse. */
function SupplierThread({ r, supplierId, name, t, orgId, meId, canWrite }: { r: OrgRfq; supplierId: string; name: string; t: T; orgId: string; meId: string; canWrite: boolean }) {
  const msgs = r.messages.filter((m) => m.supplierId === supplierId);
  if (!canWrite && msgs.length === 0) return null;
  const last = msgs.at(-1);
  const toAnswer = !!last?.fromSupplier;
  return (
    <details className="rfq-thread" open={toAnswer}>
      <summary>
        <MessageSquare size={14} />
        <strong>{t("Échanges avec {name}", { name })}</strong>
        <span className="muted text-xs">{msgs.length ? t(msgs.length > 1 ? "{msgs} messages" : "{msgs} message", { msgs: msgs.length }) : t("aucun message")}</span>
        {toAnswer && <span className="pill electric">{t("Nouveau message")}</span>}
      </summary>
      <Thread messages={msgs} meId={meId} />
      {canWrite && <RfqMessageForm orgId={orgId} rfqId={r.id} supplierId={supplierId} placeholder={t("Écrire à {name}…", { name })} />}
    </details>
  );
}
