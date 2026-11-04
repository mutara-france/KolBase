import Link from "next/link";
import { Search } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { OrgCard } from "@/components/PublicCards";
import { publicOrgs } from "@/lib/public-data";
import { matches } from "@/lib/search";
import { ORG_FAMILIES } from "@/lib/org-roles";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("Organisations — KolBase") };
}
export const dynamic = "force-dynamic";

/**
 * Organisations référencées, rangées par famille (industriels, sociétés savantes et associations, organismes de
 * formation, prestataires) : une section par famille, ou une seule famille avec le filtre « type ».
 */
export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string; type?: string }> }) {
  const { q = "", type = "" } = await searchParams;
  const [all, { t, locale }] = await Promise.all([publicOrgs(), getT()]);
  const family = ORG_FAMILIES.find((f) => f.id === type) ?? null;
  // En anglais, la recherche porte aussi sur les libellés traduits (type d'organisation, domaines).
  const found = all.filter((o) => matches(q, o.name, o.kind, o.sector, o.about, o.hq, ...o.areas, ...(locale === "fr" ? [] : [o.kind, ...o.areas].map((x) => t(x)))));
  const groups = ORG_FAMILIES.map((f) => ({ ...f, orgs: found.filter((o) => o.family === f.id) }));
  const shown = family ? groups.filter((g) => g.id === family.id) : groups.filter((g) => g.orgs.length > 0);
  const href = (id: string) => {
    const p = new URLSearchParams({ ...(q && { q }), ...(id && { type: id }) });
    const qs = p.toString();
    return qs ? `/structures?${qs}` : "/structures";
  };

  return (
    <>
      <SiteHeader variant="public" />
      <main className="landing">
        <section className="page-band">
          <div className="page-band-inner">
            <span className="kicker">{t("Côté organisations")}</span>
            {/* Titre fidèle au filtre : une famille, ou toutes (prestataires et organismes de formation compris). */}
            <h1>{family ? t(family.label) : t("Organisations référencées")}</h1>
            <p>{family ? t(family.desc) : t("Industriels, sociétés savantes, associations, organismes de formation et prestataires référencés sur KolBase, leurs événements et leurs appels ouverts.")}</p>
          </div>
        </section>
        <section className="public-section">
          <form className="filter-bar" action="/structures" method="get" role="search">
            <label htmlFor="orgs-q" className="sr-only">{t("Rechercher une organisation")}</label>
            <input id="orgs-q" name="q" type="search" defaultValue={q} placeholder={t("Nom, type, ville, domaine")} />
            {family && <input type="hidden" name="type" value={family.id} />}
            <button type="submit" className="btn lg"><Search size={16} aria-hidden /> {t("Rechercher")}</button>
            {q && <Link href={href(family?.id ?? "")} className="text-sm">{t("Effacer la recherche")}</Link>}
          </form>
          <nav className="chips mb-4" aria-label={t("Types d'organisation")}>
            <Link href={href("")} className={`chip${family ? "" : " active"}`} aria-current={family ? undefined : "page"}>
              {t("Toutes")} ({found.length})
            </Link>
            {groups.map((g) => (
              <Link key={g.id} href={href(g.id)} className={`chip${family?.id === g.id ? " active" : ""}`} aria-current={family?.id === g.id ? "page" : undefined}>
                {t(g.label)} ({g.orgs.length})
              </Link>
            ))}
          </nav>
          {found.length === 0 && <p className="muted">{t("Aucune organisation ne correspond à cette recherche.")}</p>}
          {shown.map((g) => (
            <section key={g.id} className="org-family" aria-labelledby={`famille-${g.id}`}>
              <div className="section-head">
                <div>
                  <h2 id={`famille-${g.id}`} className="section-h2">{t(g.label)}</h2>
                  <p className="muted text-sm">{t(g.desc)}</p>
                </div>
              </div>
              {g.orgs.length === 0 ? (
                <p className="muted">{q ? t("Aucune organisation de ce type ne correspond à cette recherche.") : t("Aucune organisation de ce type pour l'instant.")}</p>
              ) : (
                <div className="grid-3">{g.orgs.map((o) => <OrgCard key={o.id} o={o} />)}</div>
              )}
            </section>
          ))}
        </section>
      </main>
    </>
  );
}
