import Link from "next/link";
import { logoSrc } from "@/lib/logos";
import { notFound } from "next/navigation";
import { ArrowLeft, Clock, Lock, Mail, MapPin, ShieldCheck } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { Avatar } from "@/components/Avatar";
import { CallCard, EventCard } from "@/components/PublicCards";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { ORG_KIND_LABEL } from "@/lib/orgs";
import { canSee, companyVisibility, type Viewer } from "@/lib/visibility";
import { ProposeForm } from "@/components/DossierForms";
import { FollowButton } from "@/components/FollowButton";
import { COLLAB_TYPES } from "@/lib/projects";
import type { Metadata } from "next";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const { t } = await getT();
  const o = await db.organization.findFirst({ where: { id, listed: true, verification: "VERIFIED" }, select: { name: true, kind: true, about: true } });
  if (!o) return { title: t("Organisation — KolBase"), robots: { index: false } };
  return { title: `${o.name} — ${t(ORG_KIND_LABEL[o.kind])} — KolBase`, description: (o.about ?? t("{name} sur KolBase.", { name: o.name })).slice(0, 160) };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [user, { t }] = await Promise.all([getCurrentUser(), getT()]);
  const isMember = !!user?.memberships.some((m) => m.organizationId === id);
  const viewer: Viewer = isMember ? "proprietaire" : user ? "membre" : "public";
  const now = new Date();
  const o = await db.organization.findFirst({
    where: { id, ...(isMember ? {} : { listed: true, verification: "VERIFIED" }) },
    include: {
      openCalls: { where: { status: "open", OR: [{ deadline: null }, { deadline: { gte: now } }] }, orderBy: { deadline: "asc" } },
      events: { where: { publishedAt: { not: null }, startsAt: { gte: now } }, orderBy: { startsAt: "asc" }, include: { _count: { select: { registrations: true } } } },
      _count: { select: { projects: { where: { status: { notIn: ["ATT_EXPERTS", "DECLINE"] } } } } },
    },
  });
  if (!o) notFound();
  const v = companyVisibility(o.visibility);
  const lock = (label: string) => (
    <p className="hidden-note"><Lock size={13} /> {t("{label} : réservé aux membres connectés.", { label })} {viewer === "public" && <Link href="/connexion">{t("Se connecter")}</Link>}</p>
  );

  return (
    <>
      <SiteHeader variant={user ? "app" : "public"} />
      <main className={user ? "" : "landing"}>
        <div className={user ? "stack" : "public-section stack"}>
          <Link href="/structures" className="back-link"><ArrowLeft size={14} /> {t("Toutes les organisations")}</Link>
          <section className="card profile-hero">
            <Avatar name={o.name} size={76} square src={logoSrc(o)} />
            <div className="grow">
              <span className="sector-tag">{t(ORG_KIND_LABEL[o.kind])}</span>
              <h1 className="profile-name">{o.name}</h1>
              <p className="text-sm">{[o.sector, o.headquarters].filter(Boolean).join(" · ")}</p>
            </div>
            {isMember ? <Link className="btn ghost" href={`/organisations/${o.id}`}>{t("Gérer l'organisation")}</Link> : <FollowButton type="organization" id={o.id} userId={user?.id ?? null} label={t("cette organisation")} />}
          </section>
          {!isMember && user?.practitioner?.listed && (
            <ProposeForm orgId={o.id} orgName={o.name} types={COLLAB_TYPES} defaultFee={user.practitioner.dayRateCents != null ? String(user.practitioner.dayRateCents / 100) : ""} />
          )}
          <div className="stats-row">
            <div className="stat-card"><div className="stat-value">{o.openCalls.length}</div><div className="stat-label">{t("Appels ouverts")}</div></div>
            <div className="stat-card"><div className="stat-value tone-electric">{o.events.length}</div><div className="stat-label">{t("Événements à venir")}</div></div>
            <div className="stat-card"><div className="stat-value">{o._count.projects}</div><div className="stat-label">{t("Collaborations")}</div></div>
            {canSee(v.equipe, viewer) && <div className="stat-card"><div className="stat-value">{o.responseDays ? t("{n} j", { n: o.responseDays }) : "—"}</div><div className="stat-label">{t("Délai de réponse moyen")}</div></div>}
          </div>
          <div className="grid-2">
            <section className="card">
              <h2 className="section-title">{t("Présentation")}</h2>
              {o.about ? <p>{o.about}</p> : <p className="muted">{t("Pas encore de présentation.")}</p>}
              {v.areas !== "masque" && (canSee(v.areas, viewer) ? <div className="tags mt-2">{o.areas.map((a) => <span key={a} className="tag">{t(a)}</span>)}</div> : lock(t("Aires d'intervention")))}
            </section>
            <section className="card">
              <h2 className="section-title"><ShieldCheck size={15} /> {t("Politique de collaboration")}</h2>
              {v.policy === "masque" && viewer !== "proprietaire" ? <p className="muted">{t("Non communiquée.")}</p> : canSee(v.policy, viewer) ? <p>{o.policy ?? t("Non renseignée.")}</p> : lock(t("Politique de conformité"))}
              <div className="hairline mt-3 mb-3" />
              <h2 className="section-title"><Mail size={15} /> {t("Contact partenariats")}</h2>
              {v.contact === "masque" && viewer !== "proprietaire" ? <p className="muted">{t("Non communiqué.")}</p> : canSee(v.contact, viewer) ? <p>{o.contactEmail ? <a href={`mailto:${o.contactEmail}`}>{o.contactEmail}</a> : t("Non renseigné.")}</p> : lock(t("Contact"))}
              {o.headquarters && <p className="meta-line mt-2"><MapPin size={12} /> {o.headquarters}</p>}
            </section>
          </div>
          {v.projets !== "masque" && (
            <section>
              <div className="section-head"><div><div className="eyebrow mb-1">{t("Opportunités")}</div><h2 className="section-h2">{t("Appels ouverts")}</h2></div></div>
              {canSee(v.projets, viewer) ? (
                o.openCalls.length === 0 ? <p className="muted">{t("Aucun appel ouvert.")}</p> : (
                  <div className="grid-2">{o.openCalls.map((c) => <CallCard key={c.id} c={{ ...c, poster: o.name, open: true }} action={<Link className="btn secondary" href={user ? `/opportunites/${c.id}` : `/connexion?next=${encodeURIComponent(`/opportunites/${c.id}`)}`}>{user ? t("Voir l'appel") : t("Se connecter pour candidater")}</Link>} />)}</div>
                )
              ) : lock(t("Appels ouverts"))}
            </section>
          )}
          <section>
            <div className="section-head"><div><div className="eyebrow mb-1">{t("Agenda")}</div><h2 className="section-h2">{t("Événements à venir")}</h2></div></div>
            {o.events.length === 0 ? <p className="muted"><Clock size={13} /> {t("Aucun événement à venir.")}</p> : (
              <>
                <div className="grid-3">{o.events.slice(0, 12).map((e) => <EventCard key={e.id} ev={{ ...e, organization: { name: o.name }, registrations: e._count.registrations }} compact />)}</div>
                {o.events.length > 12 && (() => {
                  const [before, after] = t("Et {n} autres événements à venir sur la page {link}.", { n: o.events.length - 12 }).split("{link}");
                  return <p className="muted text-sm">{before}<Link href="/evenements">{t("Événements")}</Link>{after}</p>;
                })()}
              </>
            )}
          </section>
        </div>
      </main>
    </>
  );
}
