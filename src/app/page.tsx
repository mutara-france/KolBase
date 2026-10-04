import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { Avatar } from "@/components/Avatar";
import { db } from "@/lib/db";
import { eventTypeLabel, formatDateTime, FORMAT_LABEL } from "@/lib/events";

export const dynamic = "force-dynamic";

export default async function Home() {
  const now = new Date();
  const [experts, expertCount, orgCount, events] = await Promise.all([
    db.practitionerProfile.findMany({ where: { listed: true }, include: { user: { select: { firstName: true, lastName: true } } }, take: 7, orderBy: { listedAt: "desc" } }),
    db.practitionerProfile.count({ where: { listed: true } }),
    db.organization.count({ where: { listed: true } }),
    db.event.findMany({
      where: { publishedAt: { not: null }, startsAt: { gte: now } },
      include: { organization: { select: { name: true } } },
      orderBy: { startsAt: "asc" },
      take: 3,
    }),
  ]);

  return (
    <>
      <SiteHeader variant="public" />
      <main className="landing">
        <section className="hero">
          <div className="hero-glow" />
          <div className="hero-content">
            <span className="eyebrow">Mise en relation praticiens et organisations · chirurgie dentaire</span>
            <h1 className="hero-title">Trouvez le bon praticien. Montez la collaboration. Le reste suit.</h1>
            <p className="hero-sub">
              Kolbase met en relation les chirurgiens-dentistes et les organisations du secteur — industriels, sociétés savantes,
              organismes de formation, associations. Chercher, proposer, candidater, contractualiser : tout part d&apos;une rencontre,
              et la paperasse réglementaire suit toute seule.
            </p>
            <div className="actions">
              <Link href="/annuaire" className="btn lg">Parcourir les experts <ArrowRight size={16} /></Link>
              <Link href="/evenements" className="btn secondary lg">Voir les événements <ArrowRight size={16} /></Link>
            </div>
            {experts.length > 0 && (
              <div className="hero-proof">
                <span className="avatars">{experts.map((e) => <Avatar key={e.id} name={`${e.user.firstName} ${e.user.lastName}`} size={34} />)}</span>
                {expertCount} praticien{expertCount > 1 ? "s" : ""} référencé{expertCount > 1 ? "s" : ""}, {orgCount} organisation{orgCount > 1 ? "s" : ""}
              </div>
            )}
          </div>
        </section>

        <section className="public-section">
          <div className="section-head">
            <div><span className="eyebrow">Comment ça marche</span><h2>Deux parcours, un même circuit</h2></div>
          </div>
          <div className="steps">
            <div className="card"><span className="step-num">1</span><h2>Le praticien se référence</h2><p>Un compte unique pour s&apos;inscrire aux événements. Un clic pour devenir expert visible des organisations.</p></div>
            <div className="card"><span className="step-num">2</span><h2>L&apos;organisation sollicite</h2><p>Annuaire, opportunités ouvertes, dossiers : honoraires vérifiés face aux références de juste contrepartie.</p></div>
            <div className="card"><span className="step-num">3</span><h2>La conformité suit</h2><p>Validation interne, déclaration ou autorisation ordinale, convention générée, hospitalités tracées et exportées.</p></div>
          </div>
        </section>

        {events.length > 0 && (
          <section className="public-section" style={{ paddingTop: 0 }}>
            <div className="section-head">
              <div><span className="eyebrow">Agenda</span><h2>Prochains événements</h2></div>
              <Link href="/evenements" className="btn ghost">Tout l&apos;agenda <ArrowRight size={14} /></Link>
            </div>
            <div className="grid">
              {events.map((e) => (
                <Link key={e.id} href={`/evenements/${e.id}`} className="card tile">
                  <span className="tag">{eventTypeLabel(e.typeId)}</span>
                  <strong>{e.title}</strong>
                  <span className="muted">{formatDateTime(e.startsAt)}</span>
                  <span className="muted">{e.format === "DISTANCIEL" ? FORMAT_LABEL.DISTANCIEL : e.city} · {e.organization.name}</span>
                </Link>
              ))}
            </div>
          </section>
        )}

        <section className="cta-band">
          <div>
            <span className="eyebrow">Industriels, sociétés savantes, associations, organismes de formation</span>
            <h2>Votre organisation n&apos;est pas encore référencée ?</h2>
            <p>Créez votre espace, invitez vos équipes et gérez sollicitations, événements et conformité au même endroit.</p>
          </div>
          <div className="actions">
            <Link href="/inscription" className="btn lg">Référencer mon organisation</Link>
            <Link href="/cgu" className="btn ghost lg">En savoir plus</Link>
          </div>
        </section>
      </main>
    </>
  );
}
