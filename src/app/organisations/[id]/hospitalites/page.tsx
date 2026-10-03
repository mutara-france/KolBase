import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/orgs";
import { COMPLIANCE_ROLES, formatDate, formatEUR } from "@/lib/events";
import { markDeclared } from "@/lib/event-actions";

export const metadata = { title: "Hospitalités — Kolbase" };

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
    include: { user: true, event: true, benefits: { include: { benefit: true } } },
    orderBy: [{ event: { startsAt: "desc" } }, { createdAt: "asc" }],
  });
  const byEvent = new Map<string, typeof regs>();
  for (const r of regs) byEvent.set(r.eventId, [...(byEvent.get(r.eventId) ?? []), r]);
  const sum = (rs: typeof regs) => rs.reduce((s, r) => s + r.benefits.reduce((x, b) => x + b.valueCents, 0), 0);
  const tabs = [["a-declarer", "À déclarer"], ["declarees", "Déclarées"], ["toutes", "Toutes"]] as const;

  return (
    <>
      <SiteHeader />
      <main className="stack">
        <p className="muted"><Link href={`/organisations/${id}`}>{org.name}</Link> / Hospitalités</p>
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
            <table className="table">
              <thead><tr><th>Bénéficiaire</th><th>Profession</th><th>Prestations</th><th>Valeur</th><th>Déclaration</th></tr></thead>
              <tbody>
                {rs.map((r) => (
                  <tr key={r.id}>
                    <td>{r.user.lastName.toUpperCase()} {r.user.firstName}</td>
                    <td>{r.profession}</td>
                    <td>{r.benefits.map((b) => b.benefit.label).join(", ")}</td>
                    <td>{formatEUR(r.benefits.reduce((s, b) => s + b.valueCents, 0))}</td>
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
