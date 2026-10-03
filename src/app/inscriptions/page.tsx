import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { formatDateTime, formatEUR } from "@/lib/events";

export const metadata = { title: "Mes inscriptions — Kolbase" };

export default async function Page() {
  const user = await requireUser();
  const regs = await db.registration.findMany({
    where: { userId: user.id },
    include: { event: { include: { organization: { select: { name: true } } } }, benefits: { include: { benefit: true } } },
    orderBy: { event: { startsAt: "asc" } },
  });
  const now = new Date();
  const upcoming = regs.filter((r) => r.event.startsAt >= now);
  const past = regs.filter((r) => r.event.startsAt < now);

  const Row = ({ r }: { r: (typeof regs)[number] }) => {
    const total = r.benefits.reduce((s, b) => s + b.valueCents, 0);
    return (
      <Link href={`/evenements/${r.eventId}`} className="card tile">
        <strong>{r.event.title}</strong>
        <span className="muted">{formatDateTime(r.event.startsAt)} · {r.event.organization.name}</span>
        <span className="muted">
          {total === 0 ? "Aucune prestation acceptée" : `${r.benefits.map((b) => b.benefit.label).join(", ")} · ${formatEUR(total)}`}
          {r.declared && " · déclaré"}
        </span>
      </Link>
    );
  };

  return (
    <>
      <SiteHeader />
      <main className="narrow stack">
        <h1>Mes inscriptions</h1>
        <p className="muted">Les événements auxquels vous assistez. Les avantages que vous acceptez sont conventionnés et déclarés par l&apos;organisateur.</p>
        {regs.length === 0 && <p className="muted">Aucune inscription. <Link href="/evenements">Voir l&apos;agenda</Link></p>}
        {upcoming.length > 0 && <h2>À venir</h2>}
        {upcoming.map((r) => <Row key={r.id} r={r} />)}
        {past.length > 0 && <h2>Passés</h2>}
        {past.map((r) => <Row key={r.id} r={r} />)}
      </main>
    </>
  );
}
