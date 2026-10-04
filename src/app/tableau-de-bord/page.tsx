import Link from "next/link";
import { redirect } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { StatCard } from "@/components/PublicCards";
import { TodoList, type TodoItem } from "@/components/Todo";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { formatDate, formatDateTime } from "@/lib/events";
import { collabType } from "@/lib/projects";

export const metadata = { title: "Tableau de bord — Kolbase" };

export default async function Page() {
  const user = await requireUser();
  const p = user.practitioner;
  if (!p) redirect(user.memberships[0] ? `/organisations/${user.memberships[0].organizationId}` : "/compte");
  const now = new Date();
  const in30 = new Date(Date.now() + 30 * 864e5);

  const [links, regs, calls, pubCount, structCount] = await Promise.all([
    db.projectExpert.findMany({ where: { practitionerId: p.id }, include: { project: { include: { organization: { select: { name: true } } } } }, orderBy: { createdAt: "desc" } }),
    db.registration.findMany({ where: { userId: user.id, event: { startsAt: { gte: now } } }, include: { event: { include: { organization: { select: { name: true } } } } }, orderBy: { event: { startsAt: "asc" } } }),
    p.listed
      ? db.openCall.findMany({
          where: { status: "open", OR: [{ deadline: null }, { deadline: { gte: now } }], applications: { none: { practitionerId: p.id } } },
          include: { organization: { select: { name: true } } }, orderBy: { deadline: "asc" }, take: 20,
        })
      : Promise.resolve([]),
    db.publication.count({ where: { practitionerId: p.id } }),
    db.practitionerStructure.count({ where: { practitionerId: p.id, isPayee: true } }),
  ]);

  const pending = links.filter((l) => l.status === "ATT_EXPERTS" && l.project.status !== "DECLINE");
  const active = links.filter((l) => !["ATT_EXPERTS", "DECLINE", "TERMINE"].includes(l.status));
  const toSign = links.filter((l) => l.status === "SIGNATURE");
  const spec = (p.specialty ?? "").toLowerCase();
  const matching = calls.filter((c) => spec && `${c.specialty ?? ""} ${c.title}`.toLowerCase().includes(spec.split(/[ ,]/)[0]));
  const suggested = (matching.length ? matching : calls).slice(0, 3);

  const todos: TodoItem[] = [
    ...pending.map((l) => ({ href: `/sollicitations/${l.id}`, title: `Répondre à ${l.project.organization.name}`, detail: `${l.project.title} · reçue le ${formatDate(l.createdAt)}`, icon: "Inbox" as const })),
    ...toSign.map((l) => ({ href: `/sollicitations/${l.id}`, title: "Convention à signer", detail: `${l.project.title} · ${l.project.organization.name}`, icon: "FileSignature" as const, tone: "warn" as const })),
    ...regs.filter((r) => r.event.startsAt <= in30).map((r) => ({ href: `/evenements/${r.eventId}`, title: `Bientôt : ${r.event.title}`, detail: formatDateTime(r.event.startsAt), icon: "CalendarClock" as const, tone: "ok" as const })),
  ];
  const profileTodos: TodoItem[] = p.listed
    ? [
        ...(!p.bio ? [{ href: "/compte", title: "Ajouter une présentation", detail: "Les organisations la lisent en premier.", icon: "UserRound" as const, tone: "warn" as const }] : []),
        ...(!p.rpps ? [{ href: "/compte", title: "Renseigner votre n° RPPS", detail: "Nécessaire aux conventions et au badge « Vérifié ».", icon: "ShieldCheck" as const, tone: "warn" as const }] : []),
        ...(structCount === 0 ? [{ href: "/compte", title: "Déclarer votre structure de facturation", detail: "Elle figurera sur vos conventions.", icon: "FileSignature" as const, tone: "warn" as const }] : []),
        ...(pubCount === 0 ? [{ href: "/compte", title: "Ajouter vos publications", icon: "CircleDot" as const }] : []),
      ]
    : [];

  return (
    <>
      <SiteHeader />
      <main className="stack">
        <div>
          <span className="eyebrow">{p.listed ? "Espace expert" : "Espace praticien"}</span>
          <h1>Bonjour Dr {user.lastName}</h1>
          <p className="muted">{p.listed ? "Vos sollicitations, dossiers et événements en un coup d'œil." : "Vos inscriptions aux événements. Référencez-vous comme expert pour être sollicité."}</p>
        </div>

        {!p.listed && (
          <section className="card highlight flex-between">
            <div><h2>Devenir expert référencé</h2><p className="muted">Recevez des sollicitations, candidatez aux opportunités et gérez vos conventions.</p></div>
            <Link className="btn" href="/compte">Me référencer</Link>
          </section>
        )}

        <div className="stats-row">
          {p.listed && <StatCard label="Sollicitations à traiter" value={pending.length} electric={pending.length > 0} />}
          {p.listed && <StatCard label="Dossiers en cours" value={active.length} />}
          <StatCard label="Inscriptions à venir" value={regs.length} />
          {p.listed && <StatCard label="Opportunités ouvertes" value={calls.length} hint={matching.length ? `${matching.length} dans votre spécialité` : undefined} />}
        </div>

        <div className="grid-2 dash-grid">
          <section className="card">
            <h2 className="section-title">À faire</h2>
            <TodoList items={todos} />
            {profileTodos.length > 0 && (<><div className="hairline mt-3 mb-3" /><h2 className="section-title">Compléter mon profil</h2><TodoList items={profileTodos} /></>)}
          </section>
          <section className="card">
            <h2 className="section-title">Mes prochains événements</h2>
            {regs.length === 0 ? <p className="muted">Aucune inscription à venir. <Link href="/evenements">Voir l&apos;agenda</Link></p> : (
              <ul className="mini-list">
                {regs.slice(0, 5).map((r) => (
                  <li key={r.id}><Link href={`/evenements/${r.eventId}`}><strong>{r.event.title}</strong></Link><span className="text-xs">{formatDateTime(r.event.startsAt)} · {r.event.organization.name}</span></li>
                ))}
              </ul>
            )}
            {p.listed && (
              <>
                <div className="hairline mt-3 mb-3" />
                <h2 className="section-title">Opportunités pour vous</h2>
                {suggested.length === 0 ? <p className="muted">Aucun appel ouvert pour le moment.</p> : (
                  <ul className="mini-list">
                    {suggested.map((c) => (
                      <li key={c.id}><Link href={`/opportunites/${c.id}`}><strong>{c.title}</strong></Link><span className="text-xs">{c.organization.name} · {collabType(c.typeId)?.label}{c.deadline ? ` · jusqu'au ${formatDate(c.deadline)}` : ""}</span></li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </section>
        </div>

        {p.listed && active.length > 0 && (
          <section className="card">
            <h2 className="section-title">Mes dossiers en cours</h2>
            <ul className="mini-list">
              {active.map((l) => (
                <li key={l.id}><Link href={`/sollicitations/${l.id}`}><strong>{l.project.title}</strong></Link><span className="text-xs">{l.project.organization.name} · {collabType(l.project.typeId)?.label}</span></li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </>
  );
}
