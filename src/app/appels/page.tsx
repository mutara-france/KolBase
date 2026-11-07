import Link from "next/link";
import { LogIn, Search } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { CallCard } from "@/components/PublicCards";
import { publicCalls } from "@/lib/public-data";
import { COLLAB_TYPES, collabType } from "@/lib/projects";
import { ActiveFilters, FilterSelect } from "@/components/Filters";
import { matches } from "@/lib/search";
import { publicPage } from "@/lib/seo";
import { getT } from "@/lib/i18n/server";
import { getCurrentUser } from "@/lib/auth";

export async function generateMetadata() {
  const { t } = await getT();
  return publicPage({ title: `${t("Opportunités")} — KolBase`, description: t("Opportunités ouvertes aux praticiens par les organisations du secteur dentaire : conférences, formations, études, conseil."), path: "/appels" });
}
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string; type?: string; evenement?: string; specialite?: string }> }) {
  const { q = "", type = "", evenement = "", specialite = "" } = await searchParams;
  const [all, { t, locale }, user] = await Promise.all([publicCalls(), getT(), getCurrentUser()]);
  // En anglais, la recherche porte aussi sur les libellés traduits (spécialité, type de collaboration).
  const translated = (c: (typeof all)[number]) => (locale === "fr" ? [] : [c.specialty && t(c.specialty), t(collabType(c.typeId)?.label ?? "")]);
  const calls = all
    .filter((c) => matches(q, c.title, c.specialty, c.poster, c.description, collabType(c.typeId)?.label, ...translated(c)))
    .filter((c) => !type || c.typeId === type)
    .filter((c) => (evenement === "avec" ? !!c.event : evenement === "sans" ? !c.event : true))
    .filter((c) => !specialite || c.specialty === specialite);
  // Valeurs proposées : celles des opportunités publiées.
  const types = COLLAB_TYPES.filter((x) => all.some((c) => c.typeId === x.id));
  const specialties = [...new Set(all.map((c) => c.specialty).filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b, "fr"));
  const params = { q, type, evenement, specialite };
  return (
    <>
      <SiteHeader variant="public" />
      <main className="landing">
        <section className="page-band">
          <div className="page-band-inner">
            <span className="kicker">{t("Opportunités")}</span>
            <h1>{t("Opportunités")}</h1>
            <p>{t("Les organisations cherchent des experts pour une collaboration ou pour intervenir à un événement. La candidature est réservée aux experts référencés.")}</p>
          </div>
        </section>
        <section className="public-section">
          <form className="filter-bar" action="/appels" method="get" role="search">
            <label htmlFor="calls-q" className="sr-only">{t("Rechercher une opportunité")}</label>
            <input id="calls-q" name="q" type="search" defaultValue={q} placeholder={t("Spécialité, organisation, type de collaboration")} />
            <FilterSelect name="type" label={t("Type")} value={type} all={t("Tous les types")} options={types.map((x) => ({ value: x.id, label: t(x.label) }))} />
            <FilterSelect name="evenement" label={t("Événement")} value={evenement} all={t("Avec ou sans événement")} options={[{ value: "avec", label: t("Intervenir à un événement") }, { value: "sans", label: t("Collaboration hors événement") }]} />
            {specialties.length > 0 && <FilterSelect name="specialite" label={t("Spécialité")} value={specialite} all={t("Toutes les spécialités")} options={specialties.map((x) => ({ value: x, label: t(x) }))} />}
            <button type="submit" className="btn lg"><Search size={16} aria-hidden /> {t("Rechercher")}</button>
          </form>
          <ActiveFilters
            path="/appels"
            params={params}
            ariaLabel={t("Filtres actifs")}
            clearLabel={t("Tout effacer")}
            labels={{
              q: q && t("Recherche : {value}", { value: q }),
              type: type && t("Type : {value}", { value: t(collabType(type)?.label ?? type) }),
              evenement: evenement && (evenement === "avec" ? t("Intervenir à un événement") : t("Collaboration hors événement")),
              specialite: specialite && t("Spécialité : {value}", { value: t(specialite) }),
            }}
          />
          <p className="muted text-sm list-count">{t(calls.length > 1 ? "{n} opportunités" : "{n} opportunité", { n: calls.length })}</p>
          {calls.length === 0 && <p className="muted">{q || type || evenement || specialite ? t("Aucune opportunité ne correspond à cette recherche.") : t("Aucune opportunité ouverte pour le moment.")}</p>}
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
