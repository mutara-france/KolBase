import Link from "next/link";
import { Search } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { OrgCard } from "@/components/PublicCards";
import { publicOrgs } from "@/lib/public-data";
import { matches } from "@/lib/search";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("Organisations — KolBase") };
}
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  const [all, { t, locale }] = await Promise.all([publicOrgs(), getT()]);
  // En anglais, la recherche porte aussi sur les libellés traduits (type d'organisation, domaines).
  const orgs = all.filter((o) => matches(q, o.name, o.kind, o.sector, o.about, o.hq, ...o.areas, ...(locale === "fr" ? [] : [o.kind, ...o.areas].map((x) => t(x)))));
  return (
    <>
      <SiteHeader variant="public" />
      <main className="landing">
        <section className="page-band">
          <div className="page-band-inner">
            <span className="kicker">{t("Côté organisations")}</span>
            <h1>{t("Industriels, sociétés savantes, associations")}</h1>
            <p>{t("Les organisations référencées sur KolBase, leurs événements et leurs appels ouverts.")}</p>
          </div>
        </section>
        <section className="public-section">
          <form className="filter-bar" action="/structures" method="get" role="search">
            <label htmlFor="orgs-q" className="sr-only">{t("Rechercher une organisation")}</label>
            <input id="orgs-q" name="q" type="search" defaultValue={q} placeholder={t("Nom, type, ville, domaine")} />
            <button type="submit" className="btn lg"><Search size={16} aria-hidden /> {t("Rechercher")}</button>
            {q && <Link href="/structures" className="text-sm">{t("Effacer la recherche")}</Link>}
          </form>
          {orgs.length === 0 && <p className="muted">{t("Aucune organisation ne correspond à cette recherche.")}</p>}
          <div className="grid-3">{orgs.map((o) => <OrgCard key={o.id} o={o} />)}</div>
        </section>
      </main>
    </>
  );
}
