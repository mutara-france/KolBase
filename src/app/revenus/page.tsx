import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2, Euro, FileClock, Gift, Hourglass } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { BillingForm, InterestForm, IssueNoteButton, ReportForm } from "@/components/RevenueForms";
import { billingComplete } from "@/lib/fee-notes";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { INTEREST_YEARS, interestLines, practitionerLedger } from "@/lib/revenues";
import { removeDeclaredInterest } from "@/lib/revenue-actions";
import { STATUS_LABEL } from "@/lib/projects";
import { feeTotals } from "@/lib/indicators";
import { fmtDate, fmtEur } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: `${t("Mes revenus")} — KolBase` };
}

export default async function Page({ searchParams }: { searchParams: Promise<{ onglet?: string; annee?: string }> }) {
  const user = await requireUser();
  const p = user.practitioner;
  if (!p) redirect("/tableau-de-bord");
  const sp = await searchParams;
  const onglet = sp.onglet === "liens" ? "liens" : sp.onglet === "transparence" ? "transparence" : sp.onglet === "facturation" ? "facturation" : "revenus";
  const { t, locale } = await getT();
  const ledger = await practitionerLedger(user.id, p.id);
  // Structure de facturation : seule source de la société d'exercice (conventions et notes d'honoraires).
  const payee = onglet === "facturation" ? await db.practitionerStructure.findFirst({ where: { practitionerId: p.id, isPayee: true } }) : null;
  const years = [...new Set([...ledger.fees.map((f) => f.year), ...ledger.hospitality.map((h) => h.year), new Date().getFullYear()])].sort((a, b) => b - a);
  const year = years.includes(Number(sp.annee)) ? Number(sp.annee) : years[0];
  const fees = ledger.fees.filter((f) => f.year === year);
  const hosp = ledger.hospitality.filter((h) => h.year === year);
  // À percevoir : convention signée, pas encore payée ; en préparation : le reste (pas encore dû).
  const { paid, due, preparing } = feeTotals(fees);
  const hospTotal = hosp.filter((h) => !h.absent).reduce((s, h) => s + h.valueCents, 0);
  const orgs = new Set([...fees.map((f) => f.org.id), ...hosp.map((h) => h.org.id)]).size;
  const interests = interestLines(ledger);
  const tabs = [["revenus", t("Honoraires et avantages")], ["facturation", t("Notes d'honoraires")], ["liens", t("Liens d'intérêts")], ["transparence", t("Transparence Santé")]] as const;
  const billingOk = billingComplete(p);
  const notes = ledger.fees.filter((f) => f.note).sort((a, b) => b.note!.issuedAt.getTime() - a.note!.issuedAt.getTime());
  const toInvoice = ledger.fees.filter((f) => f.signed && !f.note && f.feeCents > 0);
  const NoteCell = ({ f }: { f: (typeof ledger.fees)[number] }) =>
    f.note ? <a href={`/notes-honoraires/${f.note.id}`}>{f.note.number}</a>
      : !f.signed || !f.feeCents ? <span className="muted">—</span>
      : billingOk ? <IssueNoteButton linkId={f.id} />
      : <Link className="text-xs" href="?onglet=facturation">{t("Compléter la facturation")}</Link>;
  const feeStatus = (f: (typeof ledger.fees)[number]) =>
    f.paidAt ? t("Payé le {date}", { date: fmtDate(locale, f.paidAt) }) : f.signed ? t("Convention signée, paiement à venir") : t(STATUS_LABEL[f.status]);

  return (
    <>
      <SiteHeader />
      <main className="stack">
        <div>
          <h1>{t("Mes revenus")}</h1>
          <p className="muted">{t("Vos honoraires, les avantages reçus et vos liens d'intérêts, tels que KolBase les connaît. Visible de vous seul.")}</p>
        </div>
        <nav className="tabs" aria-label={t("Mes revenus")}>
          {tabs.map(([k, l]) => <Link key={k} href={`?onglet=${k}`} className={k === onglet ? "active" : ""}>{l}</Link>)}
        </nav>

        {onglet === "revenus" && (
          <>
            <div className="actions spread">
              <nav className="chips" aria-label={t("Année")}>
                {years.map((y) => <Link key={y} href={`?onglet=revenus&annee=${y}`} className={`chip${y === year ? " active" : ""}`}>{y}</Link>)}
              </nav>
              <a className="btn ghost small" href={`/revenus/export?annee=${year}`}>{t("Exporter {year} (CSV)", { year })}</a>
            </div>
            <dl className="hero-facts">
              <div><dt><Euro size={13} /> {t("Honoraires payés")}</dt><dd>{fmtEur(locale, paid)}<small>{t("HT, en {year}", { year })}</small></dd></div>
              <div><dt><Hourglass size={13} /> {t("À percevoir")}</dt><dd>{fmtEur(locale, due)}<small>{t("HT, conventions signées non payées")}</small></dd></div>
              <div><dt><FileClock size={13} /> {t("En préparation")}</dt><dd>{fmtEur(locale, preparing)}<small>{t("HT, conventions pas encore signées")}</small></dd></div>
              <div><dt><Gift size={13} /> {t("Hospitalités reçues")}</dt><dd>{fmtEur(locale, hospTotal)}<small>{t("TTC, valeur déclarée")}</small></dd></div>
              <div><dt><Building2 size={13} /> {t("Organisations")}</dt><dd>{orgs}<small>{t("partenaires cette année")}</small></dd></div>
            </dl>
            <section className="card">
              <h2>{t("Honoraires")}</h2>
              {fees.length === 0 ? <p className="muted">{t("Aucune collaboration engagée cette année.")}</p> : (
                <table className="table" tabIndex={0}>
                  <thead><tr><th>{t("Date")}</th><th>{t("Organisation")}</th><th>{t("Collaboration")}</th><th>{t("Montant HT")}</th><th>{t("Statut")}</th><th>{t("Note d'honoraires")}</th></tr></thead>
                  <tbody>
                    {fees.map((f) => (
                      <tr key={f.id}>
                        <td>{fmtDate(locale, f.date)}</td>
                        <td>{f.org.name}</td>
                        <td><Link href={`/sollicitations/${f.id}`}>{f.title}</Link><div className="text-xs muted">{t(f.type)}</div></td>
                        <td>{fmtEur(locale, f.paidCents ?? f.feeCents)}</td>
                        <td><span className={`pill ${f.paidAt ? "ok" : f.signed ? "wait" : ""}`}>{feeStatus(f)}</span></td>
                        <td><NoteCell f={f} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
            <section className="card">
              <h2>{t("Hospitalités reçues")}</h2>
              {hosp.length === 0 ? <p className="muted">{t("Aucune hospitalité cette année.")}</p> : (
                <table className="table" tabIndex={0}>
                  <thead><tr><th>{t("Date")}</th><th>{t("Organisation")}</th><th>{t("Événement")}</th><th>{t("Prestations")}</th><th>{t("Valeur TTC")}</th></tr></thead>
                  <tbody>
                    {hosp.map((h) => (
                      <tr key={h.id}>
                        <td>{fmtDate(locale, h.date)}</td>
                        <td>{h.org.name}</td>
                        <td><Link href={`/evenements/${h.eventId}`}>{h.title}</Link></td>
                        <td>{h.items.map((i) => t(i)).join(", ")}</td>
                        <td>{h.absent ? <><s className="muted">{fmtEur(locale, h.valueCents)}</s> <span className="pill">{t("Absent : non déclaré")}</span></> : fmtEur(locale, h.valueCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className="hint">{t("KolBase n'est pas un logiciel comptable : ces montants vous aident à préparer votre déclaration, vos justificatifs restent ceux des organisations.")}</p>
            </section>
          </>
        )}

        {onglet === "facturation" && (
          <>
            <section className="card stack-sm">
              <h2>{t("Notes d'honoraires")}</h2>
              <p className="muted">{t("Une note par convention signée : numérotée, établie à partir de la convention et transmise à l'organisation, qui la retrouve dans le dossier.")}</p>
              {toInvoice.length > 0 && (
                <ul className="plain stack-sm">
                  {toInvoice.map((f) => (
                    <li key={f.id} className="flex-between">
                      <span><strong>{f.title}</strong> · {f.org.name} · {fmtEur(locale, f.feeCents)} {t("HT")}</span>
                      <NoteCell f={f} />
                    </li>
                  ))}
                </ul>
              )}
              {notes.length === 0 ? <p className="muted">{t("Aucune note établie pour l'instant.")}</p> : (
                <table className="table" tabIndex={0}>
                  <thead><tr><th>{t("Numéro")}</th><th>{t("Date")}</th><th>{t("Organisation")}</th><th>{t("Collaboration")}</th><th>{t("Montant")}</th><th>{t("Paiement")}</th></tr></thead>
                  <tbody>
                    {notes.map((f) => (
                      <tr key={f.id}>
                        <td><a href={`/notes-honoraires/${f.note!.id}`}>{f.note!.number}</a></td>
                        <td>{fmtDate(locale, f.note!.issuedAt)}</td>
                        <td>{f.org.name}</td>
                        <td>{f.title}</td>
                        <td>{fmtEur(locale, f.note!.totalCents)}</td>
                        <td>{f.paidAt ? <span className="pill ok">{t("Payé le {date}", { date: fmtDate(locale, f.paidAt) })}</span> : <span className="pill wait">{t("En attente")}</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
            <section className="card stack-sm">
              <h2 id="coordonnees">{t("Coordonnées de facturation")}</h2>
              <p className="muted">{t("Reprises par vos conventions et vos notes d'honoraires. Vérifiez les mentions applicables à votre situation avec votre comptable.")}</p>
              <BillingForm current={{ billingEntity: payee?.name ?? "", billingLegalForm: payee?.legalForm ?? "", billingAddress: p.billingAddress ?? "", siret: p.siret ?? "", vatRegime: p.vatRegime, vatNumber: p.vatNumber ?? "", iban: p.iban ?? "" }} />
            </section>
          </>
        )}

        {onglet === "liens" && (
          <>
            <section className="card stack-sm">
              <div className="card-head">
                <div>
                  <h2>{t("Déclaration de liens d'intérêts")}</h2>
                  <p className="muted">{t("À présenter quand vous vous exprimez en public (congrès, formation, presse) : liens des {n} dernières années avec des entreprises du secteur. Vérifiez-la et complétez-la avec les liens noués hors de KolBase.", { n: INTEREST_YEARS })}</p>
                </div>
                <a className="btn" href="/revenus/liens-interets">{t("Télécharger la diapositive (PDF)")}</a>
              </div>
              {interests.length === 0 ? (
                <p className="notice ok">{t("Aucun lien d'intérêts connu sur la période.")}</p>
              ) : (
                <ul className="plain stack-sm interest-list">
                  {interests.map((l) => (
                    <li key={l.org}>
                      <strong>{l.org}</strong>
                      <span className="text-sm">{l.natures.join(" ; ")}</span>
                    </li>
                  ))}
                </ul>
              )}
              <details className="older">
                <summary>{t("Texte à copier")}</summary>
                <pre className="copy-block">{`${t("Liens d'intérêts")} — ${user.firstName} ${user.lastName}\n${interests.length ? interests.map((l) => `• ${l.org} : ${l.natures.join(" ; ")}`).join("\n") : t("Aucun lien d'intérêts au cours des {n} dernières années.", { n: INTEREST_YEARS })}`}</pre>
              </details>
            </section>
            <section className="card stack-sm">
              <h2>{t("Liens noués hors de KolBase")}</h2>
              {ledger.declared.length > 0 && (
                <ul className="plain stack-sm">
                  {ledger.declared.map((d) => (
                    <li key={d.id} className="flex-between">
                      <span><strong>{d.organization}</strong> · {d.nature} · {d.startYear}{d.endYear ? `–${d.endYear}` : ` – ${t("en cours")}`}</span>
                      <form action={removeDeclaredInterest}><input type="hidden" name="id" value={d.id} /><button className="link danger">{t("Retirer")}</button></form>
                    </li>
                  ))}
                </ul>
              )}
              <InterestForm />
            </section>
          </>
        )}

        {onglet === "transparence" && (
          <section className="card stack-sm">
            <p className="muted">{t("Les organisations déclarent sur la base publique Transparence Santé les conventions et avantages qui vous concernent. Vérifiez ce qui est enregistré à votre nom et signalez une erreur à l'organisation avant ou après publication.")}</p>
            {ledger.fees.filter((f) => f.signed).length + ledger.hospitality.length === 0 && <p className="muted">{t("Rien à déclarer à votre nom pour l'instant.")}</p>}
            <ul className="applications">
              {ledger.fees.filter((f) => f.signed).map((f) => (
                <li key={f.id}>
                  <div className="actions spread">
                    <strong>{t("Convention")} · {f.title}</strong>
                    <span className={`pill ${f.declared ? "ok" : "wait"}`}>{f.declared ? t("Déclarée{ref}", { ref: f.declarationRef ? ` (${f.declarationRef})` : "" }) : t("À déclarer par l'organisation")}</span>
                  </div>
                  <span className="muted">{f.org.name} · {fmtEur(locale, f.feeCents)} HT · {fmtDate(locale, f.date)}</span>
                  <ReportForm kind="convention" id={f.id} />
                </li>
              ))}
              {ledger.hospitality.map((h) => (
                <li key={h.id}>
                  <div className="actions spread">
                    <strong>{t("Avantages")} · {h.title}</strong>
                    <span className={`pill ${h.declared ? "ok" : h.absent ? "" : "wait"}`}>{h.declared ? t("Déclarée{ref}", { ref: h.declarationRef ? ` (${h.declarationRef})` : "" }) : h.absent ? t("Absent : non déclaré") : t("À déclarer par l'organisation")}</span>
                  </div>
                  <span className="muted">{h.org.name} · {h.items.map((i) => t(i)).join(", ")} · {fmtEur(locale, h.valueCents)} TTC · {fmtDate(locale, h.date)}</span>
                  <ReportForm kind="hospitalite" id={h.id} />
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </>
  );
}
