import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { SectionNav } from "@/components/SectionNav";
import { orgTabs } from "@/lib/org-overview";
import { StatusPill } from "@/components/ProjectBits";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/orgs";
import { PROPOSAL_ORIGIN, collabType, NEXT_ACTOR, PROJECT_VIEW_ROLES, SOURCING_ROLES } from "@/lib/projects";
import { drPrefix } from "@/lib/professions";
import type { ProjectStatus } from "@/generated/prisma/client";
import { getT } from "@/lib/i18n/server";
import { fmtDate, fmtEur } from "@/lib/i18n";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: `${t("Dossiers")} — KolBase` };
}

const PER_PAGE = 50;

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ page?: string; etat?: string }> }) {
  const { t, locale } = await getT();
  const { id } = await params;
  const sp = await searchParams;
  const etat = sp.etat === "clos" ? "clos" : sp.etat === "tous" ? "tous" : "en-cours";
  const { roles } = await requireMembership(id, PROJECT_VIEW_ROLES);
  const canCreate = roles.some((r) => SOURCING_ROLES.includes(r));
  const CLOSED: ProjectStatus[] = ["TERMINE", "DECLINE"];
  const where = { organizationId: id, ...(etat === "en-cours" ? { status: { notIn: CLOSED } } : etat === "clos" ? { status: { in: CLOSED } } : {}) };
  const [total, openCount, closedCount] = await Promise.all([
    db.project.count({ where }),
    db.project.count({ where: { organizationId: id, status: { notIn: CLOSED } } }),
    db.project.count({ where: { organizationId: id, status: { in: CLOSED } } }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const page = Math.min(pages, Math.max(1, Math.floor(Number(sp.page)) || 1));
  const projects = await db.project.findMany({
    where,
    include: { experts: { include: { practitioner: { include: { user: { select: { firstName: true, lastName: true } } } } } } },
    orderBy: { updatedAt: "desc" },
    skip: (page - 1) * PER_PAGE,
    take: PER_PAGE,
  });
  const base = `/organisations/${id}/dossiers`;
  const pageHref = (n: number) => `${base}?etat=${etat}${n > 1 ? `&page=${n}` : ""}`;
  const sectionTabs = await orgTabs("dossiers", id);
  const filters = [["en-cours", t("En cours ({n})", { n: openCount })], ["clos", t("Clos ({n})", { n: closedCount })], ["tous", t("Tous")]] as const;
  return (
    <>
      <SiteHeader />
      <main className="stack">
        <SectionNav tabs={sectionTabs} active="dossiers" label={t("Rubrique Dossiers")} />
        <div className="actions spread">
          <h1>{t("Dossiers de collaboration")}</h1>
          {canCreate && <Link className="btn" href={`${base}/nouveau`}>{t("Nouveau dossier")}</Link>}
        </div>
        <nav className="tabs" aria-label={t("Filtrer les dossiers")}>
          {filters.map(([k, l]) => <Link key={k} href={`${base}?etat=${k}`} className={k === etat ? "active" : ""}>{l}</Link>)}
        </nav>
        {projects.length === 0 ? (
          <div className="card empty"><p className="muted">{etat === "clos" ? t("Aucun dossier clos.") : t("Aucun dossier en cours. Créez-en un, ou sollicitez un expert depuis l'annuaire.")}</p></div>
        ) : (
          <section className="card row-list">
            {projects.map((p) => {
              const live = p.experts.filter((e) => e.status !== "DECLINE");
              const engaged = live.filter((e) => e.status !== "ATT_EXPERTS").reduce((s, e) => s + (e.feeCents ?? 0), 0);
              const names = live.map((e) => `${drPrefix(e.practitioner.profession)}${e.practitioner.user.lastName}`);
              const actor = NEXT_ACTOR[p.status];
              return (
                <Link key={p.id} href={`${base}/${p.id}`} className="row-item">
                  <span className="row-main">
                    <strong>{p.title}</strong>
                    <span className="muted text-sm">{p.origin === PROPOSAL_ORIGIN ? t("Projet proposé par l'expert · ") : ""}{t(collabType(p.typeId)?.label ?? p.typeId)}{names.length ? ` · ${names.slice(0, 3).join(", ")}${names.length > 3 ? ` +${names.length - 3}` : ""}` : ""}</span>
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
            })}
            {pages > 1 && (
              <nav className="pager" aria-label={t("Pages de dossiers")}>
                {page > 1 ? <Link href={pageHref(page - 1)} className="btn ghost small" rel="prev">{t("Précédent")}</Link> : <span />}
                <span className="muted text-sm">{t("{total} dossiers · page {page} sur {pages}", { total, page, pages })}</span>
                {page < pages ? <Link href={pageHref(page + 1)} className="btn ghost small" rel="next">{t("Suivant")}</Link> : <span />}
              </nav>
            )}
          </section>
        )}
      </main>
    </>
  );
}
