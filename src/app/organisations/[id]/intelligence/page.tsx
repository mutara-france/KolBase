import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2, FileSpreadsheet, Radar, Trash2, UserCheck, Users } from "lucide-react";
import { EmptyState, PageHead, SectionHead } from "@/components/UI";
import { SiteHeader } from "@/components/SiteHeader";
import { SectionNav } from "@/components/SectionNav";
import { RankedBars } from "@/components/Charts";
import { TableWrap } from "@/components/TableWrap";
import { ConfirmButton } from "@/components/ConfirmButton";
import { CompetitorForm, PublicImportForm } from "@/components/IntelligenceForms";
import { requireMembership } from "@/lib/orgs";
import { STATS_ROLES } from "@/lib/org-roles";
import { addonGate } from "@/lib/billing";
import { db } from "@/lib/db";
import { competitorOverview, portfolio } from "@/lib/intelligence-data";
import { LINK_KIND_LABEL, LINK_KINDS, LOYALTY_LABEL, personKey } from "@/lib/intelligence";
import { removeCompetitor, removeImport } from "@/lib/intelligence-actions";
import { getT } from "@/lib/i18n/server";
import { fmtDate, fmtEur, intlLocale } from "@/lib/i18n";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: `${t("Intelligence")} — KolBase` };
}

const TABS = ["portefeuille", "concurrents", "sources"] as const;
type Tab = (typeof TABS)[number];
const pct = (x: number) => `${Math.round(x * 100)} %`;

/**
 * KolBase Intelligence (option de l'abonnement) : portefeuille d'experts de l'organisation, déclarations publiques de
 * ses concurrents suivis et fichiers Transparence Santé qu'elle a importés.
 */
export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ onglet?: string; annee?: string }> }) {
  const { t, locale } = await getT();
  const { id } = await params;
  const sp = await searchParams;
  await requireMembership(id, STATS_ROLES);
  const gate = await addonGate(id, "intelligence");
  if (gate) redirect(gate);
  const tab: Tab = TABS.find((x) => x === sp.onglet) ?? "portefeuille";
  const now = new Date().getFullYear();
  const asked = Number(sp.annee);
  const year = Number.isInteger(asked) && asked >= 2000 && asked <= now ? asked : now;
  const base = `/organisations/${id}/intelligence`;
  const [p, c, imports] = await Promise.all([
    portfolio(id, year),
    competitorOverview(id, year),
    tab === "sources" ? db.publicImport.findMany({ where: { organizationId: id }, orderBy: { createdAt: "desc" } }) : [],
  ]);
  const years = [...new Set([...p.years, ...c.years, now])].filter((y) => y <= now).sort();
  // Bénéficiaires des concurrents qui sont aussi des experts de l'organisation (rapprochés par nom).
  const mine = new Set(p.experts.map((e) => personKey(e.name)));
  const tabs = [
    { key: "portefeuille", href: `${base}?annee=${year}`, label: t("Portefeuille d'experts") },
    { key: "concurrents", href: `${base}?onglet=concurrents&annee=${year}`, label: t("Concurrents"), count: c.competitors.length },
    { key: "sources", href: `${base}?onglet=sources`, label: t("Fichiers importés") },
  ];

  return (
    <>
      <SiteHeader />
      <main className="stack">
        <p className="muted"><Link href={`/organisations/${id}/statistiques`}>{t("Statistiques")}</Link> / {t("Intelligence")}</p>
        <PageHead title={t("KolBase Intelligence")} desc={t("Votre portefeuille d'experts et les déclarations publiques de vos concurrents suivis. Sources : vos dossiers et les fichiers Transparence Santé que vous importez ; jamais les données d'une autre organisation cliente de KolBase.")} />
        <SectionNav tabs={tabs} active={tab} label={t("Rubrique Intelligence")} />
        {tab !== "sources" && (
          <nav className="chips" aria-label={t("Année")}>
            {years.map((y) => <Link key={y} href={`${base}?${tab === "concurrents" ? "onglet=concurrents&" : ""}annee=${y}`} className={`chip${y === year ? " active" : ""}`} aria-current={y === year ? "page" : undefined}>{y}</Link>)}
          </nav>
        )}

        {tab === "portefeuille" && (
          <>
            <dl className="hero-facts">
              <div><dt><Users size={13} />{" "}{t("Experts engagés")}</dt><dd>{p.active}<small>{t("{montant} d'honoraires (HT) en {year}", { montant: fmtEur(locale, p.total), year })}</small></dd></div>
              <div><dt><UserCheck size={13} />{" "}{t("Fidélisation")}</dt><dd>{p.retention == null ? "—" : pct(p.retention)}<small>{t("des experts de {year} encore engagés", { year: year - 1 })}</small></dd></div>
              <div><dt>{t("Nouveaux")}</dt><dd>{p.loyalty.nouveau}<small>{t("première collaboration en {year}", { year })}</small></dd></div>
              <div><dt>{t("Dormants")}</dt><dd>{p.loyalty.dormant}<small>{t("engagés en {year}, plus depuis", { year: year - 1 })}</small></dd></div>
              <div><dt><Radar size={13} />{" "}{t("Experts partagés")}</dt><dd>{p.shared}<small>{t("aussi déclarés par un concurrent suivi")}</small></dd></div>
            </dl>
            <section className="card stack-sm">
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
