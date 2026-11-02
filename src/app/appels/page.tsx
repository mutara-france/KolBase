import Link from "next/link";
import { LogIn, Search } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { CallCard } from "@/components/PublicCards";
import { publicCalls } from "@/lib/public-data";
import { collabType } from "@/lib/projects";
import { matches } from "@/lib/search";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("Opportunités — KolBase") };
}
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  const [all, { t, locale }] = await Promise.all([publicCalls(), getT()]);
  // En anglais, la recherche porte aussi sur les libellés traduits (spécialité, type de collaboration).
  const translated = (c: (typeof all)[number]) => (locale === "fr" ? [] : [c.specialty && t(c.specialty), t(collabType(c.typeId)?.label ?? "")]);
  const calls = all.filter((c) => matches(q, c.title, c.specialty, c.poster, c.description, collabType(c.typeId)?.label, ...translated(c)));
  return (
    <>
      <SiteHeader variant="public" />
      <main className="landing">
        <section className="page-band">
          <div className="page-band-inner">
            <span className="kicker">{t("Dans les deux sens")}</span>
            <h1>{t("Opportunités ouvertes")}</h1>
            <p>{t("Appels publiés par les organisations. La candidature est réservée aux experts référencés.")}</p>
          </div>
        </section>
        <section className="public-section">
          <form className="filter-bar" action="/appels" method="get" role="search">
            <label htmlFor="calls-q" className="sr-only">{t("Rechercher une opportunité")}</label>
            <input id="calls-q" name="q" type="search" defaultValue={q} placeholder={t("Spécialité, organisation, type de collaboration")} />
            <button type="submit" className="btn lg"><Search size={16} aria-hidden /> {t("Rechercher")}</button>
            {q && <Link href="/appels" className="text-sm">{t("Effacer la recherche")}</Link>}
          </form>
          {calls.length === 0 && <p className="muted">{q ? t("Aucun appel ne correspond à cette recherche.") : t("Aucun appel ouvert pour le moment.")}</p>}
          <div className="grid-2">
            {calls.map((c) => (
              <CallCard key={c.id} c={c} action={<Link href={`/connexion?next=${encodeURIComponent(`/opportunites/${c.id}`)}`} className="btn"><LogIn size={14} /> {t("Se connecter pour candidater")}</Link>} />
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
