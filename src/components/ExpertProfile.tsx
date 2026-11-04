import Link from "next/link";
import { BadgeCheck, BookOpen, Building, Clock, EyeOff, Languages, Lock, MapPin, Send, Wallet } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { FollowButton } from "@/components/FollowButton";
import { db } from "@/lib/db";
import { collabType } from "@/lib/projects";
import { drPrefix } from "@/lib/professions";
import { canSee, kolVisibility, type Viewer, type VisLevel } from "@/lib/visibility";
import { country } from "@/lib/countries";
import { intlLocale, type T } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";

function Hidden({ level, viewer, label, t, back }: { level: VisLevel; viewer: Viewer; label: string; t: T; back: string }) {
  if (level === "masque") return null;
  return (
    <p className="hidden-note">
      {viewer === "public" ? <Lock size={13} /> : <EyeOff size={13} />} {t("{label} : réservé aux organisations inscrites.", { label })}{" "}
      {viewer === "public" && <Link href={`/connexion?next=${encodeURIComponent(back)}`}>{t("Se connecter")}</Link>}
    </p>
  );
}

/** Fiche expert respectant les réglages de visibilité (reprise de « ProfilExpert » du prototype). */
export async function ExpertProfile({ id, viewer, solicitHref, userId = null }: { id: string; viewer: Viewer; solicitHref?: string | null; userId?: string | null }) {
  const p = await db.practitionerProfile.findFirst({
    where: { id, ...(viewer === "proprietaire" ? {} : { listed: true }) },
    include: {
      user: { select: { firstName: true, lastName: true } },
      publications: { orderBy: [{ year: "desc" }, { createdAt: "desc" }] },
      structures: true,
      projectLinks: { where: { status: { notIn: ["ATT_EXPERTS", "DECLINE"] } }, include: { project: { include: { organization: { select: { id: true, name: true } } } } } },
    },
  });
  if (!p) return null;
  const { t, locale } = await getT();
  const v = kolVisibility(p.visibility);
  const name = `${drPrefix(p.profession)}${p.user.firstName} ${p.user.lastName}`;
  const orgs = [...new Map(p.projectLinks.map((l) => [l.project.organization.id, l.project.organization.name])).values()];
  // Délai de réponse mesuré sur les sollicitations des 12 derniers mois (au moins 3 réponses), jamais une valeur saisie.
  const answered = await db.projectExpert.findMany({
    where: { practitionerId: p.id, respondedAt: { not: null }, createdAt: { gte: new Date(Date.now() - 365 * 864e5) } },
    select: { createdAt: true, respondedAt: true },
  });
  const responseDays = answered.length >= 3
    ? Math.max(1, Math.round(answered.reduce((s, l) => s + (l.respondedAt!.getTime() - l.createdAt.getTime()), 0) / answered.length / 864e5))
    : null;

  return (
    <div className="stack">
      <section className="card profile-hero">
        <Avatar name={name} size={76} ring />
        <div className="grow">
          <div className="eyebrow">KB-{p.id.slice(-4).toUpperCase()} · {t(country(p.country).name)}</div>
          <h1 className="profile-name">{name} {p.rppsVerified && <span className="verif ok"><BadgeCheck size={13} /> {t("Identité vérifiée")}</span>}</h1>
          <p className="text-sm">{[t(p.profession), p.specialty && t(p.specialty), p.subspecialty].filter(Boolean).join(" · ")}</p>
          <div className="tags mt-2">{p.interventionTypes.map((x) => <span key={x} className="tag">{t(x)}</span>)}</div>
        </div>
        {viewer !== "proprietaire" && <FollowButton type="practitioner" id={p.id} userId={userId} label={t("cet expert")} />}
        {solicitHref && <Link className="btn" href={solicitHref}><Send size={15} /> {t("Solliciter")}</Link>}
        {viewer === "proprietaire" && <Link className="btn ghost" href="/compte">{t("Modifier mon profil")}</Link>}
      </section>

      {viewer === "proprietaire" && (
        <p className="notice ok">{t("Aperçu de votre fiche telle que vous la voyez. Les visiteurs ne voient que ce que vos réglages de visibilité autorisent.")}</p>
      )}

      <div className="stats-row">
        {canSee(v.historique, viewer) ? (
          <>
            <div className="stat-card"><div className="stat-value">{p.projectLinks.length}</div><div className="stat-label">{t("Collaborations via KolBase")}</div></div>
            <div className="stat-card"><div className="stat-value">{orgs.length}</div><div className="stat-label">{t("Organisations partenaires")}</div></div>
            <div className="stat-card"><div className="stat-value tone-electric">{responseDays ? t("{n} j", { n: responseDays }) : "—"}</div><div className="stat-label">{t("Délai de réponse moyen")}</div></div>
          </>
        ) : null}
        {canSee(v.tarif, viewer) && p.dayRateCents != null && (
          <div className="stat-card"><div className="stat-value">{t("{amount} €", { amount: (p.dayRateCents / 100).toLocaleString(intlLocale(locale)) })}</div><div className="stat-label">{t("Tarif journalier indicatif (HT)")}</div></div>
        )}
      </div>
      {!canSee(v.historique, viewer) && <Hidden level={v.historique} viewer={viewer} label={t("Statistiques d'activité")} t={t} back={`/experts/${id}`} />}
      {!canSee(v.tarif, viewer) && <Hidden level={v.tarif} viewer={viewer} label={t("Tarif indicatif")} t={t} back={`/experts/${id}`} />}

      <div className="grid-2">
        <section className="card">
          <h2 className="section-title">{t("Présentation")}</h2>
          {p.bio ? <p>{p.bio}</p> : <p className="muted">{t("Pas encore de présentation.")}</p>}
        </section>
        <section className="card">
          <h2 className="section-title"><MapPin size={15} /> {t("Lieu d'exercice")}</h2>
          {canSee(v.contact, viewer) ? (
            <dl className="facts">
              <dt>{t("Ville")}</dt><dd>{p.city ?? "—"}</dd>
              <dt>{t("Établissement")}</dt><dd>{p.hospital ?? "—"}</dd>
              <dt><Languages size={12} /> {t("Langues")}</dt><dd>{p.languages.join(", ") || "—"}</dd>
              {p.orcid && (<><dt>ORCID</dt><dd><a href={`https://orcid.org/${p.orcid}`} target="_blank" rel="noreferrer">{p.orcid}</a>{p.orcidVerified && <span className="verif ok small"> <BadgeCheck size={12} /> {t("vérifié")}</span>}</dd></>)}
            </dl>
          ) : <Hidden level={v.contact} viewer={viewer} label={t("Coordonnées")} t={t} back={`/experts/${id}`} />}
        </section>
      </div>

      {v.publications !== "masque" || viewer === "proprietaire" ? (
        <section className="card">
          <h2 className="section-title"><BookOpen size={15} /> {t("Publications ({n})", { n: p.publications.length })}</h2>
          {canSee(v.publications, viewer) ? (
            p.publications.length === 0 ? <p className="muted">{t("Aucune publication déclarée.")}</p> : (
              <ul className="pub-list">
                {p.publications.map((x) => (
                  <li key={x.id}>
                    <strong>{x.title}</strong>
                    <span className="text-xs">{[x.journal, x.year].filter(Boolean).join(" · ")}{x.doi ? <> · <a href={`https://doi.org/${x.doi}`} target="_blank" rel="noreferrer">DOI</a></> : null}</span>
                    {x.keywords.length > 0 && <span className="tags">{x.keywords.map((k) => <span key={k} className="tag tag-sm">{k}</span>)}</span>}
                  </li>
                ))}
              </ul>
            )
          ) : <Hidden level={v.publications} viewer={viewer} label={t("Publications")} t={t} back={`/experts/${id}`} />}
        </section>
      ) : null}

      {v.projets !== "masque" || viewer === "proprietaire" ? (
        <section className="card">
          <h2 className="section-title"><Clock size={15} /> {t("Collaborations")}</h2>
          {p.projectLinks.length === 0 ? <p className="muted">{t("Aucune collaboration conclue via KolBase pour l'instant.")}</p>
            : v.projets === "agrege" && viewer !== "proprietaire" ? (
              <p>{t("{collaborations} avec {organisations}.", {
                collaborations: t(p.projectLinks.length > 1 ? "{n} collaborations" : "{n} collaboration", { n: p.projectLinks.length }),
                organisations: t(orgs.length > 1 ? "{n} organisations" : "{n} organisation", { n: orgs.length }),
              })}</p>
            ) : (
              <ul className="pub-list">
                {p.projectLinks.map((l) => (
                  <li key={l.id}><strong>{t(collabType(l.project.typeId)?.label ?? l.project.typeId)}</strong><span className="text-xs">{l.project.organization.name} · {l.project.createdAt.getFullYear()}</span></li>
                ))}
              </ul>
            )}
        </section>
      ) : null}

      {v.structures !== "masque" || viewer === "proprietaire" ? (
        <section className="card">
          <h2 className="section-title"><Building size={15} /> {t("Structures juridiques")}</h2>
          {canSee(v.structures, viewer) ? (
            p.structures.length === 0 ? <p className="muted">{t("Aucune structure déclarée.")}</p> : (
              <ul className="pub-list">
                {p.structures.map((s) => (
                  <li key={s.id}><strong>{s.name}</strong><span className="text-xs">{s.legalForm}{s.role ? ` · ${s.role}` : ""}{s.sharePercent != null ? ` · ${t("{n} %", { n: s.sharePercent })}` : ""}{s.isPayee ? ` · ${t("structure de facturation")}` : ""}</span></li>
                ))}
              </ul>
            )
          ) : <Hidden level={v.structures} viewer={viewer} label={t("Structures juridiques")} t={t} back={`/experts/${id}`} />}
        </section>
      ) : null}
      {viewer === "membre" && p.dayRateCents == null && canSee(v.tarif, viewer) && <p className="text-xs"><Wallet size={12} /> {t("Tarif non renseigné.")}</p>}
    </div>
  );
}
