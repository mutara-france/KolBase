import Link from "next/link";
import { redirect } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { Avatar } from "@/components/Avatar";
import { DashHead, MoreLink, Timeline, todayLabel, type TimelineItem } from "@/components/Dashboard";
import { TodoList, type TodoItem } from "@/components/Todo";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { formatDate, formatEUR } from "@/lib/events";
import { collabType } from "@/lib/projects";

export const metadata = { title: "Accueil — KolBase" };

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

/** Accueil du praticien : les sollicitations à traiter d'abord, puis le profil, les opportunités et l'agenda. */
export default async function Page() {
  const user = await requireUser();
  const p = user.practitioner;
  if (!p) redirect(user.memberships[0] ? `/organisations/${user.memberships[0].organizationId}` : "/compte");
  const now = new Date();

  const [links, regs, calls, pubCount, structCount, apps] = await Promise.all([
    db.projectExpert.findMany({ where: { practitionerId: p.id }, include: { project: { include: { organization: { select: { name: true } } } } }, orderBy: { createdAt: "desc" } }),
    db.registration.findMany({ where: { userId: user.id, event: { startsAt: { gte: now } } }, include: { event: { include: { organization: { select: { name: true } } } } }, orderBy: { event: { startsAt: "asc" } } }),
    p.listed
      ? db.openCall.findMany({
          where: { status: "open", OR: [{ deadline: null }, { deadline: { gte: now } }], applications: { none: { practitionerId: p.id } } },
          include: { organization: { select: { name: true } } },
          orderBy: { deadline: "asc" },
          take: 20,
        })
      : Promise.resolve([]),
    db.publication.count({ where: { practitionerId: p.id } }),
    db.practitionerStructure.count({ where: { practitionerId: p.id, isPayee: true } }),
    p.listed
      ? db.speakerApplication.findMany({
          where: { practitionerId: p.id, status: { in: ["pending", "retained"] }, event: { startsAt: { gte: now } } },
          include: { event: { include: { organization: { select: { name: true } } } } },
        })
      : Promise.resolve([]),
  ]);

  const changes = await db.materialVersion.findMany({
    where: { status: "changes", submittedById: user.id, material: { versions: { none: { status: { in: ["submitted", "approved"] } } } } },
    include: { material: { include: { project: { select: { id: true, title: true } } } } },
  });
  const speakerCalls = p.listed
    ? await db.event.count({
        where: { speakerCallOpen: true, publishedAt: { not: null }, startsAt: { gte: now }, OR: [{ speakerDeadline: null }, { speakerDeadline: { gte: now } }], speakerApplications: { none: { practitionerId: p.id } } },
      })
    : 0;

  const linkOf = (projectId: string) => links.find((l) => l.projectId === projectId)?.id;
  const pending = links.filter((l) => l.status === "ATT_EXPERTS" && l.project.status !== "DECLINE");
  const toSign = links.filter((l) => l.status === "SIGNATURE");
  const spec = (p.specialty ?? "").toLowerCase();
  const matching = calls.filter((c) => spec && `${c.specialty ?? ""} ${c.title}`.toLowerCase().includes(spec.split(/[ ,]/)[0]));
  const suggested = (matching.length ? matching : calls).slice(0, 2);

  // Les sollicitations sont mises en avant à part ; le reste des actions suit.
  const todos: TodoItem[] = [
    ...changes
      .filter((c) => linkOf(c.material.project.id))
      .map((c) => ({ href: `/sollicitations/${linkOf(c.material.project.id)}`, title: `Modifier le support : ${c.material.title}`, detail: c.reviewComment ?? c.material.project.title, icon: "AlertTriangle" as const, tone: "danger" as const })),
    ...toSign.map((l) => ({ href: `/sollicitations/${l.id}`, title: "Convention à signer", detail: `${l.project.title} · ${l.project.organization.name}`, icon: "FileSignature" as const, tone: "warn" as const })),
    ...(speakerCalls
      ? [{ href: "/interventions?onglet=appels", title: `${plural(speakerCalls, "appel à intervenants ouvert", "appels à intervenants ouverts")}`, detail: "Proposez votre candidature", icon: "Mic" as const }]
      : []),
  ];
  const profileTodos: TodoItem[] = p.listed
    ? [
        ...(!p.bio ? [{ href: "/compte", title: "Ajouter une présentation", detail: "Les organisations la lisent en premier.", icon: "UserRound" as const }] : []),
        ...(!p.rpps ? [{ href: "/compte", title: "Renseigner votre n° RPPS", detail: "Nécessaire aux conventions et au badge « Identité vérifiée ».", icon: "ShieldCheck" as const }] : []),
        ...(structCount === 0 ? [{ href: "/compte", title: "Déclarer votre structure de facturation", detail: "Elle figurera sur vos conventions.", icon: "FileSignature" as const }] : []),
        ...(pubCount === 0 ? [{ href: "/compte", title: "Ajouter vos publications", detail: "Elles apparaissent sur votre fiche publique.", icon: "CircleDot" as const }] : []),
      ]
    : [];

  const agenda: TimelineItem[] = [
    ...apps.map((a) => ({
      date: a.event.startsAt,
      title: a.event.title,
      detail: a.status === "retained" ? `Vous intervenez · ${a.event.organization.name}` : "Candidature d'intervenant · en attente de réponse",
      href: a.status === "retained" ? "/interventions?onglet=interventions" : "/interventions?onglet=candidatures",
      strong: a.status === "retained",
    })),
    ...regs.map((r) => ({ date: r.event.startsAt, title: r.event.title, detail: `Inscrit · ${r.event.organization.name}`, href: `/evenements/${r.eventId}`, strong: true })),
  ]
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .slice(0, 5);

  const lede = pending.length
    ? `${plural(pending.length, "sollicitation attend", "sollicitations attendent")} votre réponse.`
    : todos.length
      ? undefined
      : p.listed
        ? "Rien à traiter pour le moment."
        : "Vos inscriptions aux événements. Référencez-vous comme expert pour être sollicité.";

  return (
    <>
      <SiteHeader />
      <main className="stack dash">
        <DashHead kicker={todayLabel()} title={`Bonjour Dr ${user.lastName}.`} lede={lede} />

        {!p.listed && (
          <section className="card highlight flex-between">
            <div>
              <h2>Devenir expert référencé</h2>
              <p className="muted">Recevez des sollicitations, candidatez aux opportunités et gérez vos conventions.</p>
            </div>
            <Link className="btn" href="/compte">Me référencer</Link>
          </section>
        )}

        <div className="dash-layout">
          <section className="card dash-card" aria-labelledby="a-faire">
            <h2 id="a-faire" className="dash-title">À faire</h2>
            {pending.map((l) => (
              <article key={l.id} className="solicit-card">
                <div className="solicit-top">
                  <Avatar name={l.project.organization.name} size={40} square />
                  <p>{l.project.organization.name} vous sollicite</p>
                  <span className="pill new">À traiter</span>
                </div>
                <h3>{l.project.title}</h3>
                <div className="solicit-foot">
                  <p className="text-sm">
                    {collabType(l.project.typeId)?.label ?? "Collaboration"} · reçue le {formatDate(l.createdAt)}
                    {l.feeCents != null && (
                      <>
                        {" "}· honoraires proposés <span className="mono ink">{formatEUR(l.feeCents)} HT</span>
                      </>
                    )}
                  </p>
                  <Link className="btn" href={`/sollicitations/${l.id}`}>Voir et répondre</Link>
                </div>
              </article>
            ))}
            {(todos.length > 0 || pending.length === 0) && <TodoList items={todos} />}
            {profileTodos.length > 0 && (
              <div className="profile-steps">
                <div className="flex-between">
                  <h3>Complétez votre profil</h3>
                  <span className="text-xs">{plural(profileTodos.length, "étape restante", "étapes restantes")}</span>
                </div>
                <TodoList items={profileTodos} />
              </div>
            )}
          </section>

          <div className="stack dash-side">
            {p.listed && (
              <section className="card dash-card" aria-labelledby="pour-vous">
                <h2 id="pour-vous" className="dash-title">Pour vous</h2>
                {suggested.length === 0 ? (
                  <p className="muted">Aucun appel ouvert pour le moment.</p>
                ) : (
                  suggested.map((c) => (
                    <Link key={c.id} href={`/opportunites/${c.id}`} className="suggest-card">
                      <span className="suggest-kind">{c.specialty || collabType(c.typeId)?.label}</span>
                      <strong>{c.title}</strong>
                      <span>{c.organization.name}{c.deadline ? ` · jusqu'au ${formatDate(c.deadline)}` : ""}</span>
                    </Link>
                  ))
                )}
                <MoreLink href="/opportunites">Toutes les opportunités</MoreLink>
              </section>
            )}
            <section className="card dash-card" aria-labelledby="mon-agenda">
              <h2 id="mon-agenda" className="dash-title">Mon agenda</h2>
              <Timeline items={agenda} empty="Aucun événement à venir." />
              <MoreLink href="/evenements">Parcourir les événements</MoreLink>
            </section>
          </div>
        </div>
      </main>
    </>
  );
}
