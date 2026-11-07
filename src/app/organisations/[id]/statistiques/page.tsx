import Link from "next/link";
import { AlertTriangle, CalendarDays, Clock, Download, Euro, Gift, ShieldCheck, Star, Truck, Users } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { Meter, RankedBars, StackedColumns } from "@/components/Charts";
import { requireMembership } from "@/lib/orgs";
import { orgStats, STATS_ROLES } from "@/lib/org-stats";
import { TableWrap } from "@/components/TableWrap";
import { getT } from "@/lib/i18n/server";
import { fmtDate, fmtEur, type T } from "@/lib/i18n";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: `${t("Statistiques")} — KolBase` };
}

const days = (t: T, d: number | null) => (d == null ? "—" : t("{n} j", { n: d < 1 ? "< 1" : Math.round(d) }));
const pct = (x: number) => `${Math.round(x * 100)} %`;

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ annee?: string; geo?: string }> }) {
  const { t, locale } = await getT();
  const { id } = await params;
  const sp = await searchParams;
  await requireMembership(id, STATS_ROLES);
  const now = new Date().getFullYear();
  const asked = Number(sp.annee);
  const year = Number.isInteger(asked) && asked >= 2000 && asked <= now ? asked : now;
  const s = await orgStats(id, year);
  const prev = year > Math.min(...s.years) ? await orgStats(id, year - 1) : null;
  const delta = prev && prev.totals.ht > 0 ? (s.totals.ht - prev.totals.ht) / prev.totals.ht : null;
  const declaredTotal = s.compliance.declared + s.compliance.toDeclare;
  const base = `/organisations/${id}`;
  // Répartition géographique : par région (code postal, ou grande ville), ou par ville.
  const geoBy = sp.geo === "villes" ? "cities" : "regions";
  const geo = s.geo[geoBy];
  const top = <T,>(rows: T[]) => rows.slice(0, 10);

  return (
    <>
      <SiteHeader />
      <main className="stack">
        <div className="actions spread">
          <div>
            <h1>{t("Statistiques")}</h1>
            <p className="muted">{t("Budget engagé, experts, événements, délais et conformité de l'organisation, année par année.")}</p>
          </div>
          <a className="btn ghost small" href={`${base}/statistiques/export?annee=${year}`}><Download size={14} />{" "}{t("Exporter {year} (CSV)", { year })}</a>
        </div>
        <nav className="chips" aria-label={t("Année")}>
          {s.years.map((y) => <Link key={y} href={`?annee=${y}`} className={`chip${y === year ? " active" : ""}`} aria-current={y === year ? "page" : undefined}>{y}</Link>)}
        </nav>

        <dl className="hero-facts">
          <div>
            <dt><Euro size={13} />{" "}{t("Budget engagé (HT)")}</dt>
            <dd>{fmtEur(locale, s.totals.ht)}<small>{delta != null ? t("{v}{pct} par rapport à {v2}", { v: delta >= 0 ? "+" : "−", pct: pct(Math.abs(delta)), v2: year - 1 }) : t("en {year}", { year })}{" "}{t("· hors hospitalités ({montant} TTC)", { montant: fmtEur(locale, s.totals.hospitality) })}</small></dd>
          </div>
          <div><dt><Users size={13} />{" "}{t("Experts rémunérés")}</dt><dd>{s.expertCount}<small>{t(s.engagedProjects > 1 ? "{engagedProjects} dossiers engagés" : "{engagedProjects} dossier engagé", { engagedProjects: s.engagedProjects })}</small></dd></div>
          <div><dt><CalendarDays size={13} />{" "}{t("Événements")}</dt><dd>{s.events.length}<small>{t(s.participants > 1 ? "{participants} participants inscrits" : "{participants} participant inscrit", { participants: s.participants })}</small></dd></div>
          <div><dt><Star size={13} />{" "}{t("Satisfaction")}</dt><dd>{s.satisfaction.average != null ? `${s.satisfaction.average.toFixed(1).replace(".", ",")} / 5` : "—"}<small>{t("{responses} avis de participants", { responses: s.satisfaction.responses })}</small></dd></div>
          <div><dt><ShieldCheck size={13} />{" "}{t("Transparence Santé")}</dt><dd>{declaredTotal ? `${s.compliance.declared} / ${declaredTotal}` : "—"}<small>{t("dossiers déclarés")}</small></dd></div>
        </dl>

        <section className="card stack-sm">
          <div>
            <h2>{t("Budget engagé par trimestre")}</h2>
            <p className="muted">{t("Honoraires des experts engagés à la date de leur accord ; logistique (devis retenus et dépenses) et hospitalités à la date de l'événement.")}</p>
          </div>
          <StackedColumns
            caption={t("Budget engagé par trimestre en {year}", { year })}
            format="eur"
            series={[{ key: "fees", label: t("Honoraires des experts (HT) · {montant}", { montant: fmtEur(locale, s.totals.fees) }) }, { key: "logistics", label: t("Logistique (HT) · {montant}", { montant: fmtEur(locale, s.totals.logistics) }) }, { key: "hospitality", label: t("Hospitalités (TTC) · {montant}", { montant: fmtEur(locale, s.totals.hospitality) }) }]}
            rows={s.quarters.map((q) => ({ label: t(q.label), values: { fees: q.fees, logistics: q.logistics, hospitality: q.hospitality } }))}
          />
        </section>

        <div className="stats-grid">
          <section className="card stack-sm">
            <h2>{t("Honoraires par type de collaboration")}</h2>
            <RankedBars caption={t("Honoraires par type de collaboration")} format="eur" rows={s.byType.map((tk) => ({ label: t(tk.label), value: tk.cents, note: t(tk.projects > 1 ? "{projects} dossiers" : "{projects} dossier", { projects: tk.projects }) }))} />
          </section>
          <section className="card stack-sm">
            <h2>{t("Concentration des honoraires")}</h2>
            {s.top5Share == null ? <p className="muted">{t("Aucun honoraire engagé sur la période.")}</p> : (
              <>
                <p className="text-sm"><strong>{pct(s.top5Share)}</strong>{" "}{t(s.expertCount > 1 ? "des honoraires vont aux {min} premiers experts, sur {expertCount} rémunérés." : "des honoraires vont aux {min} premiers experts, sur {expertCount} rémunéré.", { min: Math.min(5, s.expertCount), expertCount: s.expertCount })}</p>
                <Meter value={s.top5Share} label={t("Part des cinq premiers experts dans les honoraires")} />
                <ol className="top-list">
                  {s.top.map((e) => <li key={e.name}><span>{e.name}</span><span>{fmtEur(locale, e.cents)} · {pct(e.share)}</span></li>)}
                </ol>
                <p className="hint">{t("Varier les experts sollicités limite les liens d'intérêts durables et facilite la justification du besoin.")}</p>
              </>
            )}
          </section>
          <section className="card stack-sm">
            <h2>{t("Experts par spécialité")}</h2>
            <RankedBars caption={t("Experts rémunérés par spécialité")} format="int" rows={s.specialties.map((x) => ({ label: t(x.label), value: x.count, note: t(x.count > 1 ? "{count} experts" : "{count} expert", { count: x.count }) }))} />
          </section>
          <section className="card stack-sm">
            <h2>{t("Délais")}</h2>
            <p className="muted">{t("Médianes sur l'année, d'après l'historique des dossiers.")}</p>
            <ul className="delay-list">
              <li><Clock size={15} aria-hidden /><span>{t("Réponse des experts")}<small>{t(s.delays.expertResponse.n > 1 ? "sur {n} sollicitations" : "sur {n} sollicitation", { n: s.delays.expertResponse.n })}</small></span><strong>{days(t, s.delays.expertResponse.days)}</strong></li>
              <li><ShieldCheck size={15} aria-hidden /><span>{t("Validation par la conformité")}<small>{t(s.delays.compliance.n > 1 ? "sur {n} examens" : "sur {n} examen", { n: s.delays.compliance.n })}{s.delays.compliance.onTime != null ? ` · ${t("{pct} dans le délai interne ({days} jours ouvrés)", { pct: pct(s.delays.compliance.onTime), days: s.delays.compliance.reviewDays })}` : ""}</small></span><strong>{days(t, s.delays.compliance.days)}</strong></li>
              <li><Clock size={15} aria-hidden /><span>{t("De la création à la signature")}<small>{t(s.delays.toSignature.n > 1 ? "sur {n} dossiers" : "sur {n} dossier", { n: s.delays.toSignature.n })}</small></span><strong>{days(t, s.delays.toSignature.days)}</strong></li>
            </ul>
          </section>
        </div>

        <section className="card stack" id="geographie" aria-labelledby="geographie-titre">
          <div className="actions spread">
            <div>
              <h2 id="geographie-titre">{t("Répartition géographique {year}", { year })}</h2>
              <p className="muted">{t("Experts rémunérés et participants selon leur lieu d'exercice, événements selon leur lieu. La région se déduit du code postal, ou à défaut des principales villes.")}</p>
            </div>
            <nav className="chips" aria-label={t("Regrouper par")}>
              <Link href={`?annee=${year}#geographie`} className={`chip${geoBy === "regions" ? " active" : ""}`} aria-current={geoBy === "regions" ? "true" : undefined}>{t("Régions")}</Link>
              <Link href={`?annee=${year}&geo=villes#geographie`} className={`chip${geoBy === "cities" ? " active" : ""}`} aria-current={geoBy === "cities" ? "true" : undefined}>{t("Villes")}</Link>
            </nav>
          </div>
          <div className="grid-3">
            <div className="stack-sm">
              <h3>{t("Experts rémunérés")}</h3>
              {geo.experts.length === 0 ? <p className="muted">{t("Aucun expert rémunéré sur l'année.")}</p> : (
                <RankedBars caption={t("Experts rémunérés par lieu d'exercice")} format="int" rows={top(geo.experts).map((x) => ({ label: t(x.label), value: x.count, note: fmtEur(locale, x.cents) }))} />
              )}
            </div>
            <div className="stack-sm">
              <h3>{t("Participants aux événements")}</h3>
              {geo.participants.length === 0 ? <p className="muted">{t("Aucun participant sur l'année.")}</p> : (
                <RankedBars caption={t("Participants par lieu d'exercice")} format="int" rows={top(geo.participants).map((x) => ({ label: t(x.label), value: x.count, note: t(x.count > 1 ? "{count} participants" : "{count} participant", { count: x.count }) }))} />
              )}
            </div>
            <div className="stack-sm">
              <h3>{t("Événements")}</h3>
              {geo.events.length === 0 ? <p className="muted">{t("Aucun événement sur l'année.")}</p> : (
                <RankedBars caption={t("Événements par lieu")} format="int" rows={top(geo.events).map((x) => ({ label: t(x.label), value: x.count, note: t(x.count > 1 ? "{count} événements" : "{count} événement", { count: x.count }) }))} />
              )}
            </div>
          </div>
        </section>

        <section className="card stack-sm">
          <h2>{t("Événements {year}", { year })}</h2>
          {s.events.length === 0 ? <p className="muted">{t("Aucun événement sur l'année.")}</p> : (
            <TableWrap label={t("Événements {year}", { year })}>
              <table className="table stats-table">
                <caption className="sr-only">{t("Événements {year} : inscrits, présents, hospitalités et prestataires, au total et par présent", { year })}</caption>
                <thead>
                  <tr><th>{t("Événement")}</th><th>{t("Date")}</th><th className="num">{t("Inscrits")}</th><th className="num">{t("Présents")}</th><th className="num">{t("Hospitalités (TTC)")}</th><th className="num">{t("Prestataires (HT)")}</th><th className="num">{t("Avis")}</th></tr>
                </thead>
                <tbody>
                  {s.events.map((e) => (
                    <tr key={e.id}>
                      <td data-label="Événement"><Link href={`${base}/evenements/${e.id}`}>{e.title}</Link>{e.internal && <span className="muted text-xs">{" "}{t("· réunion interne")}</span>}</td>
                      <td data-label="Date">{fmtDate(locale, e.date)}{!e.past && <span className="muted text-xs">{" "}{t("· à venir")}</span>}</td>
                      <td data-label="Inscrits" className="num">{e.registrations}{e.capacity ? <span className="muted"> / {e.capacity}</span> : null}</td>
                      <td data-label="Présents" className="num">{e.present || (e.past ? "—" : "")}</td>
                      {/* Coût par présent (ou par inscrit tant que la présence n'est pas connue) sous le total : deux colonnes de moins. */}
                      <td data-label="Hospitalités (TTC)" className="num">{fmtEur(locale, e.hospitality)}{e.hospitalityPer != null && <div className="muted text-xs">{fmtEur(locale, e.hospitalityPer)} {e.presenceKnown ? t("par présent") : t("par inscrit")}</div>}</td>
                      <td data-label="Prestataires (HT)" className="num">{fmtEur(locale, e.suppliers)}{e.suppliersPer != null && <div className="muted text-xs">{fmtEur(locale, e.suppliersPer)} {e.presenceKnown ? t("par présent") : t("par inscrit")}</div>}</td>
                      <td data-label="Avis" className="num">{e.rating != null ? `${e.rating.toFixed(1).replace(".", ",")} ★` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
          {s.events.length > 0 && <p className="hint">{t("Hospitalités en valeur déclarée (TTC), prestataires selon les devis retenus (HT), rapportés séparément à l'effectif. Après un événement pointé, les absents sont exclus et l'effectif est celui des présents ; avant, ou sans pointage, celui des inscrits.")}</p>}
        </section>

        <section className="card stack-sm">
          <h2>{t("Conformité {year}", { year })}</h2>
          <div className="stats-grid">
            <div className="stack-sm">
              <p className="text-sm"><ShieldCheck size={14} /> <strong>{t("Transparence Santé")}</strong> : {declaredTotal ? t(s.compliance.declared > 1 ? (declaredTotal > 1 ? "{n} dossiers déclarés sur {m} validés" : "{n} dossiers déclarés sur {m} validé") : declaredTotal > 1 ? "{n} dossier déclaré sur {m} validés" : "{n} dossier déclaré sur {m} validé", { n: s.compliance.declared, m: declaredTotal }) : t("aucun dossier validé")}.</p>
              {declaredTotal > 0 && <Meter value={s.compliance.declared / declaredTotal} label={t("Part des dossiers validés déclarés sur Transparence Santé")} />}
              {s.compliance.toDeclare > 0 && <Link className="text-sm" href={`${base}/conformite?onglet=transparence`}>{t("Voir les déclarations à faire")}</Link>}
            </div>
            <ul className="top-list">
              <li><span>{s.compliance.fmvOver > 0 ? <AlertTriangle size={13} className="warn-text" /> : <ShieldCheck size={13} />}{" "}{t("Honoraires au-dessus de la fourchette de juste contrepartie")}</span><span>{s.compliance.fmvOver}</span></li>
              <li><span>{s.compliance.blocked > 0 ? <AlertTriangle size={13} className="warn-text" /> : <ShieldCheck size={13} />}{" "}{t("Dossiers bloqués par la conformité")}</span><span>{s.compliance.blocked}</span></li>
              <li><span><Truck size={13} />{" "}{t("Logistique engagée (devis et dépenses, HT)")}</span><span>{fmtEur(locale, s.totals.logistics)}</span></li>
              <li><span><Gift size={13} />{" "}{t("Hospitalités accordées (valeur déclarée, TTC)")}</span><span>{fmtEur(locale, s.totals.hospitality)}</span></li>
            </ul>
          </div>
        </section>

        <section className="card stack-sm" aria-labelledby="definitions">
          <h2 id="definitions">{t("Définitions")}</h2>
          <ul className="hint">
            <li><strong>{t("Engagé")}</strong>{" "}{t(": l'expert a accepté la proposition (accord de principe ou étape suivante, dossier non abandonné), comme sur l'accueil et les dossiers. Ses honoraires comptent dans le budget à la date de son accord.")}</li>
            <li><strong>{t("Budget engagé")}</strong>{" "}{t(": honoraires des experts engagés et logistique (devis retenus, dépenses), hors taxes. Les hospitalités, en valeur déclarée toutes taxes comprises, sont présentées à part.")}</li>
            <li><strong>{t("Présents")}</strong>{" "}{t(": après un événement pointé à l'accueil, les inscrits non pointés sont absents ; leurs hospitalités, non consommées, ne sont pas comptées.")}</li>
          </ul>
        </section>
      </main>
    </>
  );
}
