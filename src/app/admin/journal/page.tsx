import Link from "next/link";
import { SearchX } from "lucide-react";
import { db } from "@/lib/db";
import { requirePlatformAdmin } from "@/lib/platform";
import { auditLabel, auditTone, ENTITY_LABELS, entityHref, JOURNAL_DOMAINS } from "@/lib/admin-labels";
import { STATUS_LABEL as PROJECT_STATUS } from "@/lib/projects";
import { ActiveFilters, FilterChips, FilterSelect } from "@/components/Filters";
import { EmptyState } from "@/components/UI";
import { AdminFrame, ADMIN_HOME } from "../_parts/frame";
import type { Prisma } from "@/generated/prisma/client";

export const metadata = { title: "Journal d'activité — Administration KolBase" };
export const dynamic = "force-dynamic";

const PAGE = 100;
const PERIODES: Record<string, { label: string; days: number }> = {
  "24h": { label: "24 heures", days: 1 },
  "7j": { label: "7 jours", days: 7 },
  "30j": { label: "30 jours", days: 30 },
  "90j": { label: "90 jours", days: 90 },
};

const time = (d: Date) => d.toLocaleString("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** Détail lisible d'une entrée : motif ou note d'abord, sinon quelques champs, jamais d'objet entier. */
function detail(data: Prisma.JsonValue) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;
  if (typeof d.note === "string" && d.note) return `« ${d.note} »`;
  // Changement de statut d'un dossier : « En validation conformité → Validé par la conformité ».
  const st = (v: unknown) => (typeof v === "string" && v in PROJECT_STATUS ? PROJECT_STATUS[v as keyof typeof PROJECT_STATUS] : String(v));
  if (d.from != null && d.to != null) return `${st(d.from)} → ${st(d.to)}`;
  const parts = Object.entries(d)
    .filter(([, v]) => v != null && v !== "" && (typeof v !== "object" || Array.isArray(v)))
    .slice(0, 3)
    .map(([k, v]) => `${k} : ${Array.isArray(v) ? v.join(", ") : String(v)}`.slice(0, 80));
  return parts.length ? parts.join(" · ") : null;
}

/** Journal d'activité de la plateforme (AuditLog) : qui a fait quoi, quand, sur quel objet ; filtres par domaine, période, personne. */
export default async function Page({ searchParams }: { searchParams: Promise<{ domaine?: string; periode?: string; type?: string; acteur?: string; objet?: string; q?: string; page?: string }> }) {
  await requirePlatformAdmin();
  const { domaine = "", periode = "30j", type = "", acteur = "", objet = "", q = "", page = "1" } = await searchParams;
  const n = Math.max(1, Number.parseInt(page, 10) || 1);
  const dom = JOURNAL_DOMAINS.find((d) => d.value === domaine);
  const per = PERIODES[periode];
  const where: Prisma.AuditLogWhereInput = {
    AND: [
      per ? { createdAt: { gte: new Date(Date.now() - per.days * 864e5) } } : {},
      dom ? { OR: dom.prefixes.map((p) => ({ action: { startsWith: p } })) } : {},
      type ? { entityType: type } : {},
      acteur ? { actorId: acteur } : {},
      objet ? { entityId: objet } : {},
      q ? { action: { contains: q.trim(), mode: "insensitive" } } : {},
    ],
  };
  const [entries, total, types, who] = await Promise.all([
    db.auditLog.findMany({ where, include: { actor: { select: { id: true, firstName: true, lastName: true, email: true } } }, orderBy: { createdAt: "desc" }, skip: (n - 1) * PAGE, take: PAGE + 1 }),
    db.auditLog.count({ where }),
    db.auditLog.groupBy({ by: ["entityType"], _count: { _all: true }, orderBy: { entityType: "asc" } }),
    acteur ? db.user.findUnique({ where: { id: acteur }, select: { firstName: true, lastName: true } }) : null,
  ]);
  const more = entries.length > PAGE;
  const list = entries.slice(0, PAGE);
  const path = "/admin/journal";
  const params = { domaine, periode, type, acteur, objet, q };
  const pageHref = (p: number) => `${path}?${new URLSearchParams(Object.entries({ ...params, page: String(p) }).filter(([, v]) => v && v !== "1")).toString()}`;

  return (
    <AdminFrame title="Journal d'activité" desc="Toutes les actions enregistrées : connexions, décisions de KolBase, dossiers, événements, devis, facturation." crumbs={[ADMIN_HOME]}>
      <FilterChips
        path={path}
        params={params}
        name="periode"
        value={periode}
        options={[...Object.entries(PERIODES).map(([value, p]) => ({ value, label: p.label })), { value: "tout", label: "Depuis le début" }]}
      />
      <form className="filter-bar boxed" role="search" action={path}>
        <input type="hidden" name="periode" value={periode} />
        {acteur && <input type="hidden" name="acteur" value={acteur} />}
        {objet && <input type="hidden" name="objet" value={objet} />}
        <label htmlFor="journal-q" className="sr-only">Code d&apos;action</label>
        <input id="journal-q" name="q" type="search" defaultValue={q} placeholder="Code d'action (signin, award, publish…)" />
        <FilterSelect name="domaine" label="Domaine" value={domaine} all="Tous les domaines" options={JOURNAL_DOMAINS.map((d) => ({ value: d.value, label: d.label }))} />
        <FilterSelect name="type" label="Objet" value={type} all="Tous les objets" options={types.map((t) => ({ value: t.entityType, label: `${ENTITY_LABELS[t.entityType] ?? t.entityType} (${t._count._all})` }))} />
        <button className="btn secondary">Filtrer</button>
      </form>
      <ActiveFilters
        path={path}
        params={params}
        ariaLabel="Filtres actifs"
        clearLabel="Tout effacer"
        labels={{
          domaine: dom?.label ?? "",
          type: type && `Objet : ${ENTITY_LABELS[type] ?? type}`,
          acteur: acteur && `Par ${who ? `${who.firstName} ${who.lastName}` : "un compte supprimé"}`,
          objet: objet && "Un seul objet",
          q: q && `Action : ${q}`,
        }}
      />

      {list.length === 0 ? (
        <div className="card empty"><EmptyState icon={SearchX} title="Aucune entrée pour ces critères." action={<Link className="btn secondary small" href={`${path}?periode=tout`}>Tout le journal</Link>} /></div>
      ) : (
        <section className="card stack-sm" aria-label="Entrées du journal">
          <p className="list-meta text-sm muted">{total.toLocaleString("fr-FR")} entrée{total > 1 ? "s" : ""}{n > 1 ? ` · page ${n}` : ""}</p>
          <ul className="journal-list full">
            {list.map((e) => {
              const href = entityHref(e.entityType, e.entityId);
              const label = ENTITY_LABELS[e.entityType] ?? e.entityType;
              const extra = detail(e.data);
              return (
                <li key={e.id}>
                  <span className="text-xs muted mono">{time(e.createdAt)}</span>
                  <span className="stack-xs">
                    <span><span className={`pill ${auditTone(e.action)}`}>{auditLabel(e.action)}</span> <code className="text-xs muted">{e.action}</code></span>
                    <span className="text-xs muted">{href ? <Link href={href}>{label}</Link> : label} · <Link href={`${path}?periode=tout&objet=${encodeURIComponent(e.entityId)}`} className="mono">{e.entityId.slice(0, 12)}</Link>{extra ? ` · ${extra}` : ""}</span>
                  </span>
                  <span className="text-sm">{e.actor ? <Link href={`/admin/comptes/${e.actor.id}`}>{e.actor.firstName} {e.actor.lastName}</Link> : <span className="muted">Système</span>}</span>
                </li>
              );
            })}
          </ul>
          {(n > 1 || more) && (
            <nav className="actions spread" aria-label="Pages">
              {n > 1 ? <Link className="btn ghost small" href={pageHref(n - 1)}>Plus récentes</Link> : <span />}
              {more && <Link className="btn ghost small" href={pageHref(n + 1)}>Plus anciennes</Link>}
            </nav>
          )}
        </section>
      )}
    </AdminFrame>
  );
}
