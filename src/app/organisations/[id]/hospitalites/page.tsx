import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { SectionNav } from "@/components/SectionNav";
import { orgTabs } from "@/lib/org-overview";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/orgs";
import { COMPLIANCE_ROLES, EVENT_MANAGER_ROLES } from "@/lib/events";
import { markDeclared } from "@/lib/event-actions";
import { complianceSettings, foreignRegime, hospitalityRegime, REGIME_LABEL, regimeReason } from "@/lib/compliance";
import { practicesInFrance } from "@/lib/countries";
import { pointedPastEvents } from "@/lib/checkin";
import { isAbsent } from "@/lib/indicators";
import { TableWrap } from "@/components/TableWrap";
import { getT } from "@/lib/i18n/server";
import { fmtDate, fmtEur, intlLocale } from "@/lib/i18n";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: `${t("Hospitalités")} — KolBase` };
}

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ statut?: string }> }) {
  const { t, locale } = await getT();
  const { id } = await params;
  const { statut = "a-declarer" } = await searchParams;
  const { org, roles } = await requireMembership(id, COMPLIANCE_ROLES);
  // Le pointage relève de l'équipe organisatrice : le lien n'est montré qu'à elle.
  const canPoint = roles.some((r) => EVENT_MANAGER_ROLES.includes(r));

  // Uniquement les inscriptions de praticiens ayant accepté au moins une prestation.
  const all = await db.registration.findMany({
    where: {
      event: { organizationId: id },
      profession: { not: null },
      benefits: { some: {} },
      ...(statut === "declarees" ? { declared: true } : statut === "a-declarer" ? { declared: false } : {}),
    },
    include: { user: { include: { practitioner: { select: { country: true } } } }, event: true, benefits: { include: { benefit: true } } },
    orderBy: [{ event: { startsAt: "desc" } }, { createdAt: "asc" }],
  });
  // Événements passés pointés à l'accueil : un inscrit non pointé est absent, son avantage n'a pas été consommé.
  // Il n'est pas à déclarer (même règle que le fichier Transparence Santé) : « absent : non déclaré ».
  const pointed = await pointedPastEvents(all.map((r) => r.eventId));
  const absent = (r: (typeof all)[number]) => !r.declared && isAbsent(r, pointed.has(r.eventId));
  const regs = statut === "a-declarer" ? all.filter((r) => !absent(r)) : all;
  const counted = regs.filter((r) => !absent(r));
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
        <SectionNav tabs={sectionTabs} active="hospitalites" label={t("Rubrique Conformité")} />
        <div className="actions spread">
          <h1>{t("Hospitalités")}</h1>
          <a className="btn ghost" href={`/organisations/${id}/hospitalites/export?statut=${statut}`}>{t("Exporter (CSV)")}</a>
        </div>
        <p className="muted">
          {t("Avantages acceptés par des professionnels de santé lors de vos événements. Chacun doit faire l'objet d'une convention d'hospitalité et d'une publication sur Transparence Santé. Les inscrits sans avantage n'apparaissent pas ici.")}
        </p>
        <nav className="tabs">
          {tabs.map(([k, l]) => <Link key={k} href={`?statut=${k}`} className={k === statut ? "active" : ""}>{t(l)}</Link>)}
        </nav>
        <div className="stats">
          <div className="card stat"><span className="muted">{t("Bénéficiaires")}</span><strong>{counted.length}</strong></div>
          <div className="card stat"><span className="muted">{t("Valeur totale")}</span><strong>{fmtEur(locale, sum(counted))}{" "}{t("TTC")}</strong></div>
        </div>
        {regs.length === 0 && <p className="muted">{t("Rien à afficher.")}</p>}
        {[...byEvent].map(([eventId, rs]) => (
          <section key={eventId} className="card">
            <h2><Link href={`/organisations/${id}/evenements/${eventId}`}>{rs[0].event.title}</Link></h2>
            <p className="muted">{t(rs.filter((r) => !absent(r)).length > 1 ? "{date} · {n} bénéficiaires · {montant} TTC" : "{date} · {n} bénéficiaire · {montant} TTC", { date: fmtDate(locale, rs[0].event.startsAt), n: rs.filter((r) => !absent(r)).length, montant: fmtEur(locale, sum(rs.filter((r) => !absent(r)))) })}</p>
            {rs.some(absent) && <p className="notice warn">{t(rs.filter(absent).length > 1 ? "{n} inscrits absents au pointage ({montant} TTC) : avantage non consommé, non déclaré." : "{n} inscrit absent au pointage ({montant} TTC) : avantage non consommé, non déclaré.", { n: rs.filter(absent).length, montant: fmtEur(locale, sum(rs.filter(absent))) })}{" "}{canPoint ? <><Link href={`/organisations/${id}/evenements/${eventId}/pointage`}>{t("Corriger le pointage")}</Link>{" "}{t("si la personne était présente.")}</> : t("Si la personne était présente, l'équipe organisatrice peut corriger le pointage.")}</p>}
            <TableWrap label={t("Hospitalités")}>
              <table className="table">
                <thead><tr><th>{t("Bénéficiaire")}</th><th>{t("Profession")}</th><th>{t("Prestations")}</th><th>{t("Valeur")}</th><th>{t("Régime")}</th><th>{t("Convention")}</th><th>{t("Déclaration")}</th></tr></thead>
                <tbody>
                  {rs.map((r) => (
                    <tr key={r.id}>
                      <td data-label="Bénéficiaire">{r.user.lastName.toUpperCase()} {r.user.firstName}{absent(r) && <> <span className="pill wait">{t("Absent au pointage")}</span></>}</td>
                      <td data-label="Profession">{r.profession ? t(r.profession) : "—"}</td>
                      <td data-label="Prestations">{r.benefits.map((b) => t(b.benefit.label)).join(", ")}</td>
                      <td data-label="Valeur">{fmtEur(locale, r.benefits.reduce((s, b) => s + b.valueCents, 0))}{" "}{t("TTC")}</td>
                      <td data-label="Régime">{(() => { const g = regimeOf(r); return <span className={`pill ${g.regime === "autorisation" ? "wait" : g.regime === "hors_france" ? "" : "ok"}`} title={regimeReason(g, t, intlLocale(locale))}>{t(REGIME_LABEL[g.regime])}</span>; })()}</td>
                      <td data-label="Convention"><a href={`/organisations/${id}/hospitalites/convention/${r.id}`} target="_blank" rel="noreferrer">PDF</a></td>
                      <td data-label="Déclaration">
                        {absent(r) ? <span className="pill">{t("Absent : non déclaré")}</span> : (
                        <form action={markDeclared} className="inline">
                          <input type="hidden" name="orgId" value={id} />
                          <input type="hidden" name="registrationId" value={r.id} />
                          {r.declared ? (
                            <>
                              <span>{t("Déclaré")}{r.declarationRef ? ` · ${r.declarationRef}` : ""}</span>
                              <input type="hidden" name="undo" value="1" />
                              <button className="link">{t("annuler")}</button>
                            </>
                          ) : (
                            <>
                              <input name="declarationRef" placeholder={t("Réf. convention")} aria-label={t("Référence")} />
                              <button className="link">{t("Marquer déclaré")}</button>
                            </>
                          )}
                        </form>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </section>
        ))}
      </main>
    </>
  );
}
