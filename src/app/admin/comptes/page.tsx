import Link from "next/link";
import { SearchX } from "lucide-react";
import { db } from "@/lib/db";
import { requirePlatformAdmin } from "@/lib/platform";
import { formatDate } from "@/lib/events";
import { DEMO_EMAIL_DOMAIN } from "@/lib/demo";
import { realUser } from "@/lib/admin-data";
import { ActiveFilters, FilterChips, FilterSelect } from "@/components/Filters";
import { EmptyState } from "@/components/UI";
import { AdminFrame, ADMIN_HOME } from "../_parts/frame";
import type { Prisma } from "@/generated/prisma/client";

export const metadata = { title: "Comptes — Administration KolBase" };
export const dynamic = "force-dynamic";

const PAGE = 50;

const PROFILS: Record<string, { label: string; where: Prisma.UserWhereInput }> = {
  expert: { label: "Experts référencés", where: { practitioner: { listed: true } } },
  praticien: { label: "Praticiens non référencés", where: { practitioner: { listed: false } } },
  membre: { label: "Membres d'organisation", where: { memberships: { some: {} } } },
  sans: { label: "Sans profil ni organisation", where: { practitioner: null, memberships: { none: {} } } },
};
const ETATS: Record<string, { label: string; where: Prisma.UserWhereInput }> = {
  "non-confirmes": { label: "Adresse non confirmée", where: { emailVerifiedAt: null } },
  desactives: { label: "Désactivés", where: { disabledAt: { not: null } } },
  "avec-2fa": { label: "Double authentification activée", where: { totpEnabledAt: { not: null } } },
  "sans-2fa": { label: "Sans double authentification", where: { totpEnabledAt: null } },
};

/** Comptes : recherche par nom ou adresse, filtres par profil et par état, vers la fiche de chacun. */
export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string; profil?: string; etat?: string; origine?: string; page?: string }> }) {
  await requirePlatformAdmin();
  const { q = "", profil = "", etat = "", origine = "", page = "1" } = await searchParams;
  const n = Math.max(1, Number.parseInt(page, 10) || 1);
  const words = q.trim().split(/\s+/).filter(Boolean).slice(0, 4);
  const filters: Prisma.UserWhereInput[] = [
    // Comptes anonymisés après suppression : jamais listés.
    { email: { not: { endsWith: "@kolbase.invalid" } } },
    ...(origine === "reels" ? [realUser] : origine === "demo" ? [{ email: { endsWith: DEMO_EMAIL_DOMAIN } }] : []),
    ...words.map((w) => ({ OR: [{ firstName: { contains: w, mode: "insensitive" as const } }, { lastName: { contains: w, mode: "insensitive" as const } }, { email: { contains: w, mode: "insensitive" as const } }] })),
    ...(PROFILS[profil] ? [PROFILS[profil].where] : []),
  ];
  const where: Prisma.UserWhereInput = { AND: filters };
  const [byState, users] = await Promise.all([
    Promise.all(Object.values(ETATS).map((e) => db.user.count({ where: { AND: [...filters, e.where] } }))),
    db.user.findMany({
      where: ETATS[etat] ? { AND: [...filters, ETATS[etat].where] } : where,
      select: {
        id: true, email: true, firstName: true, lastName: true, createdAt: true, emailVerifiedAt: true, totpEnabledAt: true, disabledAt: true,
        practitioner: { select: { listed: true, profession: true, rppsVerified: true } },
        memberships: { select: { organization: { select: { name: true } } } },
        sessions: { select: { createdAt: true }, orderBy: { createdAt: "desc" }, take: 1 },
      },
      orderBy: { createdAt: "desc" },
      skip: (n - 1) * PAGE,
      take: PAGE + 1,
    }),
  ]);
  const total = await db.user.count({ where });
  const more = users.length > PAGE;
  const list = users.slice(0, PAGE);
  const path = "/admin/comptes";
  const params = { q, profil, etat, origine };
  const pageHref = (p: number) => `${path}?${new URLSearchParams(Object.entries({ ...params, page: String(p) }).filter(([, v]) => v && v !== "1")).toString()}`;

  return (
    <AdminFrame title="Comptes" desc="Toutes les personnes inscrites : profil, organisations, sécurité. La fiche de chacune permet d'agir sur son compte." crumbs={[ADMIN_HOME]}>
      <FilterChips
        path={path}
        params={params}
        name="etat"
        value={etat}
        options={[{ value: "", label: "Tous", count: total }, ...Object.entries(ETATS).map(([value, e], i) => ({ value, label: e.label, count: byState[i] }))]}
      />
      <form className="filter-bar boxed" role="search" action={path}>
        {etat && <input type="hidden" name="etat" value={etat} />}
        <label htmlFor="comptes-q" className="sr-only">Recherche</label>
        <input id="comptes-q" name="q" type="search" defaultValue={q} placeholder="Nom, prénom ou adresse e-mail…" />
        <FilterSelect name="profil" label="Profil" value={profil} all="Tous les profils" options={Object.entries(PROFILS).map(([value, p]) => ({ value, label: p.label }))} />
        <FilterSelect name="origine" label="Origine" value={origine} all="Réels et démonstration" options={[{ value: "reels", label: "Réels seulement" }, { value: "demo", label: "Démonstration seulement" }]} />
        <button className="btn secondary">Filtrer</button>
      </form>
      <ActiveFilters
        path={path}
        params={params}
        ariaLabel="Filtres actifs"
        clearLabel="Tout effacer"
        labels={{ q: q && `Recherche : ${q}`, profil: PROFILS[profil]?.label ?? "", origine: origine === "reels" ? "Réels seulement" : origine === "demo" ? "Démonstration seulement" : "" }}
      />

      {list.length === 0 ? (
        <div className="card empty"><EmptyState icon={SearchX} title="Aucun compte pour ces critères." action={<Link className="btn secondary small" href={path}>Tout afficher</Link>} /></div>
      ) : (
        <section className="card row-list" aria-label="Comptes">
          <p className="list-meta text-sm muted">{ETATS[etat] ? byState[Object.keys(ETATS).indexOf(etat)] : total} compte{(ETATS[etat] ? byState[Object.keys(ETATS).indexOf(etat)] : total) > 1 ? "s" : ""}{n > 1 ? ` · page ${n}` : ""}</p>
          {list.map((u) => {
            const p = u.practitioner;
            const orgs = [...new Set(u.memberships.map((m) => m.organization.name))];
            const last = u.sessions[0]?.createdAt;
            return (
              <Link key={u.id} href={`/admin/comptes/${u.id}`} className="row-item" id={`compte-${u.id}`}>
                <span className="row-main">
                  <span className="row-title"><strong>{u.firstName} {u.lastName}</strong>{u.email.endsWith(DEMO_EMAIL_DOMAIN) && <span className="pill done">Démonstration</span>}</span>
                  <span className="text-sm muted">{u.email}</span>
                  <span className="text-xs muted">
                    {[p ? `${p.profession}${p.listed ? " · expert référencé" : ""}${p.rppsVerified ? " · identité vérifiée" : ""}` : null, orgs.length ? orgs.join(", ") : null].filter(Boolean).join(" · ") || "Sans profil ni organisation"}
                  </span>
                </span>
                <span className="row-status">
                  {u.disabledAt ? <span className="pill bad">Désactivé</span> : !u.emailVerifiedAt ? <span className="pill wait">Adresse non confirmée</span> : <span className="pill ok">Actif</span>}
                  {u.totpEnabledAt && <span className="text-xs muted">Double authentification</span>}
                </span>
                <span className="row-figures">
                  <strong>{formatDate(last ?? u.createdAt)}</strong>
                  <span className="text-xs muted">{last ? "dernière connexion" : "inscription"}</span>
                </span>
              </Link>
            );
          })}
          {(n > 1 || more) && (
            <nav className="actions spread" aria-label="Pages">
              {n > 1 ? <Link className="btn ghost small" href={pageHref(n - 1)}>Page précédente</Link> : <span />}
              {more && <Link className="btn ghost small" href={pageHref(n + 1)}>Page suivante</Link>}
            </nav>
          )}
        </section>
      )}
    </AdminFrame>
  );
}
