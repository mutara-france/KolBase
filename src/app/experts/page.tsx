import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { KolCard } from "@/components/PublicCards";
import { publicExperts } from "@/lib/public-data";

export const metadata = { title: "Experts — Kolbase" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const experts = await publicExperts();
  return (
    <>
      <SiteHeader variant="public" />
      <main className="landing">
        <section className="public-section">
          <div className="section-head">
            <div>
              <div className="eyebrow mb-1">Un réseau vérifié</div>
              <h1 className="section-h2">Experts référencés</h1>
              <p className="text-sm mt-1">{experts.length} praticiens ont choisi d&apos;être visibles. Les coordonnées, tarifs et la recherche avancée sont réservés aux membres connectés.</p>
            </div>
            <Link href="/connexion?next=%2Fannuaire" className="btn ghost">Recherche avancée</Link>
          </div>
          <div className="grid-3">{experts.map((k) => <KolCard key={k.id} k={k} />)}</div>
        </section>
      </main>
    </>
  );
}
