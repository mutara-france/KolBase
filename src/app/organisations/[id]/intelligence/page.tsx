import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2, ExternalLink, Lightbulb, Newspaper, Package, Radar, Scale, ShieldAlert, Trash2, TrendingUp, UserCheck, UserPlus, Users, Wallet } from "lucide-react";
import { EmptyState, PageHead, SectionHead } from "@/components/UI";
import { SiteHeader } from "@/components/SiteHeader";
import { SectionNav } from "@/components/SectionNav";
import { RankedBars } from "@/components/Charts";
import { TableWrap } from "@/components/TableWrap";
import { ConfirmButton } from "@/components/ConfirmButton";
import { CompetitorForm, MarketNamesForm, ProductForm, WatchPinForm } from "@/components/IntelligenceForms";
import { AutoSubmitSelect } from "@/components/AutoSubmit";
import { requireMembership } from "@/lib/orgs";
import { STATS_ROLES } from "@/lib/org-roles";
import { addonGate } from "@/lib/billing";
import { portfolio, productOverview } from "@/lib/intelligence-data";
import { comparison } from "@/lib/market-data";
import { marketAdvice, type ProtectReason } from "@/lib/market-advice";
import { advise, FAMILY_LABEL, suggestProduct, type AdviceTab } from "@/lib/intelligence-advice";
import { LOYALTY_LABEL } from "@/lib/intelligence";
import type { Share } from "@/lib/market";
import { archiveProduct, assignProduct, assignSuggestedProducts, removeCompetitor } from "@/lib/intelligence-actions";
import { watchFor, WATCH_DAYS } from "@/lib/watch";
import { removeWatchPin } from "@/lib/watch-actions";
import { getT } from "@/lib/i18n/server";
import { fmtDate, fmtEur } from "@/lib/i18n";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: `${t("Intelligence")} — KolBase` };
}

const TABS = ["comparaison", "experts", "produits", "veille", "organisations"] as const;
const ADVICE_TONE = { danger: "error", warn: "warn", ok: "ok", info: "" } as const;
const ADVICE_CTA: Record<AdviceTab, string> = { comparaison: "Voir la comparaison", experts: "Voir les experts", produits: "Ouvrir les produits", organisations: "Régler ma comparaison", opportunites: "Publier une opportunité" };
const PROTECT_LABEL: Record<ProtectReason, string> = { depasse: "Une autre entreprise verse plus que vous", hausse: "Montants des autres en nette hausse", compare: "Aussi chez une organisation comparée" };
type Tab = (typeof TABS)[number];
// Espace insécable : un pourcentage ne se coupe pas en deux lignes dans une colonne étroite.
const pct = (x: number) => `${Math.round(x * 100)}\u00a0%`;
/** Évolution d'une année sur l'autre (« +12 % », « −8 % ») ; null sans point de départ. */
const delta = (now: number, before: number) => (before > 0 ? `${now >= before ? "+" : "−"}${Math.round((Math.abs(now - before) / before) * 100)}\u00a0%` : null);

/**
 * KolBase Intelligence (option de l'abonnement) : tableau de bord comparatif et moteur de recommandation.
 * L'organisation est comparée au marché, à des organisations équivalentes et à celles qu'elle choisit, d'après la base
 * publique Transparence Santé tenue par l'équipe KolBase ; ses propres dossiers, événements et produits complètent
 * la lecture. Les recommandations disent qui protéger, qui recruter et où mettre le budget.
 */
export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ onglet?: string; annee?: string }> }) {
  const { t, locale } = await getT();
  const { id } = await params;
  const sp = await searchParams;
  const { org } = await requireMembership(id, STATS_ROLES);
  const gate = await addonGate(id, "intelligence");
  if (gate) redirect(gate);
  const tab: Tab = TABS.find((x) => x === sp.onglet) ?? "comparaison";
  const now = new Date().getFullYear();
  const asked = Number(sp.annee);
  const cmp = await comparison(org, Number.isInteger(asked) && asked >= 2000 && asked <= now ? asked : null);
  // Sans année demandée : la dernière année de la base publique (l'année en cours n'y est pas encore publiée).
  const year = cmp?.year ?? (Number.isInteger(asked) && asked >= 2000 && asked <= now ? asked : now);
  const base = `/organisations/${id}/intelligence`;
  const [p, prod, watch] = await Promise.all([
    portfolio(id, year, cmp ? { importId: cmp.import.id, keys: cmp.keys } : null),
    productOverview(id, year),
    tab === "veille" ? watchFor(org) : null,
  ]);
  // Recommandations : règles lisibles (lib/market-advice pour la base publique, lib/intelligence-advice pour les
  // chiffres de l'organisation), les plus pressantes d'abord.
  const advice = [
    ...(cmp ? marketAdvice({
      year, found: cmp.found,
      me: { cents: cmp.me.cents, prevCents: cmp.previousCents, people: cmp.me.people, rank: cmp.rank, top5Share: cmp.experts.top5Share, exclusive: cmp.experts.exclusive },
      market: { cents: cmp.market.cents, prevCents: cmp.market.previousCents, companies: cmp.market.companies },
      peers: { count: cmp.peers.list.length, ...cmp.peers.median },
      purposes: cmp.purposes, regions: cmp.regions, protect: cmp.experts.protect, recruit: cmp.experts.recruit,
    }) : []),
    ...advise({ year, portfolio: p, products: { count: prod.products.length, coverage: prod.coverage, unassigned: prod.unassigned, rows: prod.rows } }),
  ].sort((a, b) => a.level - b.level);
  const adviceHref = (to: AdviceTab) => (to === "opportunites" ? `/organisations/${id}/opportunites` : to === "comparaison" ? "#comparaison" : `${base}?onglet=${to}&annee=${year}`);
  const live = prod.products.filter((x) => !x.archivedAt);
  const suggested = prod.toAttach.filter((x) => suggestProduct(x.title, prod.products)).length;
  const years = [...new Set([...p.years, ...(cmp?.years ?? []), year])].filter((y) => y <= now).sort();
  const tabs = [
    { key: "comparaison", href: `${base}?annee=${year}`, label: t("Vue d'ensemble") },
    { key: "experts", href: `${base}?onglet=experts&annee=${year}`, label: t("Experts") },
    { key: "produits", href: `${base}?onglet=produits&annee=${year}`, label: t("Produits"), count: live.length },
    { key: "veille", href: `${base}?onglet=veille`, label: t("Veille") },
    { key: "organisations", href: `${base}?onglet=organisations&annee=${year}`, label: t("Organisations comparées"), count: cmp?.compared.length ?? 0 },
  ];
  const perExpert = cmp && cmp.me.people > 0 ? cmp.me.cents / cmp.me.people : 0;
  // Médianes et moyennes : à l'euro près (les centimes d'une moyenne ne disent rien).
  const eur = (v: number | null) => (v === null ? "—" : fmtEur(locale, Math.round(v / 100) * 100));
  const shares = (title: string, table: { by: "montants" | "liens"; rows: Share[] }) => (
    <TableWrap label={title}>
      <table className="table">
        <thead><tr><th>{title}</th><th>{t("Vous")}</th><th>{t("Organisations équivalentes")}</th><th>{t("Marché")}</th></tr></thead>
        <tbody>
          {table.rows.map((r) => (
            <tr key={r.label}>
              <td data-label={title}>{r.label}</td>
              <td data-label={t("Vous")}><strong>{pct(r.me)}</strong></td>
              <td data-label={t("Organisations équivalentes")}>{pct(r.peers)}</td>
              <td data-label={t("Marché")}>{pct(r.market)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );

  return (
    <>
      <SiteHeader />
      <main className="stack">
        <p className="muted"><Link href={`/organisations/${id}/statistiques`}>{t("Statistiques")}</Link> / {t("Intelligence")}</p>
        <PageHead title={t("KolBase Intelligence")} desc={t("Votre organisation comparée au marché, à des organisations équivalentes et à celles que vous choisissez, avec les recommandations qui en découlent. Sources : la base publique Transparence Santé, mise à jour par l'équipe KolBase, et vos propres dossiers ; jamais les données d'une autre organisation cliente de KolBase.")} />
        <SectionNav tabs={tabs} active={tab} label={t("Rubrique Intelligence")} />
        {tab !== "veille" && (
          <nav className="chips" aria-label={t("Année")}>
            {years.map((y) => <Link key={y} href={`${base}?${tab === "comparaison" ? "" : `onglet=${tab}&`}annee=${y}`} className={`chip${y === year ? " active" : ""}`} aria-current={y === year ? "page" : undefined}>{y}</Link>)}
          </nav>
        )}

        {tab === "comparaison" && (
          <>
            {!cmp && <p className="notice">{t("La base publique Transparence Santé n'est pas encore chargée par l'équipe KolBase : la comparaison au marché apparaîtra ici dès sa première mise à jour. Les recommandations ci-dessous viennent de vos propres dossiers.")}</p>}
            {cmp && !cmp.found && <p className="notice warn">{t("Votre organisation n'est pas reconnue dans la base publique sous le nom « {name} ».", { name: cmp.names.join(", ") })} <Link href={`${base}?onglet=organisations&annee=${year}`}>{t("Indiquer sous quel nom elle déclare")}</Link></p>}
            {cmp?.found && (
              <dl className="hero-facts">
                <div><dt><Scale size={13} />{" "}{t("Rang")}</dt><dd>{cmp.rank ?? "—"}<small>{t("sur {n} entreprises, par montants versés en {year}", { n: cmp.market.companies, year })}</small></dd></div>
                <div><dt>{t("Part du marché")}</dt><dd>{cmp.market.cents > 0 ? pct(cmp.me.cents / cmp.market.cents) : "—"}<small>{t("des montants versés aux professionnels")}</small></dd></div>
                <div><dt><Wallet size={13} />{" "}{t("Montants versés")}</dt><dd>{fmtEur(locale, cmp.me.cents)}<small>{delta(cmp.me.cents, cmp.previousCents) ? t("{delta} par rapport à {year}", { delta: delta(cmp.me.cents, cmp.previousCents)!, year: year - 1 }) : t("avantages et rémunérations déclarés")}</small></dd></div>
                <div><dt><Users size={13} />{" "}{t("Bénéficiaires")}</dt><dd>{cmp.me.people}<small>{t("{n} chez vos équivalentes (médiane)", { n: cmp.peers.median.people === null ? "—" : Math.round(cmp.peers.median.people) })}</small></dd></div>
                <div><dt>{t("Par bénéficiaire")}</dt><dd>{eur(perExpert)}<small>{t("{montant} chez vos équivalentes (médiane)", { montant: eur(cmp.peers.median.perExpert) })}</small></dd></div>
              </dl>
            )}
            <section className="card stack-sm" id="recommandations">
              <SectionHead icon={Lightbulb} title={t("Ce que KolBase vous recommande")} desc={t("Qui protéger, qui recruter, où mettre le budget : tiré des chiffres de {year}, le plus pressant d'abord. Chaque constat est chiffré : à vous de décider.", { year })} />
              {advice.length === 0 ? (
                <p className="muted">{t("Rien à signaler en {year}.", { year })}</p>
              ) : (
                <ul className="plain stack-sm">
                  {advice.slice(0, 8).map((a) => (
                    <li key={a.key} className={`notice ${ADVICE_TONE[a.tone]} stack-xs`}>
                      <span><span className="pill">{t(FAMILY_LABEL[a.family])}</span></span>
                      <strong>{t(a.title, a.vars)}</strong>
                      <span>{t(a.detail, a.vars)}</span>
                      <Link href={adviceHref(a.tab)}>{t(ADVICE_CTA[a.tab])}</Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            {cmp && (
              <>
                <section className="card stack-sm" id="comparaison">
                  <SectionHead icon={Scale} title={t("Vous face aux autres en {year}", { year })} desc={t("Montants versés aux professionnels (avantages et rémunérations déclarés). Équivalentes : {n} organisations de taille proche{sector}. Marché : les {total} entreprises de la base.", { n: cmp.peers.list.length, sector: cmp.peers.sector ? t(", secteur « {sector} »", { sector: cmp.peers.sector }) : "", total: cmp.market.companies })} />
                  {cmp.market.companies === 0 ? <EmptyState icon={Scale} compact>{t("Aucune déclaration publique datée de {year}.", { year })}</EmptyState> : (
                    <>
                      <RankedBars caption={t("Montants versés en {year} : vous, vos équivalentes, le marché et les organisations choisies", { year })} format="eur" rows={[
                        ...(cmp.found ? [{ label: t("Vous"), value: cmp.me.cents }] : []),
                        { label: t("Organisations équivalentes (médiane)"), value: Math.round(cmp.peers.median.cents ?? 0) },
                        { label: t("Marché (médiane)"), value: Math.round(cmp.market.median.cents ?? 0) },
                        ...cmp.compared.filter((c) => c.entities.length > 0).map((c) => ({ label: c.name, value: c.year.cents })),
                      ]} />
                      <TableWrap label={t("Vous face aux autres en {year}", { year })}>
                        <table className="table">
                          <thead><tr><th>{t("Organisation")}</th><th>{t("Montants versés")}</th><th>{t("Bénéficiaires")}</th><th>{t("Par bénéficiaire")}</th><th>{t("Évolution")}</th></tr></thead>
                          <tbody>
                            {cmp.found && <tr><td data-label={t("Organisation")}><strong>{t("Vous")}</strong></td><td data-label={t("Montants versés")}>{fmtEur(locale, cmp.me.cents)}</td><td data-label={t("Bénéficiaires")}>{cmp.me.people}</td><td data-label={t("Par bénéficiaire")}>{eur(perExpert)}</td><td data-label={t("Évolution")}>{delta(cmp.me.cents, cmp.previousCents) ?? "—"}</td></tr>}
                            <tr><td data-label={t("Organisation")}>{t("Organisations équivalentes (médiane)")}</td><td data-label={t("Montants versés")}>{eur(cmp.peers.median.cents)}</td><td data-label={t("Bénéficiaires")}>{cmp.peers.median.people === null ? "—" : Math.round(cmp.peers.median.people)}</td><td data-label={t("Par bénéficiaire")}>{eur(cmp.peers.median.perExpert)}</td><td data-label={t("Évolution")}>—</td></tr>
                            <tr><td data-label={t("Organisation")}>{t("Marché (médiane)")}</td><td data-label={t("Montants versés")}>{eur(cmp.market.median.cents)}</td><td data-label={t("Bénéficiaires")}>{cmp.market.median.people === null ? "—" : Math.round(cmp.market.median.people)}</td><td data-label={t("Par bénéficiaire")}>{eur(cmp.market.median.perExpert)}</td><td data-label={t("Évolution")}>{delta(cmp.market.cents, cmp.market.previousCents) ?? "—"}</td></tr>
                            {cmp.compared.map((c) => (
                              <tr key={c.id}>
                                <td data-label={t("Organisation")}>{c.name}{c.entities.length === 0 && <div className="text-xs muted">{t("introuvable dans la base publique")}</div>}</td>
                                <td data-label={t("Montants versés")}>{c.entities.length ? fmtEur(locale, c.year.cents) : "—"}</td>
                                <td data-label={t("Bénéficiaires")}>{c.entities.length ? c.year.people : "—"}</td>
                                <td data-label={t("Par bénéficiaire")}>{c.year.people > 0 ? eur(c.year.cents / c.year.people) : "—"}</td>
                                <td data-label={t("Évolution")}>{delta(c.year.cents, c.previousCents) ?? "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </TableWrap>
                      <p><Link href={`${base}?onglet=organisations&annee=${year}`}>{t("Choisir les organisations auxquelles me comparer")}</Link></p>
                    </>
                  )}
                </section>
                {cmp.trend.length > 1 && (
                  <section className="card stack-sm">
                    <SectionHead icon={TrendingUp} title={t("Évolution sur {n} ans", { n: cmp.trend.length })} desc={t("Montants versés chaque année. Vos équivalentes sont celles de {year}, suivies dans le temps. La dernière année publiée peut être incomplète : comparez-vous aux autres plutôt qu'à l'année précédente.", { year })} />
                    <TableWrap label={t("Évolution sur {n} ans", { n: cmp.trend.length })}>
                      <table className="table">
                        <thead><tr><th>{t("Année")}</th><th>{t("Vous")}</th><th>{t("Organisations équivalentes (médiane)")}</th><th>{t("Marché (médiane)")}</th><th>{t("Votre part du marché")}</th></tr></thead>
                        <tbody>
                          {cmp.trend.map((r) => (
                            <tr key={r.year}>
                              <td data-label={t("Année")}>{r.year}</td>
                              <td data-label={t("Vous")}><strong>{fmtEur(locale, r.me)}</strong></td>
                              <td data-label={t("Organisations équivalentes (médiane)")}>{eur(r.peers)}</td>
                              <td data-label={t("Marché (médiane)")}>{eur(r.market)}</td>
                              <td data-label={t("Votre part du marché")}>{r.total > 0 ? pct(r.me / r.total) : "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </TableWrap>
                  </section>
                )}
                {(cmp.purposes.rows.length > 0 || cmp.regions.rows.length > 0) && (
                  <section className="card stack-sm" id="budget">
                    <SectionHead icon={Wallet} title={t("Où va le budget en {year}", { year })} desc={cmp.purposes.by === "montants" ? t("Part de chaque poste dans les montants versés : la vôtre, celle de vos équivalentes, celle du marché.") : t("Part de chaque poste dans le nombre de liens déclarés (vos déclarations de l'année ne portent pas de montant) : la vôtre, celle de vos équivalentes, celle du marché.")} />
                    <div className="stats-grid">
                      {cmp.purposes.rows.length > 0 && shares(t("Par motif"), cmp.purposes)}
                      {cmp.regions.rows.length > 0 && shares(t("Par région"), cmp.regions)}
                    </div>
                  </section>
                )}
                <p className="text-xs muted">{t("Données : base publique Transparence Santé, mise à jour par l'équipe KolBase le {date}. Les entreprises déclarantes répondent de l'exactitude des données publiées.", { date: fmtDate(locale, cmp.import.finishedAt ?? cmp.import.createdAt) })}</p>
              </>
            )}
          </>
        )}

        {tab === "experts" && (
          <>
            {cmp && (
              <>
                <section className="card stack-sm" id="proteger">
                  <SectionHead icon={ShieldAlert} title={t("Experts à protéger")} desc={t("Professionnels que vous déclarez en {year} et que d'autres entreprises déclarent aussi, les plus exposés d'abord. Rapprochés par nom, prénom et département.", { year })} />
                  {cmp.experts.protect.length === 0 ? <EmptyState icon={ShieldAlert} compact>{cmp.found ? t("Aucun de vos experts déclarés en {year} n'est exposé.", { year }) : t("Votre organisation n'est pas reconnue dans la base publique : indiquez son nom dans « Organisations comparées ».")}</EmptyState> : (
                    <TableWrap label={t("Experts à protéger")}>
                      <table className="table">
                        <thead><tr><th>{t("Expert")}</th><th>{t("Vous, en {year}", { year })}</th><th>{t("Autres entreprises, en {year}", { year })}</th><th>{t("Pourquoi")}</th></tr></thead>
                        <tbody>
                          {cmp.experts.protect.slice(0, 20).map((e) => (
                            <tr key={e.key}>
                              <td data-label={t("Expert")}>{e.name}{e.city && <div className="text-xs muted">{e.city}</div>}</td>
                              <td data-label={t("Vous, en {year}", { year })}>{fmtEur(locale, e.cents)}<div className="text-xs muted">{t(e.lines > 1 ? "{n} déclarations" : "{n} déclaration", { n: e.lines })}</div></td>
                              <td data-label={t("Autres entreprises, en {year}", { year })}>{e.others.slice(0, 3).map((o) => <div key={o.company}>{o.company} : {o.cents > 0 ? fmtEur(locale, o.cents) : t(o.lines > 1 ? "{n} déclarations" : "{n} déclaration", { n: o.lines })}{o.compared && <>{" "}<span className="pill wait">{t("comparée")}</span></>}</div>)}{e.others.length > 3 && <div className="text-xs muted">{t(e.others.length - 3 > 1 ? "et {n} autres" : "et {n} autre", { n: e.others.length - 3 })}</div>}</td>
                              <td data-label={t("Pourquoi")}><span className={`pill ${e.reason === "compare" ? "" : "wait"}`}>{t(PROTECT_LABEL[e.reason])}</span></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </TableWrap>
                  )}
                </section>
                <section className="card stack-sm" id="recruter">
                  <SectionHead icon={UserPlus} title={t("Experts à recruter")} desc={t("Professionnels de santé engagés par d'autres entreprises en {previous} et {year} (conventions et rémunérations), sans aucun lien déclaré avec vous. D'abord ceux qu'engagent vos équivalentes et les organisations que vous avez choisies.", { year, previous: year - 1 })} />
                  {cmp.experts.recruit.length === 0 ? <EmptyState icon={UserPlus} compact>{t("Aucun professionnel à proposer pour {year}.", { year })}</EmptyState> : (
                    <TableWrap label={t("Experts à recruter")}>
                      <table className="table">
                        <thead><tr><th>{t("Expert")}</th><th>{t("Engagé par")}</th><th>{t("Motif le plus fréquent")}</th><th>{t("Montants reçus")}</th></tr></thead>
                        <tbody>
                          {cmp.experts.recruit.map((c) => (
                            <tr key={c.key}>
                              <td data-label={t("Expert")}>{c.name}<div className="text-xs muted">{[c.city, c.region].filter(Boolean).join(" · ")}</div></td>
                              <td data-label={t("Engagé par")}>{t(c.companies > 1 ? "{n} entreprises" : "{n} entreprise", { n: c.companies })}{c.compared > 0 && <div className="text-xs muted">{t(c.compared > 1 ? "dont {n} auxquelles vous vous comparez" : "dont {n} à laquelle vous vous comparez", { n: c.compared })}</div>}</td>
                              <td data-label={t("Motif le plus fréquent")}>{c.purpose ?? "—"}<div className="text-xs muted">{t(c.lines > 1 ? "{n} déclarations" : "{n} déclaration", { n: c.lines })}{c.recent === 0 ? ` · ${t("aucune en {year}", { year })}` : ""}</div></td>
                              <td data-label={t("Montants reçus")}>{c.cents > 0 ? fmtEur(locale, c.cents) : "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </TableWrap>
                  )}
                  <p className="text-xs muted">{t("Un nom et un département identiques désignent en principe la même personne ; vérifiez avant de la contacter. Recherchez-la ensuite dans l'annuaire KolBase ou publiez une opportunité.")}</p>
                </section>
              </>
            )}
            <dl className="hero-facts">
              <div><dt><Users size={13} />{" "}{t("Experts engagés")}</dt><dd>{p.active}<small>{t("{montant} d'honoraires (HT) en {year}", { montant: fmtEur(locale, p.total), year })}</small></dd></div>
              <div><dt><UserCheck size={13} />{" "}{t("Fidélisation")}</dt><dd>{p.retention == null ? "—" : pct(p.retention)}<small>{t("des experts de {year} encore engagés", { year: year - 1 })}</small></dd></div>
              <div><dt>{t("Nouveaux")}</dt><dd>{p.loyalty.nouveau}<small>{t("première collaboration en {year}", { year })}</small></dd></div>
              <div><dt>{t("Dormants")}</dt><dd>{p.loyalty.dormant}<small>{t("engagés en {year}, plus depuis", { year: year - 1 })}</small></dd></div>
              <div><dt><Radar size={13} />{" "}{t("Experts partagés")}</dt><dd>{p.shared}<small>{t("aussi déclarés par une autre entreprise")}</small></dd></div>
            </dl>
            <section className="card stack-sm" id="portefeuille">
              <SectionHead icon={Users} title={t("Experts du portefeuille")} desc={t("Engagés : proposition acceptée, à la date de leur accord (même définition que les statistiques). Liens avec d'autres entreprises : base publique Transparence Santé, rapprochée par RPPS ou, à défaut, par nom et prénom.")} />
              {p.experts.length === 0 ? (
                <EmptyState icon={Users} compact>{t("Aucun expert engagé en {year} ni l'année précédente.", { year })}</EmptyState>
              ) : (
                <TableWrap label={t("Experts du portefeuille")}>
                  <table className="table">
                    <thead><tr><th>{t("Expert")}</th><th>{t("Place")}</th><th>{t("Honoraires {year}", { year })}</th><th>{t("Honoraires {year}", { year: year - 1 })}</th><th>{t("Liens publics avec d'autres entreprises en {year}", { year })}</th></tr></thead>
                    <tbody>
                      {p.experts.map((e) => (
                        <tr key={e.id}>
                          <td data-label={t("Expert")}><Link href={`/experts/${e.id}`}>{e.name}</Link>{e.specialty && <div className="text-xs muted">{t(e.specialty)}</div>}</td>
                          <td data-label={t("Place")}><span className={`pill ${e.loyalty === "dormant" ? "wait" : e.loyalty === "fidele" ? "ok" : ""}`}>{t(LOYALTY_LABEL[e.loyalty])}</span><div className="text-xs muted">{t("depuis {year}", { year: e.firstYear })}</div></td>
                          <td data-label={t("Honoraires {year}", { year })}>{e.engagements ? fmtEur(locale, e.cents) : "—"}{e.engagements > 0 && <div className="text-xs muted">{t(e.engagements > 1 ? "{n} collaborations" : "{n} collaboration", { n: e.engagements })}</div>}</td>
                          <td data-label={t("Honoraires {year}", { year: year - 1 })}>{e.previousCents ? fmtEur(locale, e.previousCents) : "—"}</td>
                          <td data-label={t("Liens publics avec d'autres entreprises en {year}", { year })}>{e.shared.length === 0 ? "—" : e.shared.map((s) => <div key={s.competitor}>{s.competitor} : {fmtEur(locale, s.cents)} <span className="text-xs muted">({t(s.count > 1 ? "{n} déclarations" : "{n} déclaration", { n: s.count })})</span></div>)}</td>
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

        {tab === "organisations" && (
          <>
            <section className="card stack-sm">
              <SectionHead icon={Building2} title={t("Votre organisation dans la base publique")} desc={t("Pour vous comparer, KolBase doit reconnaître vos déclarations dans la base Transparence Santé : par défaut sous votre nom, sinon sous les écritures que vous indiquez.")} />
              {!cmp ? <p className="muted">{t("La base publique n'est pas encore chargée par l'équipe KolBase.")}</p> : cmp.found ? <p>{t(cmp.entities.length > 1 ? "{n} entreprises de la base vous sont rattachées : {list}." : "{n} entreprise de la base vous est rattachée : {list}.", { n: cmp.entities.length, list: cmp.entities.slice(0, 8).join(", ") })}</p> : <p className="notice warn">{t("Aucune entreprise de la base ne porte le nom « {name} ».", { name: cmp.names.join(", ") })}</p>}
              <MarketNamesForm orgId={id} names={cmp?.names ?? []} />
            </section>
            <section className="card stack-sm">
              <SectionHead icon={Scale} title={t("Organisations que vous avez choisies")} desc={t("Vingt au plus. Elles apparaissent nommément dans votre comparaison, et les experts qu'elles engagent passent en tête de vos recommandations.")} />
              {(cmp?.compared.length ?? 0) > 0 && (
                <ul className="plain stack-sm">
                  {cmp!.compared.map((c) => (
                    <li key={c.id} className="actions spread">
                      <span><strong>{c.name}</strong>{c.aliases.length > 0 && <span className="text-xs muted"> · {t("Autres écritures : {list}", { list: c.aliases.join(", ") })}</span>}<div className="text-xs muted">{c.entities.length === 0 ? t("introuvable dans la base publique") : t("Dans la base : {list}", { list: c.entities.slice(0, 6).join(", ") })}</div></span>
                      <form action={removeCompetitor}>
                        <input type="hidden" name="orgId" value={id} />
                        <input type="hidden" name="competitorId" value={c.id} />
                        <ConfirmButton className="btn ghost small" confirm={t("retirer {name} de votre comparaison", { name: c.name })} localized><Trash2 size={14} /> {t("Retirer")}</ConfirmButton>
                      </form>
                    </li>
                  ))}
                </ul>
              )}
              <CompetitorForm orgId={id} suggestions={cmp?.suggestions ?? []} />
            </section>
            {cmp && cmp.peers.list.length > 0 && (
              <section className="card stack-sm">
                <SectionHead icon={Users} title={t("Vos organisations équivalentes en {year}", { year })} desc={cmp.peers.by === "montants" ? t("Choisies par KolBase : même secteur d'activité quand il est renseigné, et montants versés entre la moitié et le double des vôtres ; à défaut, les cinq de taille la plus proche.") : t("Choisies par KolBase : même secteur d'activité quand il est renseigné, et nombre de liens déclarés entre la moitié et le double du vôtre ; à défaut, les cinq de taille la plus proche.")} />
                <RankedBars caption={t("Montants versés par vos organisations équivalentes en {year}", { year })} format="eur" rows={cmp.peers.list.slice(0, 20).map((c) => ({ label: c.name, value: c.cents, note: t(c.people > 1 ? "{n} bénéficiaires" : "{n} bénéficiaire", { n: c.people }) }))} />
              </section>
            )}
          </>
        )}

        {tab === "veille" && watch && (
          <>
            <section className="card stack-sm">
              <SectionHead icon={Newspaper} title={t("Publications des {n} derniers jours", { n: WATCH_DAYS })} desc={t("Publications des sites spécialisés relevés par KolBase qui citent l'un de vos concurrents suivis ou votre organisation, et publications que vous avez ajoutées. Titre, date et court extrait : l'article se lit sur le site d'origine.")} />
              {watch.competitors === 0 && <p className="notice warn">{t("Vous ne suivez aucun concurrent : seules les publications qui citent votre organisation apparaissent.")} <Link href={`${base}?onglet=organisations`}>{t("Choisir une organisation")}</Link></p>}
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

      </main>
    </>
  );
}
