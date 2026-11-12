import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2, ExternalLink, FileSpreadsheet, Lightbulb, Newspaper, Package, Radar, Trash2, UserCheck, Users } from "lucide-react";
import { EmptyState, PageHead, SectionHead } from "@/components/UI";
import { SiteHeader } from "@/components/SiteHeader";
import { SectionNav } from "@/components/SectionNav";
import { RankedBars } from "@/components/Charts";
import { TableWrap } from "@/components/TableWrap";
import { ConfirmButton } from "@/components/ConfirmButton";
import { CompetitorForm, ProductForm, PublicImportForm, WatchPinForm } from "@/components/IntelligenceForms";
import { AutoSubmitSelect } from "@/components/AutoSubmit";
import { requireMembership } from "@/lib/orgs";
import { STATS_ROLES } from "@/lib/org-roles";
import { addonGate } from "@/lib/billing";
import { db } from "@/lib/db";
import { competitorOverview, portfolio, productOverview } from "@/lib/intelligence-data";
import { advise, suggestProduct, type AdviceTab } from "@/lib/intelligence-advice";
import { LINK_KIND_LABEL, LINK_KINDS, LOYALTY_LABEL, personKey } from "@/lib/intelligence";
import { archiveProduct, assignProduct, assignSuggestedProducts, removeCompetitor, removeImport } from "@/lib/intelligence-actions";
import { watchFor, WATCH_DAYS } from "@/lib/watch";
import { removeWatchPin } from "@/lib/watch-actions";
import { getT } from "@/lib/i18n/server";
import { fmtDate, fmtEur, intlLocale } from "@/lib/i18n";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: `${t("Intelligence")} — KolBase` };
}

const TABS = ["portefeuille", "produits", "concurrents", "veille", "sources"] as const;
const ADVICE_TONE = { danger: "error", warn: "warn", ok: "ok", info: "" } as const;
const ADVICE_CTA: Record<AdviceTab, string> = { portefeuille: "Voir les experts", produits: "Ouvrir les produits", concurrents: "Ouvrir les concurrents", sources: "Importer un fichier", opportunites: "Publier une opportunité" };
type Tab = (typeof TABS)[number];
const pct = (x: number) => `${Math.round(x * 100)} %`;

/**
 * KolBase Intelligence (option de l'abonnement) : recommandations tirées des chiffres de l'organisation, portefeuille
 * d'experts, activité par produit, déclarations publiques de ses concurrents suivis, veille des sites spécialisés et
 * fichiers Transparence Santé qu'elle a importés.
 */
export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ onglet?: string; annee?: string }> }) {
  const { t, locale } = await getT();
  const { id } = await params;
  const sp = await searchParams;
  const { org } = await requireMembership(id, STATS_ROLES);
  const gate = await addonGate(id, "intelligence");
  if (gate) redirect(gate);
  const tab: Tab = TABS.find((x) => x === sp.onglet) ?? "portefeuille";
  const now = new Date().getFullYear();
  const asked = Number(sp.annee);
  const year = Number.isInteger(asked) && asked >= 2000 && asked <= now ? asked : now;
  const base = `/organisations/${id}/intelligence`;
  const [p, c, prod, imports, watch] = await Promise.all([
    portfolio(id, year),
    competitorOverview(id, year),
    productOverview(id, year),
    db.publicImport.findMany({ where: { organizationId: id }, orderBy: { createdAt: "desc" } }),
    tab === "veille" ? watchFor(org) : null,
  ]);
  // Recommandations : règles lisibles (lib/intelligence-advice), les plus pressantes d'abord.
  const advice = advise({ year, portfolio: p, competitors: c.competitors, products: { count: prod.products.length, coverage: prod.coverage, unassigned: prod.unassigned, rows: prod.rows }, lastImportAt: imports[0]?.createdAt ?? null });
  const adviceHref = (to: AdviceTab) => (to === "opportunites" ? `/organisations/${id}/opportunites` : to === "portefeuille" ? "#experts" : `${base}?onglet=${to}${to === "sources" ? "" : `&annee=${year}`}`);
  const live = prod.products.filter((x) => !x.archivedAt);
  const suggested = prod.toAttach.filter((x) => suggestProduct(x.title, prod.products)).length;
  const years = [...new Set([...p.years, ...c.years, now])].filter((y) => y <= now).sort();
  // Bénéficiaires des concurrents qui sont aussi des experts de l'organisation (rapprochés par nom).
  const mine = new Set(p.experts.map((e) => personKey(e.name)));
  const tabs = [
    { key: "portefeuille", href: `${base}?annee=${year}`, label: t("Portefeuille d'experts") },
    { key: "produits", href: `${base}?onglet=produits&annee=${year}`, label: t("Produits"), count: live.length },
    { key: "concurrents", href: `${base}?onglet=concurrents&annee=${year}`, label: t("Concurrents"), count: c.competitors.length },
    { key: "veille", href: `${base}?onglet=veille`, label: t("Veille") },
    { key: "sources", href: `${base}?onglet=sources`, label: t("Fichiers importés") },
  ];

  return (
    <>
      <SiteHeader />
      <main className="stack">
        <p className="muted"><Link href={`/organisations/${id}/statistiques`}>{t("Statistiques")}</Link> / {t("Intelligence")}</p>
        <PageHead title={t("KolBase Intelligence")} desc={t("Vos experts, vos produits et vos concurrents suivis, avec les recommandations qui en découlent. Sources : vos dossiers, vos événements et les fichiers Transparence Santé que vous importez ; jamais les données d'une autre organisation cliente de KolBase.")} />
        <SectionNav tabs={tabs} active={tab} label={t("Rubrique Intelligence")} />
        {(tab === "portefeuille" || tab === "produits" || tab === "concurrents") && (
          <nav className="chips" aria-label={t("Année")}>
            {years.map((y) => <Link key={y} href={`${base}?${tab === "portefeuille" ? "" : `onglet=${tab}&`}annee=${y}`} className={`chip${y === year ? " active" : ""}`} aria-current={y === year ? "page" : undefined}>{y}</Link>)}
          </nav>
        )}

        {tab === "portefeuille" && (
          <>
            <section className="card stack-sm" id="recommandations">
              <SectionHead icon={Lightbulb} title={t("Recommandations")} desc={t("Tirées de vos chiffres de {year}, les plus pressantes d'abord. Chaque constat est chiffré : à vous de décider.", { year })} />
              {advice.length === 0 ? (
                <p className="muted">{t("Rien à signaler en {year} : portefeuille équilibré, produits rattachés, sources à jour.", { year })}</p>
              ) : (
                <ul className="plain stack-sm">
                  {advice.slice(0, 6).map((a) => (
                    <li key={a.key} className={`notice ${ADVICE_TONE[a.tone]} stack-xs`}>
                      <strong>{t(a.title, a.vars)}</strong>
                      <span>{t(a.detail, a.vars)}</span>
                      <Link href={adviceHref(a.tab)}>{t(ADVICE_CTA[a.tab])}</Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <dl className="hero-facts">
              <div><dt><Users size={13} />{" "}{t("Experts engagés")}</dt><dd>{p.active}<small>{t("{montant} d'honoraires (HT) en {year}", { montant: fmtEur(locale, p.total), year })}</small></dd></div>
              <div><dt><UserCheck size={13} />{" "}{t("Fidélisation")}</dt><dd>{p.retention == null ? "—" : pct(p.retention)}<small>{t("des experts de {year} encore engagés", { year: year - 1 })}</small></dd></div>
              <div><dt>{t("Nouveaux")}</dt><dd>{p.loyalty.nouveau}<small>{t("première collaboration en {year}", { year })}</small></dd></div>
              <div><dt>{t("Dormants")}</dt><dd>{p.loyalty.dormant}<small>{t("engagés en {year}, plus depuis", { year: year - 1 })}</small></dd></div>
              <div><dt><Radar size={13} />{" "}{t("Experts partagés")}</dt><dd>{p.shared}<small>{t("aussi déclarés par un concurrent suivi")}</small></dd></div>
            </dl>
            <section className="card stack-sm" id="experts">
              <SectionHead icon={Users} title={t("Experts du portefeuille")} desc={t("Engagés : proposition acceptée, à la date de leur accord (même définition que les statistiques). Liens avec vos concurrents : déclarations publiques importées, rapprochées par RPPS ou, à défaut, par nom et prénom.")} />
              {p.experts.length === 0 ? (
                <EmptyState icon={Users} compact>{t("Aucun expert engagé en {year} ni l'année précédente.", { year })}</EmptyState>
              ) : (
                <TableWrap label={t("Experts du portefeuille")}>
                  <table className="table">
                    <thead><tr><th>{t("Expert")}</th><th>{t("Place")}</th><th>{t("Honoraires {year}", { year })}</th><th>{t("Honoraires {year}", { year: year - 1 })}</th><th>{t("Liens publics avec vos concurrents en {year}", { year })}</th></tr></thead>
                    <tbody>
                      {p.experts.map((e) => (
                        <tr key={e.id}>
                          <td data-label={t("Expert")}><Link href={`/experts/${e.id}`}>{e.name}</Link>{e.specialty && <div className="text-xs muted">{t(e.specialty)}</div>}</td>
                          <td data-label={t("Place")}><span className={`pill ${e.loyalty === "dormant" ? "wait" : e.loyalty === "fidele" ? "ok" : ""}`}>{t(LOYALTY_LABEL[e.loyalty])}</span><div className="text-xs muted">{t("depuis {year}", { year: e.firstYear })}</div></td>
                          <td data-label={t("Honoraires {year}", { year })}>{e.engagements ? fmtEur(locale, e.cents) : "—"}{e.engagements > 0 && <div className="text-xs muted">{t(e.engagements > 1 ? "{n} collaborations" : "{n} collaboration", { n: e.engagements })}</div>}</td>
                          <td data-label={t("Honoraires {year}", { year: year - 1 })}>{e.previousCents ? fmtEur(locale, e.previousCents) : "—"}</td>
                          <td data-label={t("Liens publics avec vos concurrents en {year}", { year })}>{e.shared.length === 0 ? "—" : e.shared.map((s) => <div key={s.competitor}>{s.competitor} : {fmtEur(locale, s.cents)} <span className="text-xs muted">({t(s.count > 1 ? "{n} déclarations" : "{n} déclaration", { n: s.count })})</span></div>)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableWrap>
              )}
            </section>
          </>
        )}

        {tab === "produits" && (
          <>
            <dl className="hero-facts">
              <div><dt><Package size={13} />{" "}{t("Produits suivis")}</dt><dd>{live.length}<small>{t(prod.products.length - live.length > 1 ? "{n} archivés" : "{n} archivé", { n: prod.products.length - live.length })}</small></dd></div>
              <div><dt>{t("Dossiers rattachés")}</dt><dd>{prod.coverage == null ? "—" : pct(prod.coverage)}<small>{t(prod.unassigned > 1 ? "{n} dossiers de {year} sans produit" : "{n} dossier de {year} sans produit", { n: prod.unassigned, year })}</small></dd></div>
              <div><dt><UserCheck size={13} />{" "}{t("Recrute le plus")}</dt><dd>{prod.rows[0]?.recruited ? prod.rows[0].name : "—"}<small>{prod.rows[0]?.recruited ? t(prod.rows[0].recruited > 1 ? "{n} nouveaux experts en {year}" : "{n} nouvel expert en {year}", { n: prod.rows[0].recruited, year }) : t("aucun nouvel expert rattaché à un produit en {year}", { year })}</small></dd></div>
            </dl>
            {prod.products.length > 0 && (
              <>
                <div className="stats-grid">
                  <section className="card stack-sm">
                    <SectionHead icon={UserCheck} title={t("Nouveaux experts par produit")} desc={t("Experts dont la toute première collaboration avec vous date de {year}, selon le produit de ce premier dossier.", { year })} />
                    <RankedBars caption={t("Nouveaux experts recrutés par produit en {year}", { year })} format="int" empty={t("Aucun nouvel expert rattaché à un produit en {year}.", { year })} rows={prod.rows.filter((r) => r.recruited > 0).map((r) => ({ label: r.name, value: r.recruited, note: t(r.experts > 1 ? "{n} experts engagés" : "{n} expert engagé", { n: r.experts }) }))} />
                  </section>
                  <section className="card stack-sm">
                    <SectionHead icon={Users} title={t("Inscrits aux événements par produit")} desc={t("Inscriptions non annulées aux événements de {year} ; un événement suit le produit de son dossier s'il n'a pas le sien.", { year })} />
                    <RankedBars caption={t("Inscrits aux événements par produit en {year}", { year })} format="int" empty={t("Aucun événement rattaché à un produit en {year}.", { year })} rows={prod.rows.filter((r) => r.registrations > 0).sort((a, b) => b.registrations - a.registrations).map((r) => ({ label: r.name, value: r.registrations, note: t(r.events > 1 ? "{n} événements" : "{n} événement", { n: r.events }) }))} />
                  </section>
                </div>
                <section className="card stack-sm">
                  <SectionHead icon={Package} title={t("Activité par produit en {year}", { year })} desc={t("Acceptation : part des experts sollicités dans l'année qui ont accepté, parmi ceux qui ont répondu.")} />
                  <TableWrap label={t("Activité par produit en {year}", { year })}>
                    <table className="table">
                      <thead><tr><th>{t("Produit")}</th><th>{t("Experts engagés")}</th><th>{t("Honoraires {year}", { year })}</th><th>{t("Acceptation")}</th><th>{t("Événements")}</th><th></th></tr></thead>
                      <tbody>
                        {[...prod.rows, prod.none].map((r) => (
                          <tr key={r.id ?? "sans"}>
                            <td data-label={t("Produit")}>{r.id ? r.name : <em>{t("Sans produit")}</em>}{r.range && <div className="text-xs muted">{r.range}</div>}{r.archived && <>{" "}<span className="pill">{t("archivé")}</span></>}</td>
                            <td data-label={t("Experts engagés")}>{r.experts}{r.recruited > 0 && <div className="text-xs muted">{t(r.recruited > 1 ? "dont {n} nouveaux" : "dont {n} nouveau", { n: r.recruited })}</div>}</td>
                            <td data-label={t("Honoraires {year}", { year })}>{r.cents ? fmtEur(locale, r.cents) : "—"}{r.dossiers > 0 && <div className="text-xs muted">{t(r.dossiers > 1 ? "{n} dossiers" : "{n} dossier", { n: r.dossiers })}</div>}</td>
                            <td data-label={t("Acceptation")}>{r.accepted + r.declined > 0 ? pct(r.accepted / (r.accepted + r.declined)) : "—"}{r.accepted + r.declined > 0 && <div className="text-xs muted">{t("{accepted} sur {answered} réponses", { accepted: r.accepted, answered: r.accepted + r.declined })}</div>}</td>
                            <td data-label={t("Événements")}>{r.events || "—"}{r.events > 0 && <div className="text-xs muted">{t(r.registrations > 1 ? "{n} inscrits" : "{n} inscrit", { n: r.registrations })}</div>}</td>
                            <td>
                              {r.id && (
                                <form action={archiveProduct}>
                                  <input type="hidden" name="orgId" value={id} />
                                  <input type="hidden" name="productId" value={r.id} />
                                  <button className="link">{r.archived ? t("remettre en service") : t("archiver")}</button>
                                </form>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </TableWrap>
                </section>
              </>
            )}
            {live.length > 0 && prod.toAttach.length > 0 && (
              <section className="card stack-sm" id="a-rattacher">
                <div className="actions spread">
                  <SectionHead icon={Package} title={t("À rattacher à un produit")} desc={t("Dossiers engagés et événements de {year} sans produit. Le produit proposé est celui que le titre nomme.", { year })} />
                  {suggested > 0 && (
                    <form action={assignSuggestedProducts}>
                      <input type="hidden" name="orgId" value={id} />
                      <input type="hidden" name="year" value={year} />
                      <button className="btn small">{t(suggested > 1 ? "Rattacher les {n} propositions" : "Rattacher la proposition", { n: suggested })}</button>
                    </form>
                  )}
                </div>
                <ul className="plain stack-sm">
                  {prod.toAttach.map((x) => {
                    const guess = suggestProduct(x.title, prod.products);
                    return (
                      <li key={`${x.kind}:${x.id}`} className="actions spread">
                        <span><Link href={`/organisations/${id}/${x.kind === "project" ? "dossiers" : "evenements"}/${x.id}`}>{x.title}</Link> <span className="text-xs muted">· {x.kind === "project" ? t("dossier") : t("événement")}{guess ? ` · ${t("proposé : {name}", { name: guess.name })}` : ""}</span></span>
                        <form action={assignProduct} className="inline">
                          <input type="hidden" name="orgId" value={id} />
                          <input type="hidden" name="kind" value={x.kind} />
                          <input type="hidden" name="id" value={x.id} />
                          <AutoSubmitSelect name="productId" defaultValue="" aria-label={t("Produit de « {title} »", { title: x.title })}>
                            <option value="">{t("— choisir un produit —")}</option>
                            {live.map((pr) => <option key={pr.id} value={pr.id}>{pr.name}</option>)}
                          </AutoSubmitSelect>
                          <noscript><button className="btn small secondary">{t("Rattacher")}</button></noscript>
                        </form>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
            <section className="card stack-sm">
              <SectionHead icon={Package} title={t("Ajouter un produit")} desc={t("Un produit ou une gamme, tel que vos équipes le nomment. Vos dossiers et vos événements s'y rattachent ensuite ; un événement suit le produit de son dossier.")} />
              <ProductForm orgId={id} />
            </section>
          </>
        )}

        {tab === "concurrents" && (
          <>
            {c.competitors.length > 0 && (
              <section className="card stack-sm">
                <SectionHead icon={Radar} title={t("Montants déclarés en {year}", { year })} desc={t("Conventions, rémunérations et avantages publiés par chaque concurrent suivi, d'après vos fichiers importés.")} />
                <RankedBars caption={t("Montants déclarés par concurrent en {year}", { year })} format="eur" empty={t("Aucune déclaration importée pour {year}.", { year })} rows={c.competitors.filter((x) => x.year.lines > 0).sort((a, b) => b.year.cents - a.year.cents).map((x) => ({ label: x.name, value: x.year.cents, note: t(x.year.beneficiaries > 1 ? "{n} bénéficiaires" : "{n} bénéficiaire", { n: x.year.beneficiaries }) }))} />
              </section>
            )}
            {c.competitors.map((x) => (
              <section key={x.id} className="card stack-sm">
                <div className="actions spread">
                  <div>
                    <h2>{x.name}</h2>
                    {x.aliases.length > 0 && <p className="muted">{t("Autres écritures : {list}", { list: x.aliases.join(", ") })}</p>}
                  </div>
                  <form action={removeCompetitor}>
                    <input type="hidden" name="orgId" value={id} />
                    <input type="hidden" name="competitorId" value={x.id} />
                    <ConfirmButton className="btn ghost small" confirm={t("ne plus suivre {name}", { name: x.name })} summary={t("Ses {n} déclarations importées sont effacées.", { n: x.lines })} localized><Trash2 size={14} /> {t("Ne plus suivre")}</ConfirmButton>
                  </form>
                </div>
                {x.year.lines === 0 ? (
                  <p className="muted">{x.lines === 0 ? t("Aucune déclaration importée pour ce concurrent : déposez un export Transparence Santé dans « Fichiers importés ».") : t("Aucune déclaration datée de {year} dans vos fichiers importés.", { year })}</p>
                ) : (
                  <>
                    <dl className="hero-facts">
                      <div><dt>{t("Montant déclaré")}</dt><dd>{fmtEur(locale, x.year.cents)}<small>{x.previousCents > 0 ? t("{v}{pct} par rapport à {v2}", { v: x.year.cents >= x.previousCents ? "+" : "−", pct: pct(Math.abs(x.year.cents - x.previousCents) / x.previousCents), v2: year - 1 }) : t("en {year}", { year })}</small></dd></div>
                      <div><dt>{t("Bénéficiaires")}</dt><dd>{x.year.beneficiaries}<small>{t(x.year.lines > 1 ? "{n} déclarations" : "{n} déclaration", { n: x.year.lines })}</small></dd></div>
                      {LINK_KINDS.map((k) => <div key={k}><dt>{t(LINK_KIND_LABEL[k])}</dt><dd>{fmtEur(locale, x.year.byKind[k].cents)}<small>{t(x.year.byKind[k].lines > 1 ? "{n} déclarations" : "{n} déclaration", { n: x.year.byKind[k].lines })}</small></dd></div>)}
                    </dl>
                    <div className="stats-grid">
                      {x.categories.length > 0 && <RankedBars caption={t("Montants par catégorie de bénéficiaire")} format="eur" rows={x.categories.map((r) => ({ label: r.label, value: r.cents, note: t(r.lines > 1 ? "{n} déclarations" : "{n} déclaration", { n: r.lines }) }))} />}
                      {x.purposes.length > 0 && <RankedBars caption={t("Montants par objet déclaré")} format="eur" rows={x.purposes.map((r) => ({ label: r.label, value: r.cents, note: t(r.lines > 1 ? "{n} déclarations" : "{n} déclaration", { n: r.lines }) }))} />}
                    </div>
                    {x.top.length > 0 && (
                      <TableWrap label={t("Premiers bénéficiaires déclarés par {name}", { name: x.name })}>
                        <table className="table">
                          <thead><tr><th>{t("Premiers bénéficiaires déclarés")}</th><th>{t("Montant déclaré")}</th><th>{t("Déclarations")}</th></tr></thead>
                          <tbody>
                            {x.top.map((b) => (
                              <tr key={b.name}>
                                <td data-label={t("Bénéficiaire")}>{b.name}{mine.has(personKey(b.name)) && <>{" "}<span className="pill ok">{t("dans votre portefeuille")}</span></>}</td>
                                <td data-label={t("Montant déclaré")}>{fmtEur(locale, b.cents)}</td>
                                <td data-label={t("Déclarations")}>{b.lines}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </TableWrap>
                    )}
                  </>
                )}
              </section>
            ))}
            <section className="card stack-sm">
              <SectionHead icon={Building2} title={t("Suivre un concurrent")} desc={t("Vingt concurrents au plus. Seules leurs déclarations sont conservées lors d'un import.")} />
              <CompetitorForm orgId={id} />
            </section>
          </>
        )}

        {tab === "veille" && watch && (
          <>
            <section className="card stack-sm">
              <SectionHead icon={Newspaper} title={t("Publications des {n} derniers jours", { n: WATCH_DAYS })} desc={t("Publications des sites spécialisés relevés par KolBase qui citent l'un de vos concurrents suivis ou votre organisation, et publications que vous avez ajoutées. Titre, date et court extrait : l'article se lit sur le site d'origine.")} />
              {watch.competitors === 0 && <p className="notice warn">{t("Vous ne suivez aucun concurrent : seules les publications qui citent votre organisation apparaissent.")} <Link href={`${base}?onglet=concurrents`}>{t("Suivre un concurrent")}</Link></p>}
              {watch.hits.length === 0 ? (
                <EmptyState icon={Newspaper} compact>{watch.sources.length === 0 ? t("Aucune source n'est encore relevée par KolBase : ajoutez vos propres publications ci-dessous.") : t("Aucune publication ne cite vos concurrents suivis ni votre organisation sur la période.")}</EmptyState>
              ) : (
                <ul className="plain stack-sm">
                  {watch.hits.map((h) => (
                    <li key={h.id} className="stack-xs">
                      <div className="actions spread">
                        <a href={h.url} target="_blank" rel="noopener noreferrer nofollow"><strong>{h.title}</strong> <ExternalLink size={13} aria-hidden /></a>
                        {h.manual && (
                          <form action={removeWatchPin}>
                            <input type="hidden" name="orgId" value={id} />
                            <input type="hidden" name="itemId" value={h.id} />
                            <button className="link">{t("retirer")}</button>
                          </form>
                        )}
                      </div>
                      <div className="text-xs muted">{fmtDate(locale, h.publishedAt)} · {h.manual ? t("ajoutée par votre équipe") : h.source}{" "}{h.about.map((a) => <span key={a} className="pill wait">{a}</span>)}{h.own && <span className="pill ok">{t("votre organisation")}</span>}</div>
                      {h.summary && <p className="text-sm muted">{h.summary}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="card stack-sm">
              <SectionHead icon={Radar} title={t("Ajouter une publication")} desc={t("Publication d'un réseau social (LinkedIn, Instagram…) ou article hors des sources relevées : elle n'est visible que de votre organisation. Les réseaux sociaux n'autorisent pas la collecte automatisée de leurs publications.")} />
              <WatchPinForm orgId={id} />
            </section>
            <section className="card stack-sm">
              <SectionHead icon={Newspaper} title={t("Sources relevées par KolBase")} desc={t("Relevées toutes les six heures. Une source vous manque ? Écrivez-nous depuis la page d'aide.")} />
              {watch.sources.length === 0 ? <p className="muted">{t("Aucune source pour l'instant.")}</p> : <p>{watch.sources.map((s) => s.name).join(" · ")}</p>}
            </section>
          </>
        )}

        {tab === "sources" && (
          <>
            <section className="card stack-sm">
              <SectionHead icon={FileSpreadsheet} title={t("Importer un fichier Transparence Santé")} desc={t("Sur transparence.sante.gouv.fr, filtrez les déclarations (entreprise, année), exportez-les en CSV ou en Excel, puis déposez le fichier ici. Seules les lignes de vos concurrents suivis sont conservées, dans l'espace de votre organisation.")} />
              <p className="notice">{t("La réutilisation de la base Transparence Santé est encadrée par sa licence et par l'article L.1453-1 du code de la santé publique (finalité de transparence des liens d'intérêts) : votre organisation en est responsable pour les fichiers qu'elle dépose. Les entreprises déclarantes répondent de l'exactitude des données publiées.")}</p>
              {c.competitors.length === 0 ? <p className="notice warn">{t("Ajoutez d'abord au moins un concurrent à suivre : seules ses déclarations sont conservées.")} <Link href={`${base}?onglet=concurrents`}>{t("Suivre un concurrent")}</Link></p> : <PublicImportForm orgId={id} />}
            </section>
            <section className="card stack-sm">
              <SectionHead icon={FileSpreadsheet} title={t("Fichiers importés")} />
              {imports.length === 0 ? (
                <EmptyState icon={FileSpreadsheet} compact>{t("Aucun fichier importé pour l'instant.")}</EmptyState>
              ) : (
                <TableWrap label={t("Fichiers importés")}>
                  <table className="table">
                    <thead><tr><th>{t("Fichier")}</th><th>{t("Importé le")}</th><th>{t("Lignes lues")}</th><th>{t("Lignes conservées")}</th><th></th></tr></thead>
                    <tbody>
                      {imports.map((i) => (
                        <tr key={i.id}>
                          <td data-label={t("Fichier")}>{i.fileName}</td>
                          <td data-label={t("Importé le")}>{fmtDate(locale, i.createdAt)}</td>
                          <td data-label={t("Lignes lues")}>{i.rows.toLocaleString(intlLocale(locale))}</td>
                          <td data-label={t("Lignes conservées")}>{i.kept.toLocaleString(intlLocale(locale))}</td>
                          <td>
                            <form action={removeImport}>
                              <input type="hidden" name="orgId" value={id} />
                              <input type="hidden" name="importId" value={i.id} />
                              <ConfirmButton className="link" confirm={t("retirer cet import")} summary={t("Ses {n} lignes sont effacées.", { n: i.kept })} localized>{t("retirer")}</ConfirmButton>
                            </form>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableWrap>
              )}
            </section>
          </>
        )}
      </main>
    </>
  );
}
