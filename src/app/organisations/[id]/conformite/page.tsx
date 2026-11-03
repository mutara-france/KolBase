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
import { complianceSettings, foreignRegime, hospitalityRegime, legalBound, remunerationRegime, REGIME_LABEL, SETTING_FIELDS, type Regime } from "@/lib/compliance";
import { country, practicesInFrance } from "@/lib/countries";
import { registerRows } from "@/lib/compliance-data";
import { markProjectPublished, markSemesterPublished } from "@/lib/compliance-actions";
import { detectConflicts } from "@/lib/conflicts";
import { declarationRows, parseSemester, recentSemesters, semesterKey, semesterLabel } from "@/lib/transparence";

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

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ onglet?: string; annee?: string; periode?: string }> }) {
  const { id } = await params;
  const { onglet = "a-valider", annee, periode } = await searchParams;
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
  // Hospitalités soumises à autorisation (praticiens exerçant en France) : événements à venir, ou passés et pas encore
  // déclarés ; l'avantage d'un absent au pointage n'est pas consommé, il n'est pas repris.
  const now = new Date();
  const hospRegs = await db.registration.findMany({
    where: { event: { organizationId: id }, profession: { not: null }, benefits: { some: {} }, OR: [{ event: { startsAt: { gte: now } } }, { declared: false }] },
    include: { user: { select: { firstName: true, lastName: true, practitioner: { select: { country: true } } } }, event: { select: { id: true, title: true, startsAt: true } }, benefits: { include: { benefit: { select: { catalogId: true } } } } },
    orderBy: { event: { startsAt: "asc" } },
  });
  const pointedEvents = new Set((await db.registration.groupBy({ by: ["eventId"], where: { event: { organizationId: id, startsAt: { lt: now } }, checkedInAt: { not: null } } })).map((g) => g.eventId));
  const hospAuthorizations = hospRegs
    .filter((r) => practicesInFrance(r.user.practitioner?.country ?? "FR") && !(pointedEvents.has(r.event.id) && !r.checkedInAt))
    .map((r) => ({ r, regime: hospitalityRegime(s, r.benefits.map((b) => ({ catalogId: b.benefit.catalogId, valueCents: b.valueCents }))) }))
    .filter((x) => x.regime.regime === "autorisation");
  const counts: Record<string, number> = {
    "a-valider": toValidate.length,
    autorisations: authorizations.filter((p) => p.status !== "REFUS_ORDRE").length + hospAuthorizations.filter((x) => x.r.event.startsAt >= now).length,
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
            <h2>Hospitalités soumises à autorisation</h2>
            <p className="muted">Conventions d&apos;hospitalité dont une prestation ou le total dépasse un seuil : l&apos;autorisation de l&apos;Ordre est à demander au moins {s.authorizationDays} jours avant l&apos;événement.</p>
            {hospAuthorizations.length === 0 ? <p className="muted">Aucune hospitalité soumise à autorisation.</p> : (
              <table className="table" tabIndex={0}>
                <thead><tr><th>Événement</th><th>Bénéficiaire</th><th>Valeur</th><th>Motif</th><th>Demande</th></tr></thead>
                <tbody>
                  {hospAuthorizations.map(({ r, regime }) => {
                    const by = new Date(r.event.startsAt.getTime() - s.authorizationDays * 864e5);
                    return (
                      <tr key={r.id}>
                        <td><Link href={`/organisations/${id}/evenements/${r.event.id}`}>{r.event.title}</Link><span className="muted"> · {formatDate(r.event.startsAt)}</span></td>
                        <td>{r.user.lastName.toUpperCase()} {r.user.firstName}</td>
                        <td>{formatEUR(r.benefits.reduce((x, b) => x + b.valueCents, 0))} TTC</td>
                        <td>{regime.reason}</td>
                        <td>{r.event.startsAt < now ? <span className="pill">Événement passé</span> : <span className={`pill ${by < now ? "bad" : "wait"}`}>{by < now ? "Délai dépassé" : `Avant le ${formatDate(by)}`}</span>}{" "}<a className="link" href={`/organisations/${id}/hospitalites/convention/${r.id}`} target="_blank" rel="noreferrer">convention</a></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
        )}
        {onglet === "registre" && <Register />}
        {onglet === "transparence" && <Declaration />}
        {onglet === "transparence" && (
          <section className="card">
            <div className="actions spread">
              <h2>Suivi des publications</h2>
              <a className="btn ghost" href={`/organisations/${id}/conformite/export?type=transparence&annee=${year ?? "toutes"}`}>Exporter (CSV)</a>
            </div>
            <p className="muted">
              Conventions de collaboration signées et leur publication sur Transparence Santé. Les hospitalités se suivent une à une dans la page{" "}
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

  async function Declaration() {
    const sem = parseSemester(periode) ?? recentSemesters()[0];
    const r = await declarationRows(id, sem);
    const base = `/organisations/${id}/conformite`;
    return (
      <section className="card stack-sm">
        <div className="card-head">
          <div>
            <h2>Préparer la déclaration</h2>
            <p className="muted">Une ligne par convention, rémunération et avantage, avec les libellés de la plateforme Transparence Santé : rémunérations et avantages sont rattachés à leur convention.</p>
          </div>
          <a className="btn" href={`${base}/declaration?periode=${semesterKey(sem)}`}>Télécharger le fichier ({r.rows.length} ligne{r.rows.length > 1 ? "s" : ""})</a>
        </div>
        <nav className="chips" aria-label="Semestre">
          {recentSemesters().map((x) => <Link key={semesterKey(x)} href={`?onglet=transparence&periode=${semesterKey(x)}`} className={`chip${semesterKey(x) === semesterKey(sem) ? " active" : ""}`}>{semesterLabel(x)}</Link>)}
        </nav>
        <dl className="hero-facts">
          <div><dt>Conventions</dt><dd>{r.conventions}<small>collaborations et hospitalités</small></dd></div>
          <div><dt>Rémunérations</dt><dd>{r.remunerations}<small>versées sur le semestre</small></dd></div>
          <div><dt>Avantages</dt><dd>{r.advantages}<small>hospitalités consommées</small></dd></div>
        </dl>
        {r.excludedAbsent > 0 && <p className="notice warn">{r.excludedAbsent} avantage{r.excludedAbsent > 1 ? "s" : ""} d&apos;inscrits absents au pointage {r.excludedAbsent > 1 ? "sont exclus" : "est exclu"} du fichier : vérifiez-les dans <Link href={`/organisations/${id}/hospitalites`}>Hospitalités</Link>.</p>}
        {r.rows.length > 0 && (
          <form action={markSemesterPublished} className="inline wrap">
            <input type="hidden" name="orgId" value={id} />
            <input type="hidden" name="periode" value={semesterKey(sem)} />
            <span className="text-sm">Fichier déposé sur la plateforme ?</span>
            <input name="ref" placeholder="Réf. du dépôt (facultatif)" aria-label="Référence du dépôt" />
            <button className="btn ghost small">Tout marquer publié</button>
          </form>
        )}
        <p className="hint">
          Seules les déclarations pas encore marquées publiées figurent dans le fichier ; montants arrondis à l&apos;euro, avantages et rémunérations de moins de 10 € écartés.
          Ouvrez le fichier dans un tableur, relisez-le, puis collez les lignes dans l&apos;écran « Déclarer » de la plateforme et marquez les déclarations publiées ci-dessous.
        </p>
      </section>
    );
  }

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
