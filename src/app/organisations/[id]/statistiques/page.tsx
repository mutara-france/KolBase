import Link from "next/link";
import { AlertTriangle, CalendarDays, Clock, Download, Euro, Gift, ShieldCheck, Star, Truck, Users } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { Meter, RankedBars, StackedColumns } from "@/components/Charts";
import { requireMembership } from "@/lib/orgs";
import { orgStats, STATS_ROLES } from "@/lib/org-stats";
import { formatDate, formatEUR } from "@/lib/events";
import { TableWrap } from "@/components/TableWrap";

export const metadata = { title: "Statistiques — KolBase" };

const days = (d: number | null) => (d == null ? "—" : `${d < 1 ? "< 1" : Math.round(d).toLocaleString("fr-FR")} j`);
const pct = (x: number) => `${Math.round(x * 100)} %`;

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ annee?: string }> }) {
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

  return (
    <>
      <SiteHeader />
      <main className="stack">
        <div className="actions spread">
          <div>
            <h1>Statistiques</h1>
            <p className="muted">Budget engagé, experts, événements, délais et conformité de l&apos;organisation, année par année.</p>
          </div>
          <a className="btn ghost small" href={`${base}/statistiques/export?annee=${year}`}><Download size={14} /> Exporter {year} (CSV)</a>
        </div>
        <nav className="chips" aria-label="Année">
          {s.years.map((y) => <Link key={y} href={`?annee=${y}`} className={`chip${y === year ? " active" : ""}`} aria-current={y === year ? "page" : undefined}>{y}</Link>)}
        </nav>

        <dl className="hero-facts">
          <div>
            <dt><Euro size={13} /> Budget engagé (HT)</dt>
            <dd>{formatEUR(s.totals.ht)}<small>{delta != null ? `${delta >= 0 ? "+" : "−"}${pct(Math.abs(delta))} par rapport à ${year - 1}` : `en ${year}`} · hors hospitalités ({formatEUR(s.totals.hospitality)} TTC)</small></dd>
          </div>
          <div><dt><Users size={13} /> Experts rémunérés</dt><dd>{s.expertCount}<small>{s.engagedProjects} dossier{s.engagedProjects > 1 ? "s" : ""} engagé{s.engagedProjects > 1 ? "s" : ""}</small></dd></div>
          <div><dt><CalendarDays size={13} /> Événements</dt><dd>{s.events.length}<small>{s.participants} participant{s.participants > 1 ? "s" : ""} inscrit{s.participants > 1 ? "s" : ""}</small></dd></div>
          <div><dt><Star size={13} /> Satisfaction</dt><dd>{s.satisfaction.average != null ? `${s.satisfaction.average.toFixed(1).replace(".", ",")} / 5` : "—"}<small>{s.satisfaction.responses} avis de participants</small></dd></div>
          <div><dt><ShieldCheck size={13} /> Transparence Santé</dt><dd>{declaredTotal ? `${s.compliance.declared} / ${declaredTotal}` : "—"}<small>dossiers déclarés</small></dd></div>
        </dl>

        <section className="card stack-sm">
          <div>
            <h2>Budget engagé par trimestre</h2>
            <p className="muted">Honoraires des experts engagés à la date de leur accord ; logistique (devis retenus et dépenses) et hospitalités à la date de l&apos;événement.</p>
          </div>
          <StackedColumns
            caption={`Budget engagé par trimestre en ${year}`}
            format="eur"
            series={[{ key: "fees", label: `Honoraires des experts (HT) · ${formatEUR(s.totals.fees)}` }, { key: "logistics", label: `Logistique (HT) · ${formatEUR(s.totals.logistics)}` }, { key: "hospitality", label: `Hospitalités (TTC) · ${formatEUR(s.totals.hospitality)}` }]}
            rows={s.quarters.map((q) => ({ label: q.label, values: { fees: q.fees, logistics: q.logistics, hospitality: q.hospitality } }))}
          />
        </section>

        <div className="stats-grid">
          <section className="card stack-sm">
            <h2>Honoraires par type de collaboration</h2>
            <RankedBars caption="Honoraires par type de collaboration" format="eur" rows={s.byType.map((t) => ({ label: t.label, value: t.cents, note: `${t.projects} dossier${t.projects > 1 ? "s" : ""}` }))} />
          </section>
          <section className="card stack-sm">
            <h2>Concentration des honoraires</h2>
            {s.top5Share == null ? <p className="muted">Aucun honoraire engagé sur la période.</p> : (
              <>
                <p className="text-sm"><strong>{pct(s.top5Share)}</strong> des honoraires vont aux {Math.min(5, s.expertCount)} premiers experts, sur {s.expertCount} rémunéré{s.expertCount > 1 ? "s" : ""}.</p>
                <Meter value={s.top5Share} label="Part des cinq premiers experts dans les honoraires" />
                <ol className="top-list">
                  {s.top.map((e) => <li key={e.name}><span>{e.name}</span><span>{formatEUR(e.cents)} · {pct(e.share)}</span></li>)}
                </ol>
                <p className="hint">Varier les experts sollicités limite les liens d&apos;intérêts durables et facilite la justification du besoin.</p>
              </>
            )}
          </section>
          <section className="card stack-sm">
            <h2>Experts par spécialité</h2>
            <RankedBars caption="Experts rémunérés par spécialité" format="int" rows={s.specialties.map((x) => ({ label: x.label, value: x.count, note: `${x.count} expert${x.count > 1 ? "s" : ""}` }))} />
          </section>
          <section className="card stack-sm">
            <h2>Délais</h2>
            <p className="muted">Médianes sur l&apos;année, d&apos;après l&apos;historique des dossiers.</p>
            <ul className="delay-list">
              <li><Clock size={15} aria-hidden /><span>Réponse des experts<small>sur {s.delays.expertResponse.n} sollicitation{s.delays.expertResponse.n > 1 ? "s" : ""}</small></span><strong>{days(s.delays.expertResponse.days)}</strong></li>
              <li><ShieldCheck size={15} aria-hidden /><span>Validation par la conformité<small>sur {s.delays.compliance.n} examen{s.delays.compliance.n > 1 ? "s" : ""}</small></span><strong>{days(s.delays.compliance.days)}</strong></li>
              <li><Clock size={15} aria-hidden /><span>De la création à la signature<small>sur {s.delays.toSignature.n} dossier{s.delays.toSignature.n > 1 ? "s" : ""}</small></span><strong>{days(s.delays.toSignature.days)}</strong></li>
            </ul>
          </section>
        </div>

        <section className="card stack-sm">
          <h2>Événements {year}</h2>
          {s.events.length === 0 ? <p className="muted">Aucun événement sur l&apos;année.</p> : (
            <TableWrap label={`Événements ${year}`}>
              <table className="table stats-table">
                <caption className="sr-only">Événements {year} : inscrits, présents, hospitalités et prestataires, au total et par présent</caption>
                <thead>
                  <tr><th>Événement</th><th>Date</th><th className="num">Inscrits</th><th className="num">Présents</th><th className="num">Hospitalités (TTC)</th><th className="num">Prestataires (HT)</th><th className="num">Avis</th></tr>
                </thead>
                <tbody>
                  {s.events.map((e) => (
                    <tr key={e.id}>
                      <td data-label="Événement"><Link href={`${base}/evenements/${e.id}`}>{e.title}</Link>{e.internal && <span className="muted text-xs"> · réunion interne</span>}</td>
                      <td data-label="Date">{formatDate(e.date)}{!e.past && <span className="muted text-xs"> · à venir</span>}</td>
                      <td data-label="Inscrits" className="num">{e.registrations}{e.capacity ? <span className="muted"> / {e.capacity}</span> : null}</td>
                      <td data-label="Présents" className="num">{e.present || (e.past ? "—" : "")}</td>
                      {/* Coût par présent (ou par inscrit tant que la présence n'est pas connue) sous le total : deux colonnes de moins. */}
                      <td data-label="Hospitalités (TTC)" className="num">{formatEUR(e.hospitality)}{e.hospitalityPer != null && <div className="muted text-xs">{formatEUR(e.hospitalityPer)} {e.presenceKnown ? "par présent" : "par inscrit"}</div>}</td>
                      <td data-label="Prestataires (HT)" className="num">{formatEUR(e.suppliers)}{e.suppliersPer != null && <div className="muted text-xs">{formatEUR(e.suppliersPer)} {e.presenceKnown ? "par présent" : "par inscrit"}</div>}</td>
                      <td data-label="Avis" className="num">{e.rating != null ? `${e.rating.toFixed(1).replace(".", ",")} ★` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
          {s.events.length > 0 && <p className="hint">Hospitalités en valeur déclarée (TTC), prestataires selon les devis retenus (HT), rapportés séparément à l&apos;effectif. Après un événement pointé, les absents sont exclus et l&apos;effectif est celui des présents ; avant, ou sans pointage, celui des inscrits.</p>}
        </section>

        <section className="card stack-sm">
          <h2>Conformité {year}</h2>
          <div className="stats-grid">
            <div className="stack-sm">
              <p className="text-sm"><ShieldCheck size={14} /> <strong>Transparence Santé</strong> : {declaredTotal ? `${s.compliance.declared} dossier${s.compliance.declared > 1 ? "s" : ""} déclaré${s.compliance.declared > 1 ? "s" : ""} sur ${declaredTotal} validé${declaredTotal > 1 ? "s" : ""}` : "aucun dossier validé"}.</p>
              {declaredTotal > 0 && <Meter value={s.compliance.declared / declaredTotal} label="Part des dossiers validés déclarés sur Transparence Santé" />}
              {s.compliance.toDeclare > 0 && <Link className="text-sm" href={`${base}/conformite?onglet=transparence`}>Voir les déclarations à faire</Link>}
            </div>
            <ul className="top-list">
              <li><span>{s.compliance.fmvOver > 0 ? <AlertTriangle size={13} className="warn-text" /> : <ShieldCheck size={13} />} Honoraires au-dessus de la fourchette de juste contrepartie</span><span>{s.compliance.fmvOver}</span></li>
              <li><span>{s.compliance.blocked > 0 ? <AlertTriangle size={13} className="warn-text" /> : <ShieldCheck size={13} />} Dossiers bloqués par la conformité</span><span>{s.compliance.blocked}</span></li>
              <li><span><Truck size={13} /> Logistique engagée (devis et dépenses, HT)</span><span>{formatEUR(s.totals.logistics)}</span></li>
              <li><span><Gift size={13} /> Hospitalités accordées (valeur déclarée, TTC)</span><span>{formatEUR(s.totals.hospitality)}</span></li>
            </ul>
          </div>
        </section>

        <section className="card stack-sm" aria-labelledby="definitions">
          <h2 id="definitions">Définitions</h2>
          <ul className="hint">
            <li><strong>Engagé</strong> : l&apos;expert a accepté la proposition (accord de principe ou étape suivante, dossier non abandonné), comme sur l&apos;accueil et les dossiers. Ses honoraires comptent dans le budget à la date de son accord.</li>
            <li><strong>Budget engagé</strong> : honoraires des experts engagés et logistique (devis retenus, dépenses), hors taxes. Les hospitalités, en valeur déclarée toutes taxes comprises, sont présentées à part.</li>
            <li><strong>Présents</strong> : après un événement pointé à l&apos;accueil, les inscrits non pointés sont absents ; leurs hospitalités, non consommées, ne sont pas comptées.</li>
          </ul>
        </section>
      </main>
    </>
  );
}
