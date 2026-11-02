import Link from "next/link";
import { Search } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { KolCard } from "@/components/PublicCards";
import { publicExperts, publicSpecialties } from "@/lib/public-data";
import { matches, normalize } from "@/lib/search";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("Experts — KolBase") };
}
export const dynamic = "force-dynamic";

type Params = { q?: string; type?: string; ville?: string; specialite?: string; page?: string };
const PER_PAGE = 24;

export default async function Page({ searchParams }: { searchParams: Promise<Params> }) {
  const { q = "", type = "", ville = "", specialite = "", page: pageParam = "1" } = await searchParams;
  const [all, specialties, { t, locale }] = await Promise.all([publicExperts(), publicSpecialties(), getT()]);
  // En anglais, la recherche porte aussi sur les libellés traduits (spécialité, profession, pays, types).
  const translated = (k: (typeof all)[number]) => (locale === "fr" ? [] : [k.specialty, k.profession, k.country, ...k.types].map((x) => (x ? t(x) : x)));
  const experts = all.filter((k) =>
    matches(q, k.name, k.specialty, k.subspecialty, k.profession, k.city, k.hospital, k.country, ...k.types, ...translated(k))
    && (!type || k.types.includes(type))
    && matches(ville, k.city)
    && (!specialite || normalize(k.specialty) === normalize(specialite)),
  );
  const filtered = Boolean(q || type || ville || specialite);
  const pages = Math.max(1, Math.ceil(experts.length / PER_PAGE));
  const page = Math.min(pages, Math.max(1, Math.floor(Number(pageParam)) || 1));
  const shown = experts.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const pageHref = (n: number) => {
    const p = new URLSearchParams({ ...(q && { q }), ...(type && { type }), ...(ville && { ville }), ...(specialite && { specialite }), ...(n > 1 && { page: String(n) }) });
    const qs = p.toString();
    return qs ? `/experts?${qs}` : "/experts";
  };
  const chip = (name: string) => {
    const p = new URLSearchParams({ ...(q && { q }), ...(type && { type }), ...(ville && { ville }), ...(name && { specialite: name }) });
    const qs = p.toString();
    return qs ? `/experts?${qs}` : "/experts";
  };

  return (
    <>
      <SiteHeader variant="public" />
      <main className="landing">
        <section className="page-band">
          <div className="page-band-inner">
            <span className="kicker">{t("Réseau vérifié")}</span>
            <h1>{t("Experts référencés")}</h1>
            <p>{t("{n} praticiens ont choisi d'être visibles. Chaque praticien choisit ce qu'il rend public ; la recherche avancée est réservée aux organisations inscrites.", { n: all.length })}</p>
          </div>
        </section>
        <section className="public-section">
          <form className="filter-bar" action="/experts" method="get" role="search">
            <label htmlFor="experts-q" className="sr-only">{t("Rechercher un praticien")}</label>
            <input id="experts-q" name="q" type="search" defaultValue={q} placeholder={t("Nom, spécialité, ville, type d'intervention")} />
            {type && <input type="hidden" name="type" value={type} />}
            {ville && <input type="hidden" name="ville" value={ville} />}
            {specialite && <input type="hidden" name="specialite" value={specialite} />}
            <button type="submit" className="btn lg"><Search size={16} aria-hidden /> {t("Rechercher")}</button>
            <Link href="/connexion?next=%2Fannuaire" className="btn ghost lg">{t("Recherche avancée")}</Link>
          </form>
          {specialties.length > 0 && (
            <div className="chips mb-4" aria-label={t("Spécialités")}>
              <Link href={chip("")} className={`chip${specialite ? "" : " active"}`}>{t("Toutes")}</Link>
              {specialties.map((s) => (
                <Link key={s.name} href={chip(s.name)} className={`chip${normalize(specialite) === normalize(s.name) ? " active" : ""}`}>{t(s.name)}</Link>
              ))}
            </div>
          )}
          <div className="flex-between mb-4">
            <h2 className="card-title" style={{ margin: 0 }}>{experts.length === 0 ? t("Aucun praticien") : t(experts.length > 1 ? "{n} praticiens" : "{n} praticien", { n: experts.length })}</h2>
            {filtered && <Link href="/experts" className="text-sm">{t("Effacer les filtres")}</Link>}
          </div>
          {experts.length === 0 && <p className="muted">{t("Aucun praticien ne correspond à cette recherche. Élargissez la spécialité ou retirez un filtre.")}</p>}
          <div className="grid-3">{shown.map((k) => <KolCard key={k.id} k={k} />)}</div>
          {pages > 1 && (
            <nav className="pager" aria-label={t("Pages de résultats")}>
              {page > 1 ? <Link href={pageHref(page - 1)} className="btn ghost small" rel="prev">{t("Précédent")}</Link> : <span />}
              <span className="muted text-sm">{t("Page {page} sur {pages}", { page, pages })}</span>
              {page < pages ? <Link href={pageHref(page + 1)} className="btn ghost small" rel="next">{t("Suivant")}</Link> : <span />}
            </nav>
          )}
        </section>
      </main>
    </>
  );
}
