import { BookOpen, CalendarCheck, FileSpreadsheet, FolderCheck, Gift, Send, Stamp } from "lucide-react";
import { SectionHead, PageHead } from "@/components/UI";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { SectionNav } from "@/components/SectionNav";
import { orgTabs } from "@/lib/org-overview";
import { FmvBadge, StatusPill } from "@/components/ProjectBits";
import { ComplianceSettingsForm, FeeGridForm } from "@/components/ComplianceForms";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/orgs";
import { COMPLIANCE_ROLES } from "@/lib/events";
import { collabType, fmvCheck, STATUS_LABEL } from "@/lib/projects";
import { validateProjectsInBulk } from "@/lib/project-actions";
import { ConfirmButton } from "@/components/ConfirmButton";
import { setEventReviewRequired } from "@/lib/event-actions";
import { complianceSettings, foreignRegime, hospitalityRegime, legalBound, remunerationRegime, REGIME_LABEL, regimeReason, SETTING_FIELDS, type Regime } from "@/lib/compliance";
import { country, practicesInFrance } from "@/lib/countries";
import { registerRows } from "@/lib/compliance-data";
import { markProjectPublished, markSemesterPublished } from "@/lib/compliance-actions";
import { detectConflicts } from "@/lib/conflicts";
import { pointedPastEvents } from "@/lib/checkin";
import { declarationRows, parseSemester, recentSemesters, semesterKey, semesterLabel } from "@/lib/transparence";
import { TableWrap } from "@/components/TableWrap";
import { getT } from "@/lib/i18n/server";
import { fmtDate, fmtEur, intlLocale } from "@/lib/i18n";
import { feeLevels } from "@/lib/fee-fields";
import { daysLate, reviewDue } from "@/lib/deadlines";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: `${t("Conformité")} — KolBase` };
}

const TABS = [
  ["a-valider", "À valider"],
  ["autorisations", "Autorisations"],
  ["registre", "Registre des conventions"],
  ["transparence", "Transparence Santé"],
  ["parametres", "Paramètres"],
] as const;

async function RegimePill({ regime, reason }: { regime: Regime; reason?: string }) {
  const { t } = await getT();
  return <span className={`pill ${regime === "autorisation" ? "wait" : regime === "hors_france" ? "" : "ok"}`} title={reason}>{t(REGIME_LABEL[regime])}</span>;
}

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ onglet?: string; annee?: string; periode?: string; valides?: string; sur?: string }> }) {
  const { t, locale } = await getT();
  const loc = intlLocale(locale);
  const { id } = await params;
  const { onglet = "a-valider", annee, periode, valides, sur } = await searchParams;
  const { org } = await requireMembership(id, COMPLIANCE_ROLES);
  const s = complianceSettings(org.complianceSettings);
  const year = annee === "toutes" ? null : Number(annee) || new Date().getFullYear();

  const projects = await db.project.findMany({
    where: { organizationId: id, status: { in: ["EN_VALID", "VALIDE", "ORDRE", "REFUS_ORDRE", "SIGNATURE", "SIGNE", "TERMINE"] } },
    include: { experts: { where: { status: { notIn: ["DECLINE", "ATT_EXPERTS"] } }, include: { practitioner: { include: { user: { select: { firstName: true, lastName: true } } } } } } },
    orderBy: { updatedAt: "desc" },
  });
  const regimeOf = (p: (typeof projects)[number]) => {
    const unit = collabType(p.typeId)?.unit ?? "";
    const rs = p.experts.map((e) => (practicesInFrance(e.practitioner.country) ? remunerationRegime(s, e, unit) : foreignRegime(e.practitioner.country)));
    return rs.find((r) => r.regime === "autorisation") ?? rs[0] ?? { regime: "declaration" as Regime, reason: "Aucun expert engagé", why: { key: "Aucun expert engagé" } };
  };
  const total = (p: (typeof projects)[number]) => p.experts.reduce((x, e) => x + (e.feeCents ?? 0), 0);
  const experts = (p: (typeof projects)[number]) =>
    p.experts.map((e) => `Dr ${e.practitioner.user.lastName}${practicesInFrance(e.practitioner.country) ? "" : ` (${country(e.practitioner.country).name})`}`).join(", ") || "—";
  const dossier = (pid: string) => `/organisations/${id}/dossiers/${pid}`;

  const toValidate = projects.filter((p) => p.status === "EN_VALID");
  // Événements soumis (lieu, date, programme, hospitalités), avant publication ou après une modification.
  const eventsToValidate = org.eventReview
    ? await db.event.findMany({ where: { organizationId: id, reviewStatus: "submitted", cancelledAt: null, internal: false }, include: { benefits: { select: { catalogId: true, valueCents: true } } }, orderBy: { reviewSubmittedAt: "asc" } })
    : [];
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
  const pointedEvents = await pointedPastEvents(hospRegs.map((r) => r.event.id), now);
  const hospAuthorizations = hospRegs
    .filter((r) => practicesInFrance(r.user.practitioner?.country ?? "FR") && !(pointedEvents.has(r.event.id) && !r.checkedInAt))
    .map((r) => ({ r, regime: hospitalityRegime(s, r.benefits.map((b) => ({ catalogId: b.benefit.catalogId, valueCents: b.valueCents }))) }))
    .filter((x) => x.regime.regime === "autorisation");
  const counts: Record<string, number> = {
    "a-valider": toValidate.length + eventsToValidate.length,
    autorisations: authorizations.filter((p) => p.status !== "REFUS_ORDRE").length + hospAuthorizations.filter((x) => x.r.event.startsAt >= now).length,
    transparence: toPublish.filter((p) => !p.declared).length,
  };

  // Onglets de la rubrique (un seul niveau) : les compteurs viennent de cette page pour ses propres onglets.
  const sectionTabs = (await orgTabs("conformite", id)).map((tk) => (tk.key in counts ? { ...tk, count: counts[tk.key] } : tk.key === "hospitalites" || tk.key === "relecture" ? tk : { ...tk, count: 0 }));
  return (
    <>
      <SiteHeader />
      <main className="stack">
        <SectionNav tabs={sectionTabs} active={onglet} label={t("Rubrique Conformité")} />
        <PageHead title={t(TABS.find(([k]) => k === onglet)?.[1] ?? "Espace conformité")} />

        {onglet === "a-valider" && valides != null && (
          <p className="notice ok" role="status">
            {t("{n} dossier(s) validé(s) sur {total}.", { n: Number(valides) || 0, total: Number(sur) || 0 })}
            {Number(valides) < Number(sur) ? ` ${t("Les autres restent à examiner : soumis par vous-même (quatre yeux) ou déjà traités.")}` : ""}
          </p>
        )}
        {onglet === "a-valider" && <ToValidate />}
        {onglet === "autorisations" && (
          <section className="card">
            <SectionHead icon={Stamp} title={t("Autorisations")} />
            <p className="muted">
              {t("Dossiers validés dont le montant dépasse un seuil d'autorisation, et demandes en cours auprès de l'Ordre. La demande doit être adressée au moins {authorizationDays} jours avant l'exécution ; sous les seuils, une déclaration {declarationDays} jours ouvrables avant suffit.", { authorizationDays: s.authorizationDays, declarationDays: s.declarationDays })}
            </p>
            {authorizations.length === 0 ? <p className="muted">{t("Aucune autorisation en cours.")}</p> : (
              <TableWrap label={t("Autorisations")}>
                <table className="table">
                  <thead><tr><th>{t("Dossier")}</th><th>{t("Experts")}</th><th>{t("Montant")}</th><th>{t("Motif")}</th><th>{t("Statut")}</th></tr></thead>
                  <tbody>
                    {authorizations.map((p) => (
                      <tr key={p.id}>
                        <td data-label="Dossier"><Link href={dossier(p.id)}>{p.title}</Link></td>
                        <td data-label="Experts">{experts(p)}</td>
                        <td data-label="Montant">{fmtEur(locale, total(p))}{" "}{t("HT")}</td>
                        <td data-label="Motif">{regimeReason(regimeOf(p), t, loc)}</td>
                        <td data-label="Statut">{p.status === "VALIDE" ? <span className="pill wait">{t("Demande à faire")}</span> : <StatusPill status={p.status} />}{p.ordreRef ? <span className="muted"> · {p.ordreRef}</span> : null}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
            <SectionHead icon={Gift} title={t("Hospitalités soumises à autorisation")} desc={t("Conventions d'hospitalité dont une prestation ou le total dépasse un seuil : l'autorisation de l'Ordre est à demander au moins {authorizationDays} jours avant l'événement.", { authorizationDays: s.authorizationDays })} />
            {hospAuthorizations.length === 0 ? <p className="muted">{t("Aucune hospitalité soumise à autorisation.")}</p> : (
              <TableWrap label={t("Hospitalités soumises à autorisation")}>
                <table className="table">
                  <thead><tr><th>{t("Événement")}</th><th>{t("Bénéficiaire")}</th><th>{t("Valeur")}</th><th>{t("Motif")}</th><th>{t("Demande")}</th></tr></thead>
                  <tbody>
                    {hospAuthorizations.map(({ r, regime }) => {
                      const by = new Date(r.event.startsAt.getTime() - s.authorizationDays * 864e5);
                      return (
                        <tr key={r.id}>
                          <td data-label="Événement"><Link href={`/organisations/${id}/evenements/${r.event.id}`}>{r.event.title}</Link><span className="muted"> · {fmtDate(locale, r.event.startsAt)}</span></td>
                          <td data-label="Bénéficiaire">{r.user.lastName.toUpperCase()} {r.user.firstName}</td>
                          <td data-label="Valeur">{t("{amount} TTC", { amount: fmtEur(locale, r.benefits.reduce((x, b) => x + b.valueCents, 0)) })}</td>
                          <td data-label="Motif">{regimeReason(regime, t, loc)}</td>
                          <td data-label="Demande">{r.event.startsAt < now ? <span className="pill">{t("Événement passé")}</span> : <span className={`pill ${by < now ? "bad" : "wait"}`}>{by < now ? t("Délai dépassé") : t("Avant le {date}", { date: fmtDate(locale, by) })}</span>}{" "}<a className="link" href={`/organisations/${id}/hospitalites/convention/${r.id}`} target="_blank" rel="noreferrer">{t("convention")}</a></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </section>
        )}
        {onglet === "registre" && <Register />}
        {onglet === "transparence" && <Declaration />}
        {onglet === "transparence" && (() => {
          // Belgique : publication annuelle sur betransparent.be des avantages accordés aux praticiens qui y exercent.
          const y = new Date().getUTCFullYear();
          return (
            <section className="card stack-sm" id="betransparent">
              <SectionHead icon={Send} title={t("Belgique : betransparent.be")} desc={t("Primes et avantages accordés dans l'année aux praticiens exerçant en Belgique (hospitalités consommées, honoraires versés), avec leur numéro INAMI et le visa Mdeon. Publication annuelle, y compris pour une entreprise établie hors de Belgique.")} />
              <div className="actions">
                {[y - 1, y].map((yy) => <a key={yy} className="btn ghost small" href={`/organisations/${id}/conformite/betransparent?annee=${yy}`}>{t("Préparer {year} (CSV)", { year: yy })}</a>)}
              </div>
              <p className="hint">{t("Fichier de préparation au format KolBase : reportez ses lignes dans le modèle de la plateforme.")}</p>
            </section>
          );
        })()}
        {onglet === "transparence" && (
          <section className="card">
            <SectionHead icon={Send} title={t("Suivi des publications")} desc={t("Dossiers à publier sur la plateforme Transparence Santé, et ceux déjà publiés.")}>
              <a className="btn ghost small" href={`/organisations/${id}/conformite/export?type=transparence&annee=${year ?? "toutes"}`}>{t("Exporter (CSV)")}</a>
            </SectionHead>
            <p className="muted">
              {t("Conventions de collaboration signées et leur publication sur Transparence Santé. Les hospitalités se suivent une à une dans la page")}
              <Link href={`/organisations/${id}/hospitalites`}>{t("Hospitalités")}</Link>.
            </p>
            {toPublish.length === 0 ? <p className="muted">{t("Aucune convention signée.")}</p> : (
              <TableWrap label={t("Suivi des publications")}>
                <table className="table">
                  <thead><tr><th>{t("Dossier")}</th><th>{t("Experts")}</th><th>{t("Montant")}</th><th>{t("Statut")}</th><th>{t("Publication")}</th></tr></thead>
                  <tbody>
                    {toPublish.map((p) => (
                      <tr key={p.id}>
                        <td data-label="Dossier"><Link href={dossier(p.id)}>{p.title}</Link></td>
                        <td data-label="Experts">{experts(p)}</td>
                        <td data-label="Montant">{fmtEur(locale, total(p))}{" "}{t("HT")}</td>
                        <td data-label="Statut"><StatusPill status={p.status} /></td>
                        <td data-label="Publication">
                          <form action={markProjectPublished} className="inline">
                            <input type="hidden" name="orgId" value={id} />
                            <input type="hidden" name="projectId" value={p.id} />
                            {p.declared ? (
                              <>
                                <span>{t("Publié")}{p.declarationRef ? ` · ${p.declarationRef}` : ""}{p.declaredAt ? ` · ${fmtDate(locale, p.declaredAt)}` : ""}</span>
                                <input type="hidden" name="undo" value="1" />
                                <button className="link">{t("annuler")}</button>
                              </>
                            ) : (
                              <>
                                <input name="ref" placeholder={t("Réf. de publication")} aria-label={t("Référence")} />
                                <button className="link">{t("Marquer publié")}</button>
                              </>
                            )}
                          </form>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </section>
        )}
        {onglet === "parametres" && (
          <>
            <FeeGridForm orgId={id} levels={await feeLevels(id)} hourlyMax={s.remunerationHourlyMax} />
            <section className="card stack-sm" id="validation-evenements">
              <SectionHead icon={CalendarCheck} title={t("Validation des événements")} desc={t("Avant sa publication, la conformité valide le lieu, la date, le programme et les hospitalités de chaque événement ouvert aux praticiens ; un changement de date, de lieu, de format ou d'hospitalités le lui renvoie. Les réunions internes n'y sont pas soumises, les événements d'un dossier sont validés avec lui.")} />
              <form action={setEventReviewRequired} className="stack-sm">
                <input type="hidden" name="orgId" value={id} />
                <label className="check"><input type="checkbox" name="eventReview" value="1" defaultChecked={org.eventReview} />{" "}{t("Valider les événements avant leur publication")}</label>
                <button className="btn ghost small">{t("Enregistrer")}</button>
              </form>
            </section>
            <ComplianceSettingsForm orgId={id} settings={s} fields={SETTING_FIELDS.map((f) => ({ ...f, legal: legalBound(f.key) }))} canEdit />
          </>
        )}
      </main>
    </>
  );

  async function Declaration() {
    const { t } = await getT();
    const sem = parseSemester(periode) ?? recentSemesters()[0];
    const r = await declarationRows(id, sem);
    const base = `/organisations/${id}/conformite`;
    return (
      <section className="card stack-sm">
        <SectionHead icon={FileSpreadsheet} title={t("Préparer la déclaration")} desc={t("Une ligne par convention, rémunération et avantage, avec les libellés de la plateforme Transparence Santé : rémunérations et avantages sont rattachés à leur convention.")}>
<a className="btn" href={`${base}/declaration?periode=${semesterKey(sem)}`}>{t(r.rows.length > 1 ? "Télécharger le fichier ({rows} lignes)" : "Télécharger le fichier ({rows} ligne)", { rows: r.rows.length })}</a>
</SectionHead>
        <nav className="chips" aria-label={t("Semestre")}>
          {recentSemesters().map((x) => <Link key={semesterKey(x)} href={`?onglet=transparence&periode=${semesterKey(x)}`} className={`chip${semesterKey(x) === semesterKey(sem) ? " active" : ""}`}>{t(semesterLabel(x))}</Link>)}
        </nav>
        <dl className="hero-facts">
          <div><dt>{t("Conventions")}</dt><dd>{r.conventions}<small>{t("collaborations et hospitalités")}</small></dd></div>
          <div><dt>{t("Rémunérations")}</dt><dd>{r.remunerations}<small>{t("versées sur le semestre")}</small></dd></div>
          <div><dt>{t("Avantages")}</dt><dd>{r.advantages}<small>{t("hospitalités consommées")}</small></dd></div>
        </dl>
        {r.excludedAbsent > 0 && <p className="notice warn">{t(r.excludedAbsent > 1 ? "{excludedAbsent} avantages d'inscrits absents au pointage" : "{excludedAbsent} avantage d'inscrits absents au pointage", { excludedAbsent: r.excludedAbsent })}{" "}{r.excludedAbsent > 1 ? t("sont exclus") : t("est exclu")}{" "}{t("du fichier : vérifiez-les dans")}{" "}<Link href={`/organisations/${id}/hospitalites`}>{t("Hospitalités")}</Link>.</p>}
        {r.rows.length > 0 && (
          <form action={markSemesterPublished} className="inline wrap">
            <input type="hidden" name="orgId" value={id} />
            <input type="hidden" name="periode" value={semesterKey(sem)} />
            <span className="text-sm">{t("Fichier déposé sur la plateforme ?")}</span>
            <input name="ref" placeholder={t("Réf. du dépôt (facultatif)")} aria-label={t("Référence du dépôt")} />
            <button className="btn ghost small">{t("Tout marquer publié")}</button>
          </form>
        )}
        <p className="hint">
          {t("Seules les déclarations pas encore marquées publiées figurent dans le fichier ; montants arrondis à l'euro, avantages et rémunérations de moins de 10 € écartés. Ouvrez le fichier dans un tableur, relisez-le, puis collez les lignes dans l'écran « Déclarer » de la plateforme et marquez les déclarations publiées ci-dessous.")}
        </p>
      </section>
    );
  }

  async function ToValidate() {
    const { t, locale } = await getT();
    const conflicts = await Promise.all(toValidate.map((p) => detectConflicts(p.id)));
    // File de traitement : par échéance d'examen (les plus pressés d'abord), avec les drapeaux qui appellent un
    // regard humain — honoraires hors fourchette, régime d'autorisation, expert hors France, conflit d'intérêts.
    // Les dossiers sans drapeau peuvent être validés en série ; le contrôle à quatre yeux s'applique à chacun.
    const flagsOf = (p: (typeof toValidate)[number], c: (typeof conflicts)[number]) => {
      const r = regimeOf(p);
      const out: string[] = [];
      if (p.experts.some((e) => fmvCheck(p.typeId, e.feeCents, e.days)?.verdict === "above")) out.push(t("honoraires au-dessus de la fourchette"));
      if (r.regime === "autorisation") out.push(t("autorisation de l'Ordre requise"));
      if (p.experts.some((e) => !practicesInFrance(e.practitioner.country))) out.push(t("expert exerçant hors de France"));
      if (c.length) out.push(t(c.length > 1 ? "{n} conflits d'intérêts" : "{n} conflit d'intérêts", { n: c.length }));
      if (!p.plannedAt) out.push(t("date d'intervention absente"));
      return out;
    };
    const queue = toValidate
      .map((p, i) => ({ p, c: conflicts[i], flags: flagsOf(p, conflicts[i]), due: reviewDue(p.submittedAt ?? p.updatedAt, s) }))
      .sort((a, b) => (a.due?.getTime() ?? 0) - (b.due?.getTime() ?? 0));
    const clean = queue.filter((q) => q.flags.length === 0);
    return (
      <>
      <section className="card">
        <SectionHead icon={FolderCheck} title={t("Dossiers à valider")} desc={toValidate.length ? t("Par échéance d'examen. Les dossiers sans drapeau peuvent être validés en série ; chacun reste soumis au contrôle à quatre yeux.") : undefined} />
        {clean.length > 1 && (
          <form action={validateProjectsInBulk} className="inline wrap">
            <input type="hidden" name="orgId" value={id} />
            {clean.map((q) => <input key={q.p.id} type="hidden" name="projectId" value={q.p.id} />)}
            <ConfirmButton className="btn small" confirm={t("valider {n} dossiers sans drapeau", { n: clean.length })} summary={t("Chaque dossier passe « Validé par la conformité » ; ceux que vous avez vous-même soumis sont laissés de côté (quatre yeux). Les équipes et les experts sont prévenus.")} localized>
              {t("Valider les {n} dossiers sans drapeau", { n: clean.length })}
            </ConfirmButton>
          </form>
        )}
        {toValidate.length === 0 ? <p className="muted">{t("Aucun dossier en attente de validation.")}</p> : (
          <TableWrap label={t("Dossiers à valider")}>
            <table className="table">
              <thead><tr><th>{t("Dossier")}</th><th>{t("Experts")}</th><th>{t("Montant")}</th><th>{t("Juste contrepartie")}</th><th>{t("Régime")}</th><th>{t("Conflits")}</th><th>{t("Drapeaux")}</th><th>{t("Soumis le")}</th><th>{t("Échéance")}</th></tr></thead>
              <tbody>
                {queue.map(({ p, c, flags }) => {
                  const r = regimeOf(p);
                  return (
                    <tr key={p.id}>
                      <td data-label="Dossier"><Link href={dossier(p.id)}>{p.title}</Link><br /><span className="muted">{t(collabType(p.typeId)?.label ?? p.typeId)}</span></td>
                      <td data-label="Experts">{experts(p)}</td>
                      <td data-label="Montant">{fmtEur(locale, total(p))}{" "}{t("HT")}</td>
                      <td data-label="Juste contrepartie">{p.experts.map((e) => <FmvBadge key={e.id} typeId={p.typeId} feeCents={e.feeCents} units={e.days} />)}</td>
                      <td data-label="Régime"><RegimePill regime={r.regime} reason={regimeReason(r, t, loc)} /></td>
                      <td data-label="Conflits">{c.length ? <span className={`pill ${c.some((x) => x.severity === "danger") ? "bad" : "wait"}`}>{c.length}</span> : <span className="pill ok">{t("Aucun")}</span>}</td>
                      <td data-label="Soumis le">{fmtDate(locale, p.submittedAt ?? p.updatedAt)}{p.firstValidatedById && <><br /><span className="pill wait">{t("1re validation faite")}</span></>}</td>
                      <td data-label="Drapeaux">{flags.length ? <span className="text-sm">{flags.join(" · ")}</span> : <span className="pill ok">{t("Aucun")}</span>}</td>
                      <td data-label="Soumis le">{fmtDate(locale, p.submittedAt ?? p.updatedAt)}</td>
                      {/* Délai interne d'examen (Paramètres) : en retard, signalé. */}
                      <td data-label="Échéance">{(() => {
                        const due = reviewDue(p.submittedAt ?? p.updatedAt, s);
                        if (!due) return "—";
                        const late = daysLate(due);
                        return late > 0 ? <span className="pill bad">{t("En retard de {n} j", { n: late })}</span> : <span className="pill wait">{fmtDate(locale, due)}</span>;
                      })()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </section>
      {org.eventReview && (
        <section className="card" id="evenements">
          <SectionHead icon={CalendarCheck} title={t("Événements à valider")} desc={t("Lieu, date, programme et hospitalités, avant la publication dans l'agenda ou après une modification. Les événements d'un dossier sont validés avec le dossier.")} />
          {eventsToValidate.length === 0 ? <p className="muted">{t("Aucun événement en attente de validation.")}</p> : (
            <TableWrap label={t("Événements à valider")}>
              <table className="table">
                <thead><tr><th>{t("Événement")}</th><th>{t("Date")}</th><th>{t("Lieu")}</th><th>{t("Programme")}</th><th>{t("Hospitalités")}</th><th>{t("Soumis le")}</th><th>{t("Échéance")}</th></tr></thead>
                <tbody>
                  {eventsToValidate.map((e) => {
                    const hosp = hospitalityRegime(s, e.benefits);
                    const due = reviewDue(e.reviewSubmittedAt ?? e.updatedAt, s);
                    const late = due ? daysLate(due) : 0;
                    return (
                      <tr key={e.id}>
                        <td data-label="Événement"><Link href={`/organisations/${id}/evenements/${e.id}#validation`}>{e.title}</Link>{e.reviewChanges.length > 0 && <><br /><span className="muted">{t("Modifié après validation : {changes}", { changes: e.reviewChanges.map((c) => t(c)).join(", ") })}</span></>}</td>
                        <td data-label="Date">{fmtDate(locale, e.startsAt)}</td>
                        <td data-label="Lieu">{e.format === "DISTANCIEL" ? t("À distance") : [e.venue, e.city].filter(Boolean).join(", ") || "—"}</td>
                        <td data-label="Programme">{e.program ? <span className="pill ok">{t("Renseigné")}</span> : <span className="pill wait">{t("À compléter")}</span>}</td>
                        <td data-label="Hospitalités">{e.benefits.length === 0 ? t("Aucune") : <>{fmtEur(locale, e.benefits.reduce((x, b) => x + b.valueCents, 0))}{" "}<RegimePill regime={hosp.regime} reason={regimeReason(hosp, t, loc)} /></>}</td>
                        <td data-label="Soumis le">{fmtDate(locale, e.reviewSubmittedAt ?? e.updatedAt)}</td>
                        <td data-label="Échéance">{!due ? "—" : late > 0 ? <span className="pill bad">{t("En retard de {n} j", { n: late })}</span> : <span className="pill wait">{fmtDate(locale, due)}</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          )}
        </section>
      )}
      </>
    );
  }

  async function Register() {
    const { t, locale } = await getT();
    const rows = await registerRows(id, year, org.complianceSettings);
    const years = Array.from({ length: 4 }, (_, i) => new Date().getFullYear() - i);
    const sum = rows.reduce((x, r) => x + r.amountCents, 0);
    return (
      <section className="card">
        <SectionHead icon={BookOpen} title={t("Registre des conventions")} desc={t("Toutes les conventions signées, avec leur régime et leurs montants.")}>
          <a className="btn ghost small" href={`/organisations/${id}/conformite/export?type=registre&annee=${year ?? "toutes"}`}>{t("Exporter (CSV)")}</a>
        </SectionHead>
        <nav className="tabs">
          {years.map((y) => <Link key={y} href={`?onglet=registre&annee=${y}`} className={y === year ? "active" : ""}>{y}</Link>)}
          <Link href="?onglet=registre&annee=toutes" className={year === null ? "active" : ""}>{t("Toutes")}</Link>
        </nav>
        <p className="muted">{t(rows.length > 1 ? "{rows} conventions · {montant} · {n} sous autorisation" : "{rows} convention · {montant} · {n} sous autorisation", { rows: rows.length, montant: fmtEur(locale, sum), n: rows.filter((r) => r.regime === "autorisation").length })}</p>
        {rows.length === 0 ? <p className="muted">{t("Aucune convention sur la période.")}</p> : (
          <TableWrap label={t("Registre des conventions")}>
            <table className="table">
              <thead><tr><th>{t("Date")}</th><th>{t("Bénéficiaire")}</th><th>{t("Objet")}</th><th>{t("Nature")}</th><th>{t("Montant")}</th><th>{t("Régime")}</th><th>{t("Statut")}</th></tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td data-label="Date">{fmtDate(locale, r.date)}</td>
                    <td data-label="Bénéficiaire">{r.lastName.toUpperCase()} {r.firstName}{r.rpps ? <><br /><span className="muted">RPPS {r.rpps}</span></> : null}</td>
                    <td data-label="Objet"><Link href={r.href}>{r.subject}</Link></td>
                    <td data-label="Nature">{r.benefits ? t("Hospitalité : {list}", { list: r.benefits.map((b) => t(b)).join(", ") }) : t(r.nature)}</td>
                    <td data-label="Montant">{fmtEur(locale, r.amountCents)}</td>
                    <td data-label="Régime"><RegimePill regime={r.regime} reason={regimeReason(r, t, loc)} /></td>
                    <td data-label="Statut">{r.status ? t(STATUS_LABEL[r.status as keyof typeof STATUS_LABEL]) : t("Hospitalité")}{r.declared ? t(" · publié") : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </section>
    );
  }
}
