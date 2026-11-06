import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { SectionNav } from "@/components/SectionNav";
import { orgTabs } from "@/lib/org-overview";
import { StatusPill } from "@/components/ProjectBits";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/orgs";
import { PROPOSAL_ORIGIN, collabType, NEXT_ACTOR, PROJECT_ROLES, PROJECT_VIEW_ROLES, SOURCING_ROLES } from "@/lib/projects";
import { drPrefix } from "@/lib/professions";
import type { ProjectStatus } from "@/generated/prisma/client";
import { getT } from "@/lib/i18n/server";
import { fmtDate, fmtEur } from "@/lib/i18n";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: `${t("Dossiers")} — KolBase` };
}

const PER_PAGE = 50;

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ page?: string; etat?: string; vue?: string }> }) {
  const { t, locale } = await getT();
  const { id } = await params;
  const sp = await searchParams;
  const etat = sp.etat === "clos" ? "clos" : sp.etat === "tous" ? "tous" : "en-cours";
  const { roles, user } = await requireMembership(id, PROJECT_VIEW_ROLES);
  const canCreate = roles.some((r) => SOURCING_ROLES.includes(r));
  const isProject = roles.some((r) => PROJECT_ROLES.includes(r));
  const CLOSED: ProjectStatus[] = ["TERMINE", "DECLINE"];
  const OPEN = { status: { notIn: CLOSED } };
  const mine = { leads: { some: { userId: user.id } } };
  const unassigned = { leads: { none: {} } };
  // Vue par défaut : « Mes dossiers » pour qui est responsable d'au moins un dossier, sinon tous les dossiers.
  const [myTotal, unassignedOpen] = await Promise.all([
    isProject ? db.project.count({ where: { organizationId: id, ...mine } }) : Promise.resolve(0),
    db.project.count({ where: { organizationId: id, ...unassigned, ...OPEN } }),
  ]);
  const vue = sp.vue === "tous" ? "tous" : sp.vue === "sans" ? "sans" : sp.vue === "mes" && isProject ? "mes" : sp.vue ? "tous" : myTotal > 0 ? "mes" : "tous";
  const scope = { organizationId: id, ...(vue === "mes" ? mine : vue === "sans" ? unassigned : {}) };
  const where = { ...scope, ...(etat === "en-cours" ? OPEN : etat === "clos" ? { status: { in: CLOSED } } : {}) };
  const [total, openCount, closedCount] = await Promise.all([
    db.project.count({ where }),
    db.project.count({ where: { ...scope, ...OPEN } }),
    db.project.count({ where: { ...scope, status: { in: CLOSED } } }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const page = Math.min(pages, Math.max(1, Math.floor(Number(sp.page)) || 1));
  const include = {
    experts: { include: { practitioner: { include: { user: { select: { firstName: true, lastName: true } } } } } },
    leads: { include: { user: { select: { firstName: true, lastName: true } } }, orderBy: { createdAt: "asc" as const } },
  };
  const [projects, toAssign] = await Promise.all([
    db.project.findMany({ where, include, orderBy: { updatedAt: "desc" }, skip: (page - 1) * PER_PAGE, take: PER_PAGE }),
    // Dans « Mes dossiers » : les dossiers en cours sans responsable (projet proposé par un expert…) restent en vue.
    vue === "mes" && etat !== "clos" && unassignedOpen > 0 ? db.project.findMany({ where: { organizationId: id, ...unassigned, ...OPEN }, include, orderBy: { updatedAt: "desc" }, take: 5 }) : Promise.resolve([]),
  ]);
  const base = `/organisations/${id}/dossiers`;
  const href = (q: { vue?: string; etat?: string; page?: number }) => {
    const v = q.vue ?? vue;
    const params = new URLSearchParams({ vue: v, ...((q.etat ?? etat) !== "en-cours" ? { etat: q.etat ?? etat } : {}), ...(q.page && q.page > 1 ? { page: String(q.page) } : {}) });
    return `${base}?${params}`;
  };
  const sectionTabs = await orgTabs("dossiers", id);
  const views = [
    ...(isProject ? [["mes", t("Mes dossiers")] as const] : []),
    ["tous", t("Tous les dossiers")] as const,
    ...(unassignedOpen > 0 || vue === "sans" ? [["sans", t("Sans responsable ({n})", { n: unassignedOpen })] as const] : []),
  ];
  const filters = [["en-cours", t("En cours ({n})", { n: openCount })], ["clos", t("Clos ({n})", { n: closedCount })], ["tous", t("Tous")]] as const;
  const row = (p: (typeof projects)[number]) => {
    const live = p.experts.filter((e) => e.status !== "DECLINE");
    const engaged = live.filter((e) => e.status !== "ATT_EXPERTS").reduce((s, e) => s + (e.feeCents ?? 0), 0);
    const names = live.map((e) => `${drPrefix(e.practitioner.profession)}${e.practitioner.user.lastName}`);
    const leads = p.leads.map((l) => `${l.user.firstName} ${l.user.lastName}`);
    const actor = NEXT_ACTOR[p.status];
    return (
      <Link key={p.id} href={`${base}/${p.id}`} className="row-item">
        <span className="row-main">
          <strong>{p.title}</strong>
          <span className="muted text-sm">{p.origin === PROPOSAL_ORIGIN ? t("Projet proposé par l'expert · ") : ""}{t(collabType(p.typeId)?.label ?? p.typeId)}{names.length ? ` · ${names.slice(0, 3).join(", ")}${names.length > 3 ? ` +${names.length - 3}` : ""}` : ""}</span>
          <span className="text-xs muted">{leads.length ? t("Responsable : {names}", { names: leads.join(", ") }) : t("Sans responsable")}</span>
        </span>
        <span className="row-status">
          <StatusPill status={p.status} />
          {actor && <span className="text-xs muted">{t("À faire :")}{" "}<strong>{t(actor.who)}</strong>, {t(actor.what)}</span>}
        </span>
        <span className="row-figures">
          <strong>{fmtEur(locale, engaged)}{" "}{t("HT")}</strong>
          <span className="text-xs muted">{t("mis à jour le {date}", { date: fmtDate(locale, p.updatedAt) })}</span>
        </span>
      </Link>
    );
  };
  const empty =
    vue === "mes"
      ? etat === "clos" ? t("Aucun dossier clos dont vous êtes responsable.") : t("Aucun dossier en cours dont vous êtes responsable.")
      : vue === "sans" ? t("Tous les dossiers ont un responsable.")
      : etat === "clos" ? t("Aucun dossier clos.") : t("Aucun dossier en cours. Créez-en un, ou sollicitez un expert depuis l'annuaire.");
  return (
    <>
      <SiteHeader />
      <main className="stack">
        <SectionNav tabs={sectionTabs} active="dossiers" label={t("Rubrique Dossiers")} />
        <div className="actions spread">
          <h1>{t("Dossiers de collaboration")}</h1>
          {canCreate && <Link className="btn" href={`${base}/nouveau`}>{t("Nouveau dossier")}</Link>}
        </div>
        <nav className="tabs" aria-label={t("Dossiers affichés")}>
          {views.map(([k, l]) => <Link key={k} href={href({ vue: k, etat: "en-cours" })} className={k === vue ? "active" : ""} aria-current={k === vue ? "page" : undefined}>{l}</Link>)}
        </nav>
        <nav className="chips" aria-label={t("Filtrer les dossiers")}>
          {filters.map(([k, l]) => <Link key={k} href={href({ etat: k })} className={`chip${k === etat ? " active" : ""}`} aria-current={k === etat ? "true" : undefined}>{l}</Link>)}
        </nav>
        {toAssign.length > 0 && (
          <section className="card row-list" aria-labelledby="a-attribuer">
            <div className="block-head">
              <h2 id="a-attribuer" className="section-title">{t("À attribuer ({n})", { n: unassignedOpen })}</h2>
              {unassignedOpen > toAssign.length && <Link className="link text-sm" href={href({ vue: "sans", etat: "en-cours" })}>{t("Voir tout")}</Link>}
            </div>
            <p className="hint">{t("Dossiers en cours sans responsable, visibles de toute l'équipe Projets. Ouvrez-en un pour vous en désigner responsable ; le faire avancer vous l'attribue aussi.")}</p>
            {toAssign.map(row)}
          </section>
        )}
        {projects.length === 0 ? (
          <div className="card empty">
            <p className="muted">{empty}</p>
            {vue === "mes" && <Link className="link" href={href({ vue: "tous" })}>{t("Voir tous les dossiers")}</Link>}
          </div>
        ) : (
          <section className="card row-list">
            {projects.map(row)}
            {pages > 1 && (
              <nav className="pager" aria-label={t("Pages de dossiers")}>
                {page > 1 ? <Link href={href({ page: page - 1 })} className="btn ghost small" rel="prev">{t("Précédent")}</Link> : <span />}
                <span className="muted text-sm">{t("{total} dossiers · page {page} sur {pages}", { total, page, pages })}</span>
                {page < pages ? <Link href={href({ page: page + 1 })} className="btn ghost small" rel="next">{t("Suivant")}</Link> : <span />}
              </nav>
            )}
          </section>
        )}
      </main>
    </>
  );
}
