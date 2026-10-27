import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { CreateMenu, DashHead, DashStats, Timeline, TodoGroups, todayLabel, type TimelineItem } from "@/components/Dashboard";
import { requireMembership } from "@/lib/orgs";
import { orgOverview } from "@/lib/org-overview";
import { formatEUR } from "@/lib/events";
import { supplierCategoryLabel } from "@/lib/suppliers";

export const metadata = { title: "Accueil — KolBase" };

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

/** Accueil d'une organisation : ce qui attend une action, puis ce qui arrive. Le reste est dans les rubriques. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user } = await requireMembership(id);
  const o = await orgOverview(id);
  if (!o) notFound();
  const { org, can, todos, projects, events, calls, hosp, rfqs } = o;
  const now = new Date();
  const base = `/organisations/${id}`;

  const active = projects.filter((p) => !["TERMINE", "DECLINE"].includes(p.status));
  const engaged = active.flatMap((p) => p.experts.filter((e) => !["ATT_EXPERTS", "DECLINE"].includes(e.status)));
  const upcoming = events.filter((e) => e.startsAt >= now);
  const pendingApps = calls.reduce((s, c) => s + c.applications.length, 0);
  const hospValue = hosp.reduce((s, r) => s + r.benefits.reduce((x, b) => x + b.valueCents, 0), 0);

  // Trois repères au plus, choisis selon les droits.
  const stats = [
    can.view && { href: `${base}/dossiers`, value: active.length, label: "Dossiers en cours", hint: plural(engaged.length, "expert engagé", "experts engagés") },
    can.view && { href: `${base}/dossiers`, value: formatEUR(engaged.reduce((s, e) => s + (e.feeCents ?? 0), 0)), label: "Engagés (HT)", hint: "Sur les dossiers en cours" },
    can.events && { href: `${base}/evenements`, value: upcoming.length, label: "Événements à venir", hint: plural(upcoming.reduce((s, e) => s + e._count.registrations, 0), "inscrit", "inscrits") },
    can.sourcing && { href: `${base}/opportunites`, value: pendingApps, label: "Candidatures à traiter", hint: plural(calls.length, "appel ouvert", "appels ouverts") },
    can.compliance && { href: `${base}/conformite`, value: projects.filter((p) => p.status === "EN_VALID").length, label: "Dossiers à valider" },
    can.compliance && { href: `${base}/hospitalites`, value: hosp.length, label: "Hospitalités à déclarer", hint: formatEUR(hospValue) },
  ]
    .filter((s): s is Exclude<typeof s, false> => !!s)
    .slice(0, 3);

  const timeline: TimelineItem[] = [
    ...upcoming.map((e) => ({
      date: e.startsAt,
      title: e.title,
      detail: [e.city ?? (e.format === "DISTANCIEL" ? "En ligne" : null), `${plural(e._count.registrations, "inscrit", "inscrits")}${e.capacity ? ` sur ${e.capacity}` : ""}`, e.publishedAt ? null : "brouillon"]
        .filter(Boolean)
        .join(" · "),
      href: can.events ? `${base}/evenements/${e.id}` : `/evenements/${e.id}`,
      strong: true,
    })),
    ...(can.organizer
      ? rfqs
          .filter((r) => r.status === "sent" && r.deadline && r.deadline >= now)
          .map((r) => ({ date: r.deadline!, title: `Limite des devis : ${supplierCategoryLabel(r.category).toLowerCase()}`, detail: r.event?.title, href: `${base}/prestataires` }))
      : []),
    ...calls
      .filter((c) => c.deadline && c.deadline >= now)
      .map((c) => ({
        date: c.deadline!,
        title: `Clôture de l'appel : ${c.title}`,
        detail: c.applications.length ? plural(c.applications.length, "candidature à examiner", "candidatures à examiner") : "Aucune candidature à examiner",
        href: `${base}/opportunites/${c.id}`,
      })),
  ]
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .slice(0, 6);

  const create = [
    can.sourcing && { href: `${base}/dossiers/nouveau`, label: "Un dossier de collaboration" },
    can.organizer && { href: `${base}/evenements/nouveau`, label: "Un événement" },
    can.sourcing && { href: `${base}/opportunites#nouvel-appel`, label: "Un appel aux praticiens" },
    can.organizer && { href: `${base}/intervenants`, label: "Un appel à intervenants" },
  ].filter((c): c is Exclude<typeof c, false> => !!c);

  const urgent = todos.filter((t) => t.tone === "danger").length;
  const lede =
    todos.length === 0
      ? "Rien à traiter pour le moment."
      : `${plural(todos.length, "action vous attend", "actions vous attendent")}${urgent ? `, dont ${plural(urgent, "urgente", "urgentes")}` : ""}.`;

  return (
    <>
      <SiteHeader />
      <main className="stack dash">
        <DashHead kicker={`${todayLabel()} · ${org.name}`} title={`Bonjour ${user.firstName}.`} lede={lede} action={<CreateMenu items={create} />} />
        <DashStats stats={stats} />
        <div className={`dash-layout${timeline.length ? "" : " single"}`}>
          <section className="card dash-card" aria-labelledby="a-faire">
            <h2 id="a-faire" className="dash-title">
              À faire {todos.length > 0 && <span className="count-pill">{todos.length}</span>}
            </h2>
            <TodoGroups todos={todos} />
          </section>
          {timeline.length > 0 && (
            <section className="card dash-card" aria-labelledby="a-venir">
              <h2 id="a-venir" className="dash-title">À venir</h2>
              <Timeline items={timeline} />
            </section>
          )}
        </div>
      </main>
    </>
  );
}
