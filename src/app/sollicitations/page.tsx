import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { StatusPill } from "@/components/ProjectBits";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { formatDate, formatEUR } from "@/lib/events";
import { collabType } from "@/lib/projects";

export const metadata = { title: "Mes sollicitations — Kolbase" };

export default async function Page() {
  const user = await requireUser();
  const links = user.practitioner
    ? await db.projectExpert.findMany({
        where: { practitionerId: user.practitioner.id },
        include: { project: { include: { organization: { select: { name: true } } } } },
        orderBy: { createdAt: "desc" },
      })
    : [];
  const pending = links.filter((l) => l.status === "ATT_EXPERTS" && l.project.status !== "DECLINE");
  const others = links.filter((l) => !pending.includes(l));

  const Tile = ({ l }: { l: (typeof links)[number] }) => (
    <Link href={`/sollicitations/${l.id}`} className="card tile">
      <strong>{l.project.title}</strong>
      <span className="muted">{l.project.organization.name} · {collabType(l.project.typeId)?.label} · {l.feeCents != null ? formatEUR(l.feeCents) + " HT" : "—"}</span>
      <span className="muted">Reçue le {formatDate(l.createdAt)}</span>
      <StatusPill status={l.status === "ATT_EXPERTS" && l.project.status === "DECLINE" ? "DECLINE" : l.status} />
    </Link>
  );

  return (
    <>
      <SiteHeader />
      <main className="narrow stack">
        <h1>Mes sollicitations</h1>
        {!user.practitioner?.listed && <p className="notice warn">Référencez-vous comme expert dans <Link href="/compte">Mon compte</Link> pour recevoir des sollicitations.</p>}
        {links.length === 0 && <p className="muted">Aucune sollicitation pour l&apos;instant.</p>}
        {pending.length > 0 && <h2>À traiter ({pending.length})</h2>}
        {pending.map((l) => <Tile key={l.id} l={l} />)}
        {others.length > 0 && <h2>Historique</h2>}
        {others.map((l) => <Tile key={l.id} l={l} />)}
      </main>
    </>
  );
}
