import Link from "next/link";
import { Search } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { KolCard } from "@/components/PublicCards";
import { publicExperts, publicSpecialties } from "@/lib/public-data";
import { matches, normalize } from "@/lib/search";

export const metadata = { title: "Experts — KolBase" };
export const dynamic = "force-dynamic";

type Params = { q?: string; type?: string; ville?: string; specialite?: string };

export default async function Page({ searchParams }: { searchParams: Promise<Params> }) {
  const { q = "", type = "", ville = "", specialite = "" } = await searchParams;
  const [all, specialties] = await Promise.all([publicExperts(), publicSpecialties()]);
  const experts = all.filter((k) =>
    matches(q, k.name, k.specialty, k.subspecialty, k.profession, k.city, k.hospital, ...k.types)
    && (!type || k.types.includes(type))
    && matches(ville, k.city)
    && (!specialite || normalize(k.specialty) === normalize(specialite)),
  );
  const filtered = Boolean(q || type || ville || specialite);
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
            <span className="kicker">Réseau vérifié</span>
            <h1>Experts référencés</h1>
            <p>{all.length} praticiens ont choisi d&apos;être visibles. Les coordonnées, tarifs et la recherche avancée sont réservés aux membres connectés.</p>
          </div>
        </section>
        <section className="public-section">
          <form className="filter-bar" action="/experts" method="get" role="search">
            <label htmlFor="experts-q" className="sr-only">Rechercher un praticien</label>
            <input id="experts-q" name="q" type="search" defaultValue={q} placeholder="Nom, spécialité, ville, type d'intervention" />
            {type && <input type="hidden" name="type" value={type} />}
            {ville && <input type="hidden" name="ville" value={ville} />}
            {specialite && <input type="hidden" name="specialite" value={specialite} />}
            <button type="submit" className="btn lg"><Search size={16} aria-hidden /> Rechercher</button>
            <Link href="/connexion?next=%2Fannuaire" className="btn ghost lg">Recherche avancée</Link>
          </form>
          {specialties.length > 0 && (
            <div className="chips mb-4" aria-label="Spécialités">
              <Link href={chip("")} className={`chip${specialite ? "" : " active"}`}>Toutes</Link>
              {specialties.map((s) => (
                <Link key={s.name} href={chip(s.name)} className={`chip${normalize(specialite) === normalize(s.name) ? " active" : ""}`}>{s.name}</Link>
              ))}
            </div>
          )}
          <div className="flex-between mb-4">
            <h2 className="card-title" style={{ margin: 0 }}>{experts.length === 0 ? "Aucun praticien" : `${experts.length} praticien${experts.length > 1 ? "s" : ""}`}</h2>
            {filtered && <Link href="/experts" className="text-sm">Effacer les filtres</Link>}
          </div>
          {experts.length === 0 && <p className="muted">Aucun praticien ne correspond à cette recherche. Élargissez la spécialité ou retirez un filtre.</p>}
          <div className="grid-3">{experts.map((k) => <KolCard key={k.id} k={k} />)}</div>
        </section>
      </main>
    </>
  );
}
