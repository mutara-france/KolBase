import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { SectionNav } from "@/components/SectionNav";
import { orgTabs } from "@/lib/org-overview";
import { FmvBadge, StatusPill } from "@/components/ProjectBits";
import { ComplianceSettingsForm } from "@/components/ComplianceForms";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/orgs";
import { COMPLIANCE_ROLES, formatDate, formatEUR } from "@/lib/events";
import { collabType, STATUS_LABEL } from "@/lib/projects";
import { complianceSettings, foreignRegime, legalBound, remunerationRegime, REGIME_LABEL, SETTING_FIELDS, type Regime } from "@/lib/compliance";
import { country, practicesInFrance } from "@/lib/countries";
import { registerRows } from "@/lib/compliance-data";
import { markProjectPublished } from "@/lib/compliance-actions";
import { detectConflicts } from "@/lib/conflicts";

export const metadata = { title: "Conformité — KolBase" };

const TABS = [
  ["a-valider", "À valider"],
  ["autorisations", "Autorisations"],
  ["registre", "Registre des conventions"],
  ["transparence", "Transparence Santé"],
  ["parametres", "Paramètres"],
] as const;

function RegimePill({ regime, reason }: { regime: Regime; reason?: string }) {
  return <span className={`pill ${regime === "autorisation" ? "wait" : regime === "hors_france" ? "" : "ok"}`} title={reason}>{REGIME_LABEL[regime]}</span>;
}

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ onglet?: string; annee?: string }> }) {
  const { id } = await params;
  const { onglet = "a-valider", annee } = await searchParams;
  const { org, isAdmin, roles } = await requireMembership(id, COMPLIANCE_ROLES);
  const s = complianceSettings(org.complianceSettings);
  const year = annee === "toutes" ? null : Number(annee) || new Date().getFullYear();

  const projects = await db.project.findMany({
    where: { organizationId: id, status: { in: ["EN_VALID", "VALIDE", "ORDRE", "REFUS_ORDRE", "SIGNATURE", "SIGNE", "TERMINE"] } },
    include: { experts: { where: { status: { notIn: ["DECLINE", "ATT_EXPERTS"] } }, include: { practitioner: { include: { user: { select: { firstName: true, lastName: true } } } } } } },
    orderBy: { updatedAt: "desc" },
  });
  const regimeOf = (p: (typeof projects)[number]) => {
    const unit = collabType(p.typeId)?.unit ?? "";
    const rs = p.experts.map((e) => (practicesInFrance(e.practitioner.country) ? remunerationRegime(s, e.feeCents, e.days, unit) : foreignRegime(e.practitioner.country)));
    return rs.find((r) => r.regime === "autorisation") ?? rs[0] ?? { regime: "declaration" as Regime, reason: "Aucun expert engagé" };
  };
  const total = (p: (typeof projects)[number]) => p.experts.reduce((x, e) => x + (e.feeCents ?? 0), 0);
  const experts = (p: (typeof projects)[number]) =>
    p.experts.map((e) => `Dr ${e.practitioner.user.lastName}${practicesInFrance(e.practitioner.country) ? "" : ` (${country(e.practitioner.country).name})`}`).join(", ") || "—";
  const dossier = (pid: string) => `/organisations/${id}/dossiers/${pid}`;

  const toValidate = projects.filter((p) => p.status === "EN_VALID");
  const authorizations = projects.filter((p) => p.status === "ORDRE" || p.status === "REFUS_ORDRE" || (p.status === "VALIDE" && regimeOf(p).regime === "autorisation"));
  const toPublish = projects.filter((p) => ["SIGNE", "TERMINE"].includes(p.status));
  const counts: Record<string, number> = {
    "a-valider": toValidate.length,
    autorisations: authorizations.filter((p) => p.status !== "REFUS_ORDRE").length,
    transparence: toPublish.filter((p) => !p.declared).length,
  };

  // Onglets de la rubrique (un seul niveau) : les compteurs viennent de cette page pour ses propres onglets.
  const sectionTabs = (await orgTabs("conformite", id)).map((t) => (t.key in counts ? { ...t, count: counts[t.key] } : t.key === "hospitalites" || t.key === "relecture" ? t : { ...t, count: 0 }));
  return (
    <>
      <SiteHeader />
      <main className="stack">
        <SectionNav tabs={sectionTabs} active={onglet} label="Rubrique Conformité" />
        <h1>{TABS.find(([k]) => k === onglet)?.[1] ?? "Espace conformité"}</h1>
        {onglet === "a-valider" && (
          <p className="muted">
            Validation des dossiers et régime applicable (déclaration ou autorisation). Viennent ensuite la relecture des supports, les autorisations,
            les hospitalités, le registre des conventions et les publications Transparence Santé.
          </p>
        )}

        {onglet === "a-valider" && <ToValidate />}
        {onglet === "autorisations" && (
          <section className="card">
            <h2>Autorisations</h2>
            <p className="muted">
              Dossiers validés dont le montant dépasse un seuil d&apos;autorisation, et demandes en cours auprès de l&apos;Ordre. La demande doit être
              adressée au moins {s.authorizationDays} jours avant l&apos;exécution ; sous les seuils, une déclaration {s.declarationDays} jours ouvrables avant suffit.
            </p>
            {authorizations.length === 0 ? <p className="muted">Aucune autorisation en cours.</p> : (
              <table className="table" tabIndex={0}>
                <thead><tr><th>Dossier</th><th>Experts</th><th>Montant</th><th>Motif</th><th>Statut</th></tr></thead>
                <tbody>
                  {authorizations.map((p) => (
                    <tr key={p.id}>
                      <td><Link href={dossier(p.id)}>{p.title}</Link></td>
                      <td>{experts(p)}</td>
                      <td>{formatEUR(total(p))} HT</td>
                      <td>{regimeOf(p).reason}</td>
                      <td>{p.status === "VALIDE" ? <span className="pill wait">Demande à faire</span> : <StatusPill status={p.status} />}{p.ordreRef ? <span className="muted"> · {p.ordreRef}</span> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )}
        {onglet === "registre" && <Register />}
        {onglet === "transparence" && (
          <section className="card">
            <div className="actions spread">
              <h2>Transparence Santé</h2>
              <a className="btn ghost" href={`/organisations/${id}/conformite/export?type=transparence&annee=${year ?? "toutes"}`}>Exporter (CSV)</a>
            </div>
            <p className="muted">
              Conventions signées à publier sur la base Transparence Santé. Les hospitalités d&apos;événements se déclarent depuis la page{" "}
              <Link href={`/organisations/${id}/hospitalites`}>Hospitalités</Link>.
            </p>
            {toPublish.length === 0 ? <p className="muted">Aucune convention signée.</p> : (
              <table className="table" tabIndex={0}>
                <thead><tr><th>Dossier</th><th>Experts</th><th>Montant</th><th>Statut</th><th>Publication</th></tr></thead>
                <tbody>
                  {toPublish.map((p) => (
                    <tr key={p.id}>
                      <td><Link href={dossier(p.id)}>{p.title}</Link></td>
                      <td>{experts(p)}</td>
                      <td>{formatEUR(total(p))} HT</td>
                      <td><StatusPill status={p.status} /></td>
                      <td>
                        <form action={markProjectPublished} className="inline">
                          <input type="hidden" name="orgId" value={id} />
                          <input type="hidden" name="projectId" value={p.id} />
                          {p.declared ? (
                            <>
                              <span>Publié{p.declarationRef ? ` · ${p.declarationRef}` : ""}{p.declaredAt ? ` · ${formatDate(p.declaredAt)}` : ""}</span>
                              <input type="hidden" name="undo" value="1" />
                              <button className="link">annuler</button>
                            </>
                          ) : (
                            <>
                              <input name="ref" placeholder="Réf. de publication" aria-label="Référence" />
                              <button className="link">Marquer publié</button>
                            </>
                          )}
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )}
        {onglet === "parametres" && <ComplianceSettingsForm orgId={id} settings={s} fields={SETTING_FIELDS.map((f) => ({ ...f, legal: legalBound(f.key) }))} canEdit={isAdmin || roles.includes("CONFORMITE")} />}
      </main>
    </>
  );

  async function ToValidate() {
    const conflicts = await Promise.all(toValidate.map((p) => detectConflicts(p.id)));
    return (
      <section className="card">
        <h2>Dossiers à valider</h2>
        {toValidate.length === 0 ? <p className="muted">Aucun dossier en attente de validation.</p> : (
          <table className="table" tabIndex={0}>
            <thead><tr><th>Dossier</th><th>Experts</th><th>Montant</th><th>Juste contrepartie</th><th>Régime</th><th>Conflits</th><th>Soumis le</th></tr></thead>
            <tbody>
              {toValidate.map((p, i) => {
                const r = regimeOf(p);
                const c = conflicts[i];
                return (
                  <tr key={p.id}>
                    <td><Link href={dossier(p.id)}>{p.title}</Link><br /><span className="muted">{collabType(p.typeId)?.label ?? p.typeId}</span></td>
                    <td>{experts(p)}</td>
                    <td>{formatEUR(total(p))} HT</td>
                    <td>{p.experts.map((e) => <FmvBadge key={e.id} typeId={p.typeId} feeCents={e.feeCents} units={e.days} />)}</td>
                    <td><RegimePill regime={r.regime} reason={r.reason} /></td>
                    <td>{c.length ? <span className={`pill ${c.some((x) => x.severity === "danger") ? "bad" : "wait"}`}>{c.length}</span> : <span className="pill ok">Aucun</span>}</td>
                    <td>{formatDate(p.updatedAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    );
  }

  async function Register() {
    const rows = await registerRows(id, year, org.complianceSettings);
    const years = Array.from({ length: 4 }, (_, i) => new Date().getFullYear() - i);
    const sum = rows.reduce((x, r) => x + r.amountCents, 0);
    return (
      <section className="card">
        <div className="actions spread">
          <h2>Registre des conventions</h2>
          <a className="btn ghost" href={`/organisations/${id}/conformite/export?type=registre&annee=${year ?? "toutes"}`}>Exporter (CSV)</a>
        </div>
        <nav className="tabs">
          {years.map((y) => <Link key={y} href={`?onglet=registre&annee=${y}`} className={y === year ? "active" : ""}>{y}</Link>)}
          <Link href="?onglet=registre&annee=toutes" className={year === null ? "active" : ""}>Toutes</Link>
        </nav>
        <p className="muted">{rows.length} convention{rows.length > 1 ? "s" : ""} · {formatEUR(sum)} · {rows.filter((r) => r.regime === "autorisation").length} sous autorisation</p>
        {rows.length === 0 ? <p className="muted">Aucune convention sur la période.</p> : (
          <table className="table" tabIndex={0}>
            <thead><tr><th>Date</th><th>Bénéficiaire</th><th>Objet</th><th>Nature</th><th>Montant</th><th>Régime</th><th>Statut</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>{formatDate(r.date)}</td>
                  <td>{r.lastName.toUpperCase()} {r.firstName}{r.rpps ? <><br /><span className="muted">RPPS {r.rpps}</span></> : null}</td>
                  <td><Link href={r.href}>{r.subject}</Link></td>
                  <td>{r.nature}</td>
                  <td>{formatEUR(r.amountCents)}</td>
                  <td><RegimePill regime={r.regime} reason={r.reason} /></td>
                  <td>{r.status ? STATUS_LABEL[r.status as keyof typeof STATUS_LABEL] : "Hospitalité"}{r.declared ? " · publié" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    );
  }
}
