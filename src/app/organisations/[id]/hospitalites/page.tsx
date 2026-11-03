import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { SectionNav } from "@/components/SectionNav";
import { orgTabs } from "@/lib/org-overview";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/orgs";
import { COMPLIANCE_ROLES, formatDate, formatEUR } from "@/lib/events";
import { markDeclared } from "@/lib/event-actions";
import { complianceSettings, foreignRegime, hospitalityRegime, REGIME_LABEL } from "@/lib/compliance";
import { practicesInFrance } from "@/lib/countries";

export const metadata = { title: "Hospitalités — KolBase" };

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ statut?: string }> }) {
  const { id } = await params;
  const { statut = "a-declarer" } = await searchParams;
  const { org } = await requireMembership(id, COMPLIANCE_ROLES);

  // Uniquement les inscriptions de praticiens ayant accepté au moins une prestation.
  const regs = await db.registration.findMany({
    where: {
      event: { organizationId: id },
      profession: { not: null },
      benefits: { some: {} },
      ...(statut === "declarees" ? { declared: true } : statut === "a-declarer" ? { declared: false } : {}),
    },
    include: { user: { include: { practitioner: { select: { country: true } } } }, event: true, benefits: { include: { benefit: true } } },
    orderBy: [{ event: { startsAt: "desc" } }, { createdAt: "asc" }],
  });
  // Événements pointés à l'accueil : un inscrit non pointé est signalé absent (avantage à vérifier avant déclaration).
  const pointed = new Set((await db.registration.groupBy({ by: ["eventId"], where: { event: { organizationId: id, startsAt: { lt: new Date() } }, checkedInAt: { not: null } } })).map((g) => g.eventId));
  const absent = (r: (typeof regs)[number]) => pointed.has(r.eventId) && !r.checkedInAt;
  const byEvent = new Map<string, typeof regs>();
  for (const r of regs) byEvent.set(r.eventId, [...(byEvent.get(r.eventId) ?? []), r]);
  // Régime de chaque convention d'hospitalité, avec les seuils de l'organisation.
  const settings = complianceSettings(org.complianceSettings);
  const regimeOf = (r: (typeof regs)[number]) => {
    const c = r.user.practitioner?.country ?? "FR";
    return practicesInFrance(c) ? hospitalityRegime(settings, r.benefits.map((b) => ({ catalogId: b.benefit.catalogId, valueCents: b.valueCents }))) : foreignRegime(c);
  };
  const sum = (rs: typeof regs) => rs.reduce((s, r) => s + r.benefits.reduce((x, b) => x + b.valueCents, 0), 0);
  const tabs = [["a-declarer", "À déclarer"], ["declarees", "Déclarées"], ["toutes", "Toutes"]] as const;

  const sectionTabs = await orgTabs("conformite", id);
  return (
    <>
      <SiteHeader />
      <main className="stack">
        <SectionNav tabs={sectionTabs} active="hospitalites" label="Rubrique Conformité" />
        <div className="actions spread">
          <h1>Hospitalités</h1>
          <a className="btn ghost" href={`/organisations/${id}/hospitalites/export?statut=${statut}`}>Exporter (CSV)</a>
        </div>
        <p className="muted">
          Avantages acceptés par des professionnels de santé lors de vos événements. Chacun doit faire l&apos;objet d&apos;une convention
          d&apos;hospitalité et d&apos;une publication sur Transparence Santé. Les inscrits sans avantage n&apos;apparaissent pas ici.
        </p>
        <nav className="tabs">
          {tabs.map(([k, l]) => <Link key={k} href={`?statut=${k}`} className={k === statut ? "active" : ""}>{l}</Link>)}
        </nav>
        <div className="stats">
          <div className="card stat"><span className="muted">Bénéficiaires</span><strong>{regs.length}</strong></div>
          <div className="card stat"><span className="muted">Valeur totale</span><strong>{formatEUR(sum(regs))}</strong></div>
        </div>
        {regs.length === 0 && <p className="muted">Rien à afficher.</p>}
        {[...byEvent].map(([eventId, rs]) => (
          <section key={eventId} className="card">
            <h2>{rs[0].event.title}</h2>
            <p className="muted">{formatDate(rs[0].event.startsAt)} · {rs.length} bénéficiaire{rs.length > 1 ? "s" : ""} · {formatEUR(sum(rs))}</p>
            {rs.some(absent) && <p className="notice warn">{rs.filter(absent).length} bénéficiaire{rs.filter(absent).length > 1 ? "s" : ""} absent{rs.filter(absent).length > 1 ? "s" : ""} au pointage ({formatEUR(sum(rs.filter(absent)))}) : l&apos;avantage n&apos;a peut-être pas été consommé, vérifiez avant de déclarer.</p>}
            <table className="table" tabIndex={0}>
              <thead><tr><th>Bénéficiaire</th><th>Profession</th><th>Prestations</th><th>Valeur</th><th>Régime</th><th>Convention</th><th>Déclaration</th></tr></thead>
              <tbody>
                {rs.map((r) => (
                  <tr key={r.id}>
                    <td>{r.user.lastName.toUpperCase()} {r.user.firstName}{absent(r) && <> <span className="pill wait">Absent au pointage</span></>}</td>
                    <td>{r.profession}</td>
                    <td>{r.benefits.map((b) => b.benefit.label).join(", ")}</td>
                    <td>{formatEUR(r.benefits.reduce((s, b) => s + b.valueCents, 0))}</td>
                    <td>{(() => { const g = regimeOf(r); return <span className={`pill ${g.regime === "autorisation" ? "wait" : g.regime === "hors_france" ? "" : "ok"}`} title={g.reason}>{REGIME_LABEL[g.regime]}</span>; })()}</td>
                    <td><a href={`/organisations/${id}/hospitalites/convention/${r.id}`} target="_blank" rel="noreferrer">PDF</a></td>
                    <td>
                      <form action={markDeclared} className="inline">
                        <input type="hidden" name="orgId" value={id} />
                        <input type="hidden" name="registrationId" value={r.id} />
                        {r.declared ? (
                          <>
                            <span>Déclaré{r.declarationRef ? ` · ${r.declarationRef}` : ""}</span>
                            <input type="hidden" name="undo" value="1" />
                            <button className="link">annuler</button>
                          </>
                        ) : (
                          <>
                            <input name="declarationRef" placeholder="Réf. convention" aria-label="Référence" />
                            <button className="link">Marquer déclaré</button>
                          </>
                        )}
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </main>
    </>
  );
}
