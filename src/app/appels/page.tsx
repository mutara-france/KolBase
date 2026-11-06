import Link from "next/link";
import { LogIn, Search } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { CallCard } from "@/components/PublicCards";
import { publicCalls } from "@/lib/public-data";
import { collabType } from "@/lib/projects";
import { matches } from "@/lib/search";
import { getT } from "@/lib/i18n/server";
import { getCurrentUser } from "@/lib/auth";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: `${t("Appels à candidatures")} — KolBase` };
}
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  const [all, { t, locale }, user] = await Promise.all([publicCalls(), getT(), getCurrentUser()]);
  // En anglais, la recherche porte aussi sur les libellés traduits (spécialité, type de collaboration).
  const translated = (c: (typeof all)[number]) => (locale === "fr" ? [] : [c.specialty && t(c.specialty), t(collabType(c.typeId)?.label ?? "")]);
  const calls = all.filter((c) => matches(q, c.title, c.specialty, c.poster, c.description, collabType(c.typeId)?.label, ...translated(c)));
  return (
    <>
      <SiteHeader variant="public" />
      <main className="landing">
        <section className="page-band">
          <div className="page-band-inner">
            <span className="kicker">{t("Opportunités")}</span>
            <h1>{t("Appels à candidatures")}</h1>
            <p>{t("Les organisations cherchent des experts pour une collaboration ou pour intervenir à un événement. La candidature est réservée aux experts référencés.")}</p>
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
              // « Candidater » aux praticiens, « Se connecter pour candidater » sans session ; rien pour un compte
              // d'organisation (la candidature est réservée aux experts) ni pour un appel complet.
              <CallCard key={c.id} c={c} action={c.full ? undefined : user?.practitioner ? <Link href={`/opportunites/${c.id}`} className="btn">{t("Candidater")}</Link> : !user ? <Link href={`/connexion?next=${encodeURIComponent(`/opportunites/${c.id}`)}`} className="btn"><LogIn size={14} /> {t("Se connecter pour candidater")}</Link> : undefined} />
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
