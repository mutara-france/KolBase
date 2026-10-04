import Link from "next/link";
import { ArrowRight, Building2, LogIn } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { Avatar } from "@/components/Avatar";
import { CallCard, EventCard, KolCard, OrgCard, StatCard } from "@/components/PublicCards";
import { publicCalls, publicCounts, publicEvents, publicExperts, publicOrgs } from "@/lib/public-data";

export const dynamic = "force-dynamic";

/** Page d'accueil — reproduction de « PublicAccueil » du prototype. */
export default async function Home() {
  const [events, experts, faces, orgs, calls, n] = await Promise.all([
    publicEvents(3), publicExperts(3), publicExperts(7), publicOrgs(3), publicCalls(2), publicCounts(),
  ]);

  return (
    <>
      <SiteHeader variant="public" />
      <main className="landing">
        <section className="hero">
          <div className="hero-glow" />
          <div className="hero-content">
            <div>
              <div className="eyebrow mb-3">Mise en relation praticiens et organisations · Chirurgie dentaire</div>
              <h1 className="hero-title">Trouvez le bon praticien. Montez la collaboration. Le reste suit.</h1>
              <p className="hero-sub">
                Kolbase met en relation les chirurgiens-dentistes et les organisations du secteur — industriels, sociétés savantes,
                organismes de formation, associations. Chercher, proposer, candidater, contractualiser : tout part d&apos;une rencontre,
                et la paperasse réglementaire suit toute seule.
              </p>
              <div className="actions mt-6">
                <Link href="/experts" className="btn">Parcourir les experts <ArrowRight size={15} /></Link>
                <Link href="/evenements" className="btn secondary">Voir les événements <ArrowRight size={15} /></Link>
              </div>
              <div className="face-pile">
                {faces.map((k) => <Avatar key={k.id} name={k.name} size={34} ring />)}
                <span className="text-xs ml-2">{n.experts} praticiens, {n.verified} identités vérifiées</span>
              </div>
            </div>
          </div>
        </section>

        <section className="public-section pt-0">
          <div className="section-head">
            <div>
              <div className="eyebrow mb-1">Ouvert à tous</div>
              <h2 className="section-h2">Prochains événements</h2>
              <p className="text-sm mt-1">Symposiums, webinaires, formations et tables rondes — l&apos;inscription est ouverte, que vous soyez référencé sur Kolbase ou non.</p>
            </div>
            <Link href="/evenements" className="btn ghost">Tout l&apos;agenda <ArrowRight size={14} /></Link>
          </div>
          <div className="grid-3">{events.map((ev) => <EventCard key={ev.id} ev={ev} compact />)}</div>
        </section>

        <section className="public-section pt-0">
          <div className="stats-row">
            <StatCard label="Experts référencés" value={n.experts} hint={`${n.verified} identités vérifiées`} />
            <StatCard label="Industriels" value={n.industriels} />
            <StatCard label="Événements à venir" value={n.events} electric />
            <StatCard label="Appels ouverts" value={n.calls} />
          </div>
        </section>

        <section className="public-section pt-0">
          <div className="section-head">
            <div>
              <div className="eyebrow mb-1">Un réseau vérifié</div>
              <h2 className="section-h2">Des profils, pas des lignes d&apos;annuaire</h2>
            </div>
            <Link href="/experts" className="btn ghost">Tout voir <ArrowRight size={14} /></Link>
          </div>
          <div className="grid-3">{experts.map((k) => <KolCard key={k.id} k={k} />)}</div>
        </section>

        <section className="public-section">
          <div className="section-head">
            <div>
              <div className="eyebrow mb-1">Côté organisations</div>
              <h2 className="section-h2">Industriels, sociétés savantes, associations</h2>
            </div>
            <Link href="/structures" className="btn ghost">Tout voir <ArrowRight size={14} /></Link>
          </div>
          <div className="grid-3">{orgs.map((o) => <OrgCard key={o.id} o={o} />)}</div>
        </section>

        <section className="public-section pt-0">
          <div className="join-banner">
            <div className="join-art"><Building2 size={26} /></div>
            <div className="grow">
              <div className="eyebrow mb-1">Votre organisation n&apos;est pas encore référencée ?</div>
              <h2 className="join-title">Fabricants, sociétés savantes, associations, organismes de formation</h2>
              <p className="text-sm">
                Publiez vos appels, sollicitez les praticiens dont vous avez besoin, ouvrez vos événements aux inscriptions.
                Le référencement est gratuit et vous restez maître de ce que votre page rend public.
              </p>
            </div>
            <div className="join-actions">
              <Link href="/inscription" className="btn"><Building2 size={15} /> Référencer mon organisation</Link>
              <Link href="/aide" className="btn ghost">Comment ça marche</Link>
            </div>
          </div>
        </section>

        <section className="public-section pt-0">
          <div className="section-head">
            <div>
              <div className="eyebrow mb-1">Dans les deux sens</div>
              <h2 className="section-h2">Opportunités ouvertes</h2>
            </div>
            <Link href="/appels" className="btn ghost">Tout voir <ArrowRight size={14} /></Link>
          </div>
          <div className="grid-2">
            {calls.map((c) => (
              <CallCard key={c.id} c={c} action={<Link href={`/connexion?next=${encodeURIComponent(`/opportunites/${c.id}`)}`} className="btn secondary"><LogIn size={14} /> Se connecter pour candidater</Link>} />
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
