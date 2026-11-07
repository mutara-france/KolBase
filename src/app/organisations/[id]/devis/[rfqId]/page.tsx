import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Building2, CalendarClock, Clock, FileSignature, FileText, MapPin, MessageSquare, Users } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { SectionHead } from "@/components/UI";
import { CategoryIcon, StepTrail, type Step } from "@/components/SupplierBits";
import { QuoteForm, RfqMessageForm } from "@/components/RfqForms";
import { Thread } from "@/components/ProjectBits";
import { BillingNotice } from "@/components/BillingNotice";
import { ConfirmButton } from "@/components/ConfirmButton";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/orgs";
import { aiEnabled } from "@/lib/ai";
import { storageEnabled } from "@/lib/storage";
import { billingBlocked } from "@/lib/billing";
import { declineRfq } from "@/lib/rfq-actions";
import { QUOTE_STATUS, supplierCategoryLabel, rfqTitle } from "@/lib/suppliers";
import { lineTotal, lineVat, quoteTtc, quoteVatLabel, readLines, vatLabel } from "@/lib/quotes";
import { getT } from "@/lib/i18n/server";
import { fmtDate, fmtEur, intlLocale } from "@/lib/i18n";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: `${t("Demande de devis")} — KolBase` };
}

/** Une demande reçue par un prestataire : le besoin et les échanges d'un côté, son devis de l'autre. */
export default async function Page({ params }: { params: Promise<{ id: string; rfqId: string }> }) {
  const { t, locale } = await getT();
  const { id, rfqId } = await params;
  const { org, user } = await requireMembership(id);
  if (org.kind !== "PRESTATAIRE") redirect(`/organisations/${id}`);
  const invite = await db.rfqSupplier.findUnique({
    where: { rfqId_supplierId: { rfqId, supplierId: id } },
    include: {
      rfq: {
        include: {
          organization: { select: { id: true, name: true, listed: true, verification: true } },
          event: { select: { title: true, startsAt: true, venue: true, city: true } },
          quotes: { where: { supplierId: id } },
          messages: { where: { supplierId: id }, include: { author: { select: { firstName: true, lastName: true } } }, orderBy: { createdAt: "asc" } },
        },
      },
    },
  });
  if (!invite || invite.rfq.status === "draft") notFound();
  const r = invite.rfq;
  const declined = invite.declined;
  const q = r.quotes[0];
  const open = r.status === "sent";
  const loc = intlLocale(locale);
  // Après un premier devis retenu, une nouvelle réponse suppose l'abonnement (les révisions restent libres).
  const [quoteBlocked, offers] = await Promise.all([
    billingBlocked(id, "reponse"),
    db.supplierOffer.findMany({ where: { organizationId: id }, orderBy: { createdAt: "asc" } }),
  ]);
  const now = new Date();
  const late = open && !q && !declined && !!r.deadline && r.deadline < now;
  const ended = !!r.event && r.event.startsAt < now;
  const status =
    r.status === "cancelled" ? { tone: "bad", text: t("Annulée") }
    : q ? { tone: q.status === "retained" ? "ok" : q.status === "rejected" ? "done" : "electric", text: t(QUOTE_STATUS[q.status]) }
    : r.status === "awarded" ? { tone: "done", text: t("Attribuée à un autre prestataire") }
    : declined ? { tone: "done", text: t("Déclinée") }
    : { tone: "wait", text: t("Devis attendu") };
  const decided = r.status === "awarded" || q?.status === "retained" || q?.status === "rejected";
  const steps: Step[] = [
    { key: "recue", label: t("Demande reçue"), detail: r.sentAt ? fmtDate(locale, r.sentAt) : null, state: "done" },
    { key: "devis", label: t("Votre devis"), detail: q ? (q.revision > 1 ? t("version {revision}", { revision: q.revision }) : fmtDate(locale, q.updatedAt)) : declined ? t("déclinée") : null, state: q ? "done" : declined || r.status === "cancelled" ? "bad" : "current" },
    { key: "decision", label: t("Décision"), detail: q?.status === "retained" ? t("retenu") : q?.status === "rejected" || (r.status === "awarded" && !q) ? t("non retenu") : null, state: decided ? (q?.status === "retained" ? "done" : "bad") : q && open ? "current" : "todo" },
    { key: "prestation", label: t("Prestation"), detail: r.event ? fmtDate(locale, r.event.startsAt) : null, state: q?.status === "retained" ? (ended ? "done" : "current") : "todo" },
  ];
  if (r.status === "cancelled") {
    const at = steps.findIndex((s) => s.state === "current" || s.state === "todo");
    if (at >= 0) steps[at] = { ...steps[at], state: "bad", label: t("Annulée") };
  }
  const lines = q ? readLines(q.lines) : [];
  const canWrite = (open || q?.status === "retained") && !declined;

  return (
    <>
      <SiteHeader />
      <main className="stack">
        <Link href={`/organisations/${id}/devis`} className="back-link"><ArrowLeft size={14} /> {t("Demandes de devis")}</Link>
        <BillingNotice orgId={id} motive="reponse" />
        <header className="card rfq-hero">
          <div className="rfq-hero-top">
            <CategoryIcon category={r.category} size={24} className="lg" />
            <div className="grow">
              <div className="eyebrow-sm">{t(supplierCategoryLabel(r.category))} · {r.organization.name}</div>
              <h1>{rfqTitle(r)}</h1>
              <p className="muted">{[r.event ? fmtDate(locale, r.event.startsAt) : null, r.event?.venue, r.event?.city ?? r.city, r.headcount ? t("{headcount} participants", { headcount: r.headcount }) : null].filter(Boolean).join(" · ")}</p>
            </div>
            <span className={`pill ${status.tone}`}>{status.text}</span>
          </div>
          <StepTrail steps={steps} label={t("Étapes de la demande")} />
        </header>

        {q?.status === "retained" && <p className="notice ok">{t("{name} a retenu votre devis. Échangez ci-dessous pour préparer la prestation.", { name: r.organization.name })}</p>}
        {q?.status === "rejected" && <p className="notice">{t("{name} a retenu une autre offre. Merci pour votre réponse : elle compte dans votre taux de réponse.", { name: r.organization.name })}</p>}
        {r.status === "cancelled" && <p className="notice warn">{t("{name} a annulé cette demande : aucune réponse n'est plus attendue.", { name: r.organization.name })}</p>}

        <div className="rfq-split">
          <div className="stack">
            <section className="card stack-sm">
              <SectionHead icon={FileText} title={t("La demande")} desc={t("Ce que {name} attend de vous.", { name: r.organization.name })} />
              <p className="rfq-needs">{r.needs}</p>
              <dl className="hero-facts">
                <div><dt><CalendarClock size={13} /> {t("Réponse attendue")}</dt><dd className={late ? "warn-text" : ""}>{r.deadline ? fmtDate(locale, r.deadline) : t("à définir")}<small>{late ? t("échéance dépassée") : r.sentAt ? t("reçue le {date}", { date: fmtDate(locale, r.sentAt) }) : ""}</small></dd></div>
                <div><dt><Users size={13} /> {t("Participants")}</dt><dd>{r.headcount ?? "—"}<small>{r.category === "restauration" ? t("couverts à prévoir") : t("attendus")}</small></dd></div>
                <div><dt><MapPin size={13} /> {t("Lieu")}</dt><dd>{r.event?.city ?? r.city ?? "—"}<small>{r.event?.venue ?? t("à préciser")}</small></dd></div>
              </dl>
              <p className="text-sm muted"><Building2 size={13} /> {t("Client :")} {r.organization.listed && r.organization.verification === "VERIFIED" ? <Link href={`/structures/${r.organization.id}`}>{r.organization.name}</Link> : r.organization.name}</p>
            </section>
            <section className="card stack-sm rfq-talk">
              <SectionHead icon={MessageSquare} title={t("Questions et échanges avec {name}", { name: r.organization.name })} desc={r.messages.length ? t(r.messages.length > 1 ? "{messages} messages" : "{messages} message", { messages: r.messages.length }) : t("Une précision sur le besoin ? Posez votre question ici : seule l'organisation la lit.")} />
              {r.messages.length > 0 && <Thread messages={r.messages} meId={user.id} />}
              {canWrite && <RfqMessageForm orgId={id} rfqId={r.id} supplierId={id} placeholder={t("Votre question à {name}…", { name: r.organization.name })} />}
            </section>
          </div>

          <section className="card stack-sm rfq-mine" aria-label={t("Votre devis")}>
            <SectionHead icon={FileSignature} title={t("Votre devis")} desc={q ? t("Envoyé le {date}{v}", { date: fmtDate(locale, q.updatedAt), v: q.revision > 1 ? ` · ${t("version {revision}", { revision: q.revision })}` : "" }) : open ? t("Détaillez votre offre ligne par ligne : les totaux et le prix par participant se calculent seuls.") : t("Aucun devis envoyé.")} />
            {q && (
              <div className="quote-view">
                <div className="q-price">
                  <span className="q-ttc">{fmtEur(locale, quoteTtc(q))} <small>{t("TTC")}</small></span>
                  <span className="muted text-sm">{t("{amount} HT · TVA {rate}", { amount: fmtEur(locale, q.amountCents), rate: quoteVatLabel(q, loc, t(" et ")) })}{r.headcount ? ` · ${t("{amount} TTC par participant", { amount: fmtEur(locale, Math.round(quoteTtc(q) / r.headcount)) })}` : ""}</span>
                </div>
                {lines.length > 0 && (
                  <table className="quote-table">
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
                <ul className="q-facts">
                  <li><CalendarClock size={14} /> {q.validUntil ? t(q.validUntil < now ? "expiré le {date}" : "valable jusqu'au {date}", { date: fmtDate(locale, q.validUntil) }) : t("sans date de validité")}</li>
                  {q.delay && <li><Clock size={14} /> {q.delay}</li>}
                  {q.conditions && <li><FileSignature size={14} /> {t("Conditions : {conditions}", { conditions: q.conditions })}</li>}
                </ul>
                {q.note && <p className="q-note">{q.note}</p>}
                {q.fileKey && <a href={`/devis/${q.id}`} target="_blank" rel="noreferrer">{t("Devis signé (PDF)")}</a>}
              </div>
            )}
            {open && (
              <QuoteForm
                orgId={id}
                rfqId={r.id}
                category={r.category}
                offers={offers.map((o) => ({ label: o.label, unit: o.unit, unitCents: o.unitCents }))}
                ai={aiEnabled()}
                headcount={r.headcount}
                uploads={storageEnabled()}
                blocked={quoteBlocked}
                current={q ? {
                  amount: String(q.amountCents / 100), delay: q.delay ?? "", note: q.note ?? "", conditions: q.conditions ?? "", vatBp: q.vatBp, revision: q.revision, fileName: q.fileName,
                  validUntil: q.validUntil ? q.validUntil.toISOString().slice(0, 10) : "",
                  lines: lines.map((l) => ({ label: l.label, qty: l.qty, unit: String(l.unitCents / 100), vatBp: lineVat(l, q.vatBp) })),
                } : undefined}
              />
            )}
            {open && !q && !declined && (
              <form action={declineRfq} className="stack-sm decline-form">
                <input type="hidden" name="orgId" value={id} />
                <input type="hidden" name="rfqId" value={r.id} />
                <details>
                  <summary className="link danger">{t("Décliner la demande")}</summary>
                  <label>{t("Motif (facultatif, transmis à {name})", { name: r.organization.name })}<input name="note" maxLength={500} placeholder={t("Indisponible à cette date, hors de notre zone…")} /></label>
                  <ConfirmButton className="btn ghost small" confirm={t("décliner la demande")} summary={t("{name} est prévenue par e-mail ; vous pourrez encore envoyer un devis tant que la demande est ouverte.", { name: r.organization.name })}>
                    {t("Décliner")}
                  </ConfirmButton>
                </details>
              </form>
            )}
            {declined && <p className="notice">{t("Vous avez décliné cette demande{v}. Vous pouvez encore envoyer un devis tant qu'elle est ouverte.", { v: invite.declineNote ? ` (« ${invite.declineNote} »)` : "" })}</p>}
          </section>
        </div>
      </main>
    </>
  );
}
