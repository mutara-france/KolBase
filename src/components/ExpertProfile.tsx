import Link from "next/link";
import { BadgeCheck, BookOpen, Building, Clock, EyeOff, Languages, Lock, MapPin, Send, Wallet } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { db } from "@/lib/db";
import { collabType } from "@/lib/projects";
import { canSee, kolVisibility, type Viewer, type VisLevel } from "@/lib/visibility";

function Hidden({ level, viewer, label }: { level: VisLevel; viewer: Viewer; label: string }) {
  if (level === "masque") return null;
  return (
    <p className="hidden-note">
      {viewer === "public" ? <Lock size={13} /> : <EyeOff size={13} />} {label} : réservé aux membres connectés.{" "}
      {viewer === "public" && <Link href="/connexion">Se connecter</Link>}
    </p>
  );
}

/** Fiche expert respectant les réglages de visibilité (reprise de « ProfilExpert » du prototype). */
export async function ExpertProfile({ id, viewer, solicitHref }: { id: string; viewer: Viewer; solicitHref?: string | null }) {
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
  const v = kolVisibility(p.visibility);
  const name = `Dr ${p.user.firstName} ${p.user.lastName}`;
  const orgs = [...new Map(p.projectLinks.map((l) => [l.project.organization.id, l.project.organization.name])).values()];

  return (
    <div className="stack">
      <section className="card profile-hero">
        <Avatar name={name} size={76} ring />
        <div className="grow">
          <div className="eyebrow">KB-{p.id.slice(-4).toUpperCase()} · France</div>
          <h1 className="profile-name">{name} {p.rppsVerified && <span className="verif ok"><BadgeCheck size={13} /> Identité vérifiée</span>}</h1>
          <p className="text-sm">{[p.profession, p.specialty, p.subspecialty].filter(Boolean).join(" · ")}</p>
          <div className="tags mt-2">{p.interventionTypes.map((t) => <span key={t} className="tag">{t}</span>)}</div>
        </div>
        {solicitHref && <Link className="btn" href={solicitHref}><Send size={15} /> Solliciter</Link>}
        {viewer === "proprietaire" && <Link className="btn ghost" href="/compte">Modifier mon profil</Link>}
      </section>

      {viewer === "proprietaire" && (
        <p className="notice ok">Aperçu de votre fiche telle que vous la voyez. Les visiteurs ne voient que ce que vos réglages de visibilité autorisent.</p>
      )}

      <div className="stats-row">
        {canSee(v.historique, viewer) ? (
          <>
            <div className="stat-card"><div className="stat-value">{p.projectLinks.length}</div><div className="stat-label">Collaborations via Kolbase</div></div>
            <div className="stat-card"><div className="stat-value">{orgs.length}</div><div className="stat-label">Organisations partenaires</div></div>
            <div className="stat-card"><div className="stat-value tone-electric">{p.responseDays ? `${p.responseDays} j` : "—"}</div><div className="stat-label">Délai de réponse moyen</div></div>
          </>
        ) : null}
        {canSee(v.tarif, viewer) && p.dayRateCents != null && (
          <div className="stat-card"><div className="stat-value">{(p.dayRateCents / 100).toLocaleString("fr-FR")} €</div><div className="stat-label">Tarif journalier indicatif (HT)</div></div>
        )}
      </div>
      {!canSee(v.historique, viewer) && <Hidden level={v.historique} viewer={viewer} label="Statistiques d'activité" />}
      {!canSee(v.tarif, viewer) && <Hidden level={v.tarif} viewer={viewer} label="Tarif indicatif" />}

      <div className="grid-2">
        <section className="card">
          <h2 className="section-title">Présentation</h2>
          {p.bio ? <p>{p.bio}</p> : <p className="muted">Pas encore de présentation.</p>}
        </section>
        <section className="card">
          <h2 className="section-title"><MapPin size={15} /> Lieu d&apos;exercice</h2>
          {canSee(v.contact, viewer) ? (
            <dl className="facts">
              <dt>Ville</dt><dd>{p.city ?? "—"}</dd>
              <dt>Établissement</dt><dd>{p.hospital ?? "—"}</dd>
              <dt><Languages size={12} /> Langues</dt><dd>{p.languages.join(", ") || "—"}</dd>
              {p.orcid && (<><dt>ORCID</dt><dd><a href={`https://orcid.org/${p.orcid}`} target="_blank" rel="noreferrer">{p.orcid}</a></dd></>)}
            </dl>
          ) : <Hidden level={v.contact} viewer={viewer} label="Coordonnées" />}
        </section>
      </div>

      {v.publications !== "masque" || viewer === "proprietaire" ? (
        <section className="card">
          <h2 className="section-title"><BookOpen size={15} /> Publications ({p.publications.length})</h2>
          {canSee(v.publications, viewer) ? (
            p.publications.length === 0 ? <p className="muted">Aucune publication déclarée.</p> : (
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
          ) : <Hidden level={v.publications} viewer={viewer} label="Publications" />}
        </section>
      ) : null}

      {v.projets !== "masque" || viewer === "proprietaire" ? (
        <section className="card">
          <h2 className="section-title"><Clock size={15} /> Collaborations</h2>
          {p.projectLinks.length === 0 ? <p className="muted">Aucune collaboration conclue via Kolbase pour l&apos;instant.</p>
            : v.projets === "agrege" && viewer !== "proprietaire" ? (
              <p>{p.projectLinks.length} collaboration{p.projectLinks.length > 1 ? "s" : ""} avec {orgs.length} organisation{orgs.length > 1 ? "s" : ""}.</p>
            ) : (
              <ul className="pub-list">
                {p.projectLinks.map((l) => (
                  <li key={l.id}><strong>{collabType(l.project.typeId)?.label ?? l.project.typeId}</strong><span className="text-xs">{l.project.organization.name} · {l.project.createdAt.getFullYear()}</span></li>
                ))}
              </ul>
            )}
        </section>
      ) : null}

      {v.structures !== "masque" || viewer === "proprietaire" ? (
        <section className="card">
          <h2 className="section-title"><Building size={15} /> Structures juridiques</h2>
          {canSee(v.structures, viewer) ? (
            p.structures.length === 0 ? <p className="muted">Aucune structure déclarée.</p> : (
              <ul className="pub-list">
                {p.structures.map((s) => (
                  <li key={s.id}><strong>{s.name}</strong><span className="text-xs">{s.legalForm}{s.role ? ` · ${s.role}` : ""}{s.sharePercent != null ? ` · ${s.sharePercent} %` : ""}{s.isPayee ? " · structure de facturation" : ""}</span></li>
                ))}
              </ul>
            )
          ) : <Hidden level={v.structures} viewer={viewer} label="Structures juridiques" />}
        </section>
      ) : null}
      {viewer === "membre" && p.dayRateCents == null && canSee(v.tarif, viewer) && <p className="text-xs"><Wallet size={12} /> Tarif non renseigné.</p>}
    </div>
  );
}
