import Link from "next/link";
import { SearchX } from "lucide-react";
import { db } from "@/lib/db";
import { requirePlatformAdmin } from "@/lib/platform";
import { ORG_FAMILIES, orgKindDisplay, VERIFICATION_LABEL } from "@/lib/org-roles";
import { formatDate } from "@/lib/events";
import { normalize } from "@/lib/search";
import { displayStatus, STATUS_LABEL } from "@/lib/billing-plans";
import { ActiveFilters, FilterChips, FilterSelect } from "@/components/Filters";
import { EmptyState } from "@/components/UI";
import { Avatar } from "@/components/Avatar";
import { logoSrc } from "@/lib/logos";
import { AdminFrame, ADMIN_HOME } from "../_parts/frame";
import { OrgCard, ORG_TONE } from "../_parts/org-card";
import type { OrgVerification } from "@/generated/prisma/client";

export const metadata = { title: "Organisations — Administration KolBase" };
export const dynamic = "force-dynamic";

const STATUTS: { value: string; label: string; v: OrgVerification }[] = [
  { value: "a-valider", label: "À valider", v: "PENDING" },
  { value: "validees", label: "Validées", v: "VERIFIED" },
  { value: "suspendues", label: "Suspendues", v: "SUSPENDED" },
  { value: "refusees", label: "Refusées", v: "REJECTED" },
];

/** Organisations : à valider en tête (décision sur place), puis l'annuaire complet, filtrable, vers la fiche de chacune. */
export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string; statut?: string; famille?: string; origine?: string }> }) {
  await requirePlatformAdmin();
  const { q = "", statut = "", famille = "", origine = "" } = await searchParams;
  const orgs = await db.organization.findMany({
    include: {
      members: { where: { role: "ADMIN" }, include: { user: { select: { email: true, firstName: true, lastName: true } } }, take: 3, orderBy: { createdAt: "asc" } },
      subscription: true,
      _count: { select: { members: true, events: true, projects: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  // Plusieurs organisations sur un même SIREN : doublon ou tentative d'usurpation, à examiner.
  const bySiren = new Map<string, typeof orgs>();
  for (const o of orgs) if (o.siren) bySiren.set(o.siren, [...(bySiren.get(o.siren) ?? []), o]);
  const twins = (o: (typeof orgs)[number]) => (o.siren ? (bySiren.get(o.siren) ?? []).filter((x) => x.id !== o.id) : []);

  const fam = ORG_FAMILIES.find((f) => f.id === famille);
  const needle = normalize(q);
  const base = orgs.filter(
    (o) =>
      (!fam || (fam.kinds as readonly string[]).includes(o.kind)) &&
      (origine !== "reelles" || !o.id.startsWith("demo-")) &&
      (origine !== "demo" || o.id.startsWith("demo-")) &&
      (!needle || [o.name, o.legalName, o.siren, o.rna, o.headquarters, ...o.members.map((m) => `${m.user.firstName} ${m.user.lastName} ${m.user.email}`)].some((x) => x && normalize(x).includes(needle))),
  );
  const st = STATUTS.find((s) => s.value === statut);
  const shown = st ? base.filter((o) => o.verification === st.v) : base;
  const pending = shown.filter((o) => o.verification === "PENDING");
  const rest = shown.filter((o) => o.verification !== "PENDING");
  const path = "/admin/organisations";
  const params = { q, statut, famille, origine };
  const now = new Date();

  return (
    <AdminFrame title="Organisations" desc="Validation (SIREN, répertoire, administrateurs), suspension, et la fiche de chaque organisation." crumbs={[ADMIN_HOME]}>
      <FilterChips
        path={path}
        params={params}
        name="statut"
        value={statut}
        options={[{ value: "", label: "Toutes", count: base.length }, ...STATUTS.map((s) => ({ value: s.value, label: s.label, count: base.filter((o) => o.verification === s.v).length }))]}
      />
      <form className="filter-bar boxed" role="search" action={path}>
        {statut && <input type="hidden" name="statut" value={statut} />}
        <label htmlFor="orgs-q" className="sr-only">Recherche</label>
        <input id="orgs-q" name="q" type="search" defaultValue={q} placeholder="Nom, raison sociale, SIREN, administrateur…" />
        <FilterSelect name="famille" label="Famille" value={famille} all="Toutes les familles" options={ORG_FAMILIES.map((f) => ({ value: f.id, label: f.label }))} />
        <FilterSelect name="origine" label="Origine" value={origine} all="Réelles et démonstration" options={[{ value: "reelles", label: "Réelles seulement" }, { value: "demo", label: "Démonstration seulement" }]} />
        <button className="btn secondary">Filtrer</button>
      </form>
      <ActiveFilters
        path={path}
        params={params}
        ariaLabel="Filtres actifs"
        clearLabel="Tout effacer"
        labels={{
          q: q && `Recherche : ${q}`,
          famille: fam ? fam.label : "",
          origine: origine === "reelles" ? "Réelles seulement" : origine === "demo" ? "Démonstration seulement" : "",
        }}
      />

      {shown.length === 0 && <div className="card empty"><EmptyState icon={SearchX} title="Aucune organisation pour ces critères." action={<Link className="btn secondary small" href={path}>Tout afficher</Link>} /></div>}

      {pending.length > 0 && (
        <section className="stack" aria-labelledby="orgs-pending">
          <h2 id="orgs-pending">À valider ({pending.length})</h2>
          {pending.map((o) => <OrgCard key={o.id} o={o} admins={o.members} twins={twins(o)} />)}
        </section>
      )}

      {rest.length > 0 && (
        <section className="card row-list" aria-labelledby="orgs-all">
          <h2 id="orgs-all" className="sr-only">Organisations</h2>
          <p className="list-meta text-sm muted">{rest.length} organisation{rest.length > 1 ? "s" : ""}</p>
          {rest.map((o) => {
            const sub = o.kind === "PRESTATAIRE" || o.verification === "VERIFIED" || o.verification === "SUSPENDED" ? displayStatus(o.subscription, now) : null;
            return (
              <Link key={o.id} href={`/admin/organisations/${o.id}`} className="row-item" id={`org-${o.id}`}>
                <span className="row-main">
                  <span className="actions" style={{ alignItems: "center", gap: 10, marginTop: 0 }}>
                    <Avatar name={o.name} size={32} square src={logoSrc(o)} />
                    <span className="row-main">
                      <span className="row-title"><strong>{o.name}</strong>{o.id.startsWith("demo-") && <span className="pill done">Démonstration</span>}</span>
                      <span className="text-sm muted">{orgKindDisplay(o)}{o.headquarters ? ` · ${o.headquarters}` : ""}{twins(o).length ? " · même SIREN qu'une autre organisation" : ""}</span>
                    </span>
                  </span>
                </span>
                <span className="row-status">
                  <span className={`pill ${ORG_TONE[o.verification]}`}>{VERIFICATION_LABEL[o.verification]}</span>
                  {sub && <span className="text-xs muted">{STATUS_LABEL[sub]}</span>}
                </span>
                <span className="row-figures">
                  <strong>{o._count.members} membre{o._count.members > 1 ? "s" : ""}</strong>
                  <span className="text-xs muted">créée le {formatDate(o.createdAt)}</span>
                </span>
              </Link>
            );
          })}
        </section>
      )}
    </AdminFrame>
  );
}
