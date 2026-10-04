import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Clock, Lock, Mail, MapPin, ShieldCheck } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { Avatar } from "@/components/Avatar";
import { CallCard, EventCard } from "@/components/PublicCards";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { ORG_KIND_LABEL } from "@/lib/orgs";
import { canSee, companyVisibility, type Viewer } from "@/lib/visibility";

export const metadata = { title: "Organisation — Kolbase" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  const isMember = !!user?.memberships.some((m) => m.organizationId === id);
  const viewer: Viewer = isMember ? "proprietaire" : user ? "membre" : "public";
  const now = new Date();
  const o = await db.organization.findFirst({
    where: { id, ...(isMember ? {} : { listed: true }) },
    include: {
      openCalls: { where: { status: "open", OR: [{ deadline: null }, { deadline: { gte: now } }] }, orderBy: { deadline: "asc" } },
      events: { where: { publishedAt: { not: null }, startsAt: { gte: now } }, orderBy: { startsAt: "asc" }, include: { _count: { select: { registrations: true } } } },
      _count: { select: { projects: { where: { status: { notIn: ["ATT_EXPERTS", "DECLINE"] } } } } },
    },
  });
  if (!o) notFound();
  const v = companyVisibility(o.visibility);
  const lock = (label: string) => (
    <p className="hidden-note"><Lock size={13} /> {label} : réservé aux membres connectés. {viewer === "public" && <Link href="/connexion">Se connecter</Link>}</p>
  );

  return (
    <>
      <SiteHeader variant={user ? "app" : "public"} />
      <main className={user ? "" : "landing"}>
        <div className={user ? "stack" : "public-section stack"}>
          <Link href="/structures" className="back-link"><ArrowLeft size={14} /> Toutes les organisations</Link>
          <section className="card profile-hero">
            <Avatar name={o.name} size={76} square />
            <div className="grow">
              <span className="sector-tag">{ORG_KIND_LABEL[o.kind]}</span>
              <h1 className="profile-name">{o.name}</h1>
              <p className="text-sm">{[o.sector, o.headquarters].filter(Boolean).join(" · ")}</p>
            </div>
            {isMember && <Link className="btn ghost" href={`/organisations/${o.id}`}>Gérer l&apos;organisation</Link>}
          </section>
          <div className="stats-row">
            <div className="stat-card"><div className="stat-value">{o.openCalls.length}</div><div className="stat-label">Appels ouverts</div></div>
            <div className="stat-card"><div className="stat-value tone-electric">{o.events.length}</div><div className="stat-label">Événements à venir</div></div>
            <div className="stat-card"><div className="stat-value">{o._count.projects}</div><div className="stat-label">Collaborations</div></div>
            {canSee(v.equipe, viewer) && <div className="stat-card"><div className="stat-value">{o.responseDays ? `${o.responseDays} j` : "—"}</div><div className="stat-label">Délai de réponse moyen</div></div>}
          </div>
          <div className="grid-2">
            <section className="card">
              <h2 className="section-title">Présentation</h2>
              {o.about ? <p>{o.about}</p> : <p className="muted">Pas encore de présentation.</p>}
              {v.areas !== "masque" && (canSee(v.areas, viewer) ? <div className="tags mt-2">{o.areas.map((a) => <span key={a} className="tag">{a}</span>)}</div> : lock("Aires d'intervention"))}
            </section>
            <section className="card">
              <h2 className="section-title"><ShieldCheck size={15} /> Politique de collaboration</h2>
              {v.policy === "masque" && viewer !== "proprietaire" ? <p className="muted">Non communiquée.</p> : canSee(v.policy, viewer) ? <p>{o.policy ?? "Non renseignée."}</p> : lock("Politique de conformité")}
              <div className="hairline mt-3 mb-3" />
              <h2 className="section-title"><Mail size={15} /> Contact partenariats</h2>
              {v.contact === "masque" && viewer !== "proprietaire" ? <p className="muted">Non communiqué.</p> : canSee(v.contact, viewer) ? <p>{o.contactEmail ? <a href={`mailto:${o.contactEmail}`}>{o.contactEmail}</a> : "Non renseigné."}</p> : lock("Contact")}
              {o.headquarters && <p className="meta-line mt-2"><MapPin size={12} /> {o.headquarters}</p>}
            </section>
          </div>
          {v.projets !== "masque" && (
            <section>
              <div className="section-head"><div><div className="eyebrow mb-1">Opportunités</div><h2 className="section-h2">Appels ouverts</h2></div></div>
              {canSee(v.projets, viewer) ? (
                o.openCalls.length === 0 ? <p className="muted">Aucun appel ouvert.</p> : (
                  <div className="grid-2">{o.openCalls.map((c) => <CallCard key={c.id} c={{ ...c, poster: o.name, open: true }} action={<Link className="btn secondary" href={user ? `/opportunites/${c.id}` : `/connexion?next=${encodeURIComponent(`/opportunites/${c.id}`)}`}>{user ? "Voir l'appel" : "Se connecter pour candidater"}</Link>} />)}</div>
                )
              ) : lock("Appels ouverts")}
            </section>
          )}
          <section>
            <div className="section-head"><div><div className="eyebrow mb-1">Agenda</div><h2 className="section-h2">Événements à venir</h2></div></div>
            {o.events.length === 0 ? <p className="muted"><Clock size={13} /> Aucun événement à venir.</p> : (
              <div className="grid-3">{o.events.map((e) => <EventCard key={e.id} ev={{ ...e, organization: { name: o.name }, registrations: e._count.registrations }} compact />)}</div>
            )}
          </section>
        </div>
      </main>
    </>
  );
}
