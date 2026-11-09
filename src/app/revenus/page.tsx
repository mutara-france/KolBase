import { SectionHead, PageHead } from "@/components/UI";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2, Euro, FileClock, FileText, Gift, Hourglass, Landmark, Link2, Plus, Presentation } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { TableWrap } from "@/components/TableWrap";
import { BillingForm, DefaultPayeeForm, InterestForm, IssueNoteButton, ReportForm } from "@/components/RevenueForms";
import { billingComplete } from "@/lib/fee-notes";
import { requireUser } from "@/lib/auth";
import { INTEREST_YEARS, interestLines, practitionerLedger } from "@/lib/revenues";
import { removeDeclaredInterest } from "@/lib/revenue-actions";
import { statusLabel } from "@/lib/projects";
import { feeTotals } from "@/lib/indicators";
import { canBeExpert } from "@/lib/professions";
import { fmtDate, fmtEur } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import { practitionerStructures } from "@/lib/expert-billing";
import { choiceValue, linkPayee, payeeEntity } from "@/lib/structures";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: `${t("Mes revenus")} — KolBase` };
}

export default async function Page({ searchParams }: { searchParams: Promise<{ onglet?: string; annee?: string }> }) {
  const user = await requireUser();
  const p = user.practitioner;
  if (!p) redirect("/tableau-de-bord");
  // Réservé aux professions qui peuvent être expertes (comme le menu) : sinon, retour à l'accueil avec un message.
  if (!canBeExpert(p.profession) && !p.listed) redirect("/tableau-de-bord?acces=revenus");
  const sp = await searchParams;
  const onglet = sp.onglet === "liens" ? "liens" : sp.onglet === "transparence" ? "transparence" : sp.onglet === "facturation" ? "facturation" : "revenus";
  const { t, locale } = await getT();
  const ledger = await practitionerLedger(user.id, p.id);
  // Structures du praticien : chaque convention est facturée en son nom propre ou au nom de l'une d'elles.
  const structures = await practitionerStructures(p.id);
  const years = [...new Set([...ledger.fees.map((f) => f.year), ...ledger.hospitality.map((h) => h.year), new Date().getFullYear()])].sort((a, b) => b - a);
  const year = years.includes(Number(sp.annee)) ? Number(sp.annee) : years[0];
  const fees = ledger.fees.filter((f) => f.year === year);
  const hosp = ledger.hospitality.filter((h) => h.year === year);
  // À percevoir : convention signée, pas encore payée ; en préparation : le reste (pas encore dû).
  const { paid, due, preparing } = feeTotals(fees);
  const hospTotal = hosp.filter((h) => !h.absent).reduce((s, h) => s + h.valueCents, 0);
  // Organisations : celles qui ont versé des honoraires ou accordé une hospitalité consommée (absents exclus, comme le total).
  const orgs = new Set([...fees.map((f) => f.org.id), ...hosp.filter((h) => !h.absent).map((h) => h.org.id)]).size;
  const interests = interestLines(ledger, t);
  const tabs = [["revenus", t("Honoraires et avantages")], ["facturation", t("Notes d'honoraires")], ["liens", t("Liens d'intérêts")], ["transparence", t("Transparence Santé")]] as const;
  // Au nom de qui chaque convention est facturée, et si les coordonnées de ce nom sont complètes.
  const payeeOf = (f: (typeof ledger.fees)[number]) => linkPayee(f.billing, structures);
  const billingOk = (f: (typeof ledger.fees)[number]) => billingComplete(payeeOf(f) ?? p);
  const payeeLabel = (f: (typeof ledger.fees)[number]) => {
    const s = payeeOf(f);
    return s ? t("au nom de {name}", { name: payeeEntity(s)! }) : t("en votre nom propre");
  };
  // Comptes de facturation : le nom propre, puis chaque structure (la structure par défaut en tête).
  const coordsOf = (c: { billingAddress: string | null; siret: string | null; vatRegime: string; vatNumber: string | null; iban: string | null }) =>
    ({ billingAddress: c.billingAddress ?? "", siret: c.siret ?? "", vatRegime: c.vatRegime, vatNumber: c.vatNumber ?? "", iban: c.iban ?? "" });
  const defaultPayee = structures.find((x) => x.isPayee) ?? null;
  const accounts = [
    { key: "self", label: t("En votre nom propre"), structure: null, isDefault: !defaultPayee, complete: billingComplete(p), coords: coordsOf(p) },
    ...structures.map((x) => ({ key: x.id, label: payeeEntity(x)!, structure: { name: x.name, legalForm: x.legalForm }, isDefault: x.isPayee, complete: billingComplete(x), coords: coordsOf(x) })),
  ];
  const payeeOptions = [{ value: "self", label: t("En mon nom propre") }, ...structures.map((x) => ({ value: x.id, label: t("Au nom de {name}", { name: payeeEntity(x)! }) }))];
  const notes = ledger.fees.filter((f) => f.note).sort((a, b) => b.note!.issuedAt.getTime() - a.note!.issuedAt.getTime());
  const toInvoice = ledger.fees.filter((f) => f.signed && !f.note && f.feeCents > 0);
  const NoteCell = ({ f }: { f: (typeof ledger.fees)[number] }) =>
    f.note ? <a href={`/notes-honoraires/${f.note.id}`}>{f.note.number}</a>
      : !f.signed || !f.feeCents ? <span className="muted">—</span>
      : billingOk(f) ? <IssueNoteButton linkId={f.id} />
      : <Link className="text-xs" href={`?onglet=facturation#facturation-${choiceValue(payeeOf(f))}`}>{t("Compléter la facturation")}</Link>;
  const feeStatus = (f: (typeof ledger.fees)[number]) =>
    f.paidAt ? t("Payé le {date}", { date: fmtDate(locale, f.paidAt) }) : f.signed ? t("Convention signée, paiement à venir") : t(statusLabel(f.status, "expert"));

  return (
    <>
      <SiteHeader />
      <main className="stack">
        <PageHead title={t("Mes revenus")} desc={t("Vos honoraires, les avantages reçus et vos liens d'intérêts, tels que KolBase les connaît. Visible de vous seul.")} />
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
              <div><dt><Building2 size={13} /> {t(orgs > 1 ? "Organisations" : "Organisation")}</dt><dd>{orgs}<small>{t(orgs > 1 ? "partenaires cette année" : "partenaire cette année")}</small></dd></div>
            </dl>
            <section className="card">
              <SectionHead icon={Euro} title={t("Honoraires")} />
              {fees.length === 0 ? <p className="muted">{t("Aucune collaboration engagée cette année.")}</p> : (
                <TableWrap label={t("Honoraires")}>
                  <table className="table">
                    <thead><tr><th>{t("Date")}</th><th>{t("Collaboration")}</th><th>{t("Organisation")}</th><th className="num">{t("Montant HT")}</th><th>{t("Statut")}</th><th>{t("Note d'honoraires")}</th></tr></thead>
                    <tbody>
                      {fees.map((f) => (
                        <tr key={f.id}>
                          <td className="nowrap" data-label={t("Date")}>{fmtDate(locale, f.date)}</td>
                          <td data-label={t("Collaboration")}><Link href={`/sollicitations/${f.id}`}>{f.title}</Link><div className="text-xs muted">{t(f.type)}{payeeOf(f) ? ` · ${payeeLabel(f)}` : ""}{f.expensesCents > 0 ? ` · ${t("frais remboursés : {montant} TTC", { montant: fmtEur(locale, f.expensesCents) })}` : ""}</div></td>
                          <td data-label={t("Organisation")}>{f.org.name}</td>
                          <td className="num" data-label={t("Montant HT")}>{fmtEur(locale, f.paidCents ?? f.feeCents)}</td>
                          <td data-label={t("Statut")}><span className={`pill ${f.paidAt ? "ok" : f.signed ? "wait" : ""}`}>{feeStatus(f)}</span></td>
                          <td data-label={t("Note d'honoraires")}><NoteCell f={f} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableWrap>
              )}
            </section>
            <section className="card">
              <SectionHead icon={Gift} title={t("Hospitalités reçues")} />
              {hosp.length === 0 ? <p className="muted">{t("Aucune hospitalité cette année.")}</p> : (
                <TableWrap label={t("Hospitalités reçues")}>
                  <table className="table">
                    <thead><tr><th>{t("Date")}</th><th>{t("Événement")}</th><th>{t("Organisation")}</th><th>{t("Prestations")}</th><th className="num">{t("Valeur TTC")}</th></tr></thead>
                    <tbody>
                      {hosp.map((h) => (
                        <tr key={h.id}>
                          <td className="nowrap" data-label={t("Date")}>{fmtDate(locale, h.date)}</td>
                          <td data-label={t("Événement")}><Link href={`/evenements/${h.eventId}`}>{h.title}</Link></td>
                          <td data-label={t("Organisation")}>{h.org.name}</td>
                          <td data-label={t("Prestations")}>{h.items.map((i) => t(i)).join(", ")}</td>
                          <td className="num" data-label={t("Valeur TTC")}>{h.absent ? <><s className="muted">{fmtEur(locale, h.valueCents)}</s> <span className="pill">{t("Absent : non déclaré")}</span></> : fmtEur(locale, h.valueCents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableWrap>
              )}
              <p className="hint">{t("KolBase n'est pas un logiciel comptable : ces montants vous aident à préparer votre déclaration, vos justificatifs restent ceux des organisations.")}</p>
            </section>
          </>
        )}

        {onglet === "facturation" && (
          <>
            <section className="card stack-sm">
              <SectionHead icon={FileText} title={t("Notes d'honoraires")} desc={t("Une note par convention signée : numérotée, établie à partir de la convention et transmise à l'organisation, qui la retrouve dans le dossier.")} />
              {toInvoice.length > 0 && (
                <>
                  <h3 className="section-title">{t("À établir")}</h3>
                  <ul className="pub-list">
                    {toInvoice.map((f) => (
                      <li key={f.id} className="flex-between">
                        <span className="grow">
                          <strong>{f.title}</strong>
                          <span className="text-xs muted"> · {f.org.name} · {fmtEur(locale, f.feeCents)} {t("HT")} · {payeeLabel(f)}</span>
                        </span>
                        <NoteCell f={f} />
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {notes.length === 0 ? <p className="muted">{t("Aucune note établie pour l'instant.")}</p> : (
                <TableWrap label={t("Notes d'honoraires")}>
                  <table className="table">
                    <thead><tr><th>{t("Numéro")}</th><th>{t("Date")}</th><th>{t("Collaboration")}</th><th>{t("Organisation")}</th><th className="num">{t("Montant")}</th><th>{t("Paiement")}</th></tr></thead>
                    <tbody>
                      {notes.map((f) => (
                        <tr key={f.id}>
                          <td className="nowrap" data-label={t("Numéro")}><a href={`/notes-honoraires/${f.note!.id}`}>{f.note!.number}</a></td>
                          <td className="nowrap" data-label={t("Date")}>{fmtDate(locale, f.note!.issuedAt)}</td>
                          <td data-label={t("Collaboration")}>{f.title}</td>
                          <td data-label={t("Organisation")}>{f.org.name}</td>
                          <td className="num" data-label={t("Montant")}>{fmtEur(locale, f.note!.totalCents)}</td>
                          <td data-label={t("Paiement")}>{f.paidAt ? <span className="pill ok">{t("Payé le {date}", { date: fmtDate(locale, f.paidAt) })}</span> : <span className="pill wait">{t("En attente")}</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableWrap>
              )}
            </section>
            <section className="card stack-sm">
              <SectionHead icon={Landmark} id="coordonnees" title={t("Coordonnées de facturation")} desc={t("Facturez chaque convention en votre nom propre ou au nom de l'une de vos structures (cabinet, société d'exercice, association) : ses coordonnées sont reprises par la convention et la note d'honoraires. Vérifiez les mentions applicables à votre situation avec votre comptable.")} />
              {structures.length > 0 && <DefaultPayeeForm options={payeeOptions} current={choiceValue(defaultPayee)} />}
              {structures.length > 0 && <p className="hint">{t("Proposé pour chaque nouvelle convention ; vous le changez convention par convention, dans « Documents et convention », jusqu'à la soumission du dossier à la conformité.")}</p>}
              <div className="billing-accounts">
                {accounts.map((a) => (
                  // Ouvert : le compte par défaut à compléter, ou le seul compte. Un compte qui ne sert pas peut rester vide.
                  <details key={a.key} id={`facturation-${a.key}`} className="billing-account" open={(a.isDefault && !a.complete) || accounts.length === 1}>
                    <summary>
                      <strong>{a.label}</strong>
                      {a.isDefault && structures.length > 0 && <span className="pill">{t("par défaut")}</span>}
                      <span className={`pill ${a.complete ? "ok" : a.isDefault ? "wait" : ""}`}>{a.complete ? t("Coordonnées complètes") : a.isDefault ? t("À compléter") : t("Non renseignées")}</span>
                    </summary>
                    <BillingForm target={a.key} structure={a.structure} current={a.coords} />
                  </details>
                ))}
                <details id="facturation-new" className="billing-account">
                  <summary><Plus size={16} aria-hidden /><strong>{t("Ajouter une structure de facturation")}</strong><span className="text-xs muted">{t("Cabinet, société d'exercice, association…")}</span></summary>
                  <BillingForm target="new" structure={{ name: "", legalForm: "SELARL" }} current={{ billingAddress: "", siret: "", vatRegime: "franchise", vatNumber: "", iban: "" }} />
                </details>
              </div>
            </section>
          </>
        )}

        {onglet === "liens" && (
          <>
            <section className="card stack-sm">
              <SectionHead icon={Presentation} title={t("Déclaration de liens d'intérêts")} desc={t("À présenter quand vous vous exprimez en public (congrès, formation, presse) : liens des {n} dernières années avec des entreprises du secteur. Vérifiez-la et complétez-la avec les liens noués hors de KolBase.", { n: INTEREST_YEARS })}>
                <a className="btn small" href="/revenus/liens-interets">{t("Télécharger la diapositive (PDF)")}</a>
              </SectionHead>
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
              <SectionHead icon={Link2} title={t("Liens noués hors de KolBase")} />
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
                  <span className="muted">{f.org.name} · {fmtEur(locale, f.feeCents)} {t("HT")} · {fmtDate(locale, f.date)}</span>
                  <ReportForm kind="convention" id={f.id} />
                </li>
              ))}
              {ledger.hospitality.map((h) => (
                <li key={h.id}>
                  <div className="actions spread">
                    <strong>{t("Avantages")} · {h.title}</strong>
                    <span className={`pill ${h.declared ? "ok" : h.absent ? "" : "wait"}`}>{h.declared ? t("Déclarée{ref}", { ref: h.declarationRef ? ` (${h.declarationRef})` : "" }) : h.absent ? t("Absent : non déclaré") : t("À déclarer par l'organisation")}</span>
                  </div>
                  <span className="muted">{h.org.name} · {h.items.map((i) => t(i)).join(", ")} · {fmtEur(locale, h.valueCents)} {t("TTC")} · {fmtDate(locale, h.date)}</span>
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
