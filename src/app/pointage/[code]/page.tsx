import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CalendarDays, Gift, UserRound } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { PresenceButton } from "@/components/CheckinForms";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { canCheckIn, checkinOpen, validCheckinCode } from "@/lib/checkin";
import { formatDate, formatEUR, formatTime } from "@/lib/events";

export const metadata = { title: "Pointage — KolBase", robots: { index: false } };

/** Page ouverte en scannant le badge d'un participant : l'organisateur (ou l'agence) confirme sa présence. */
export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (!validCheckinCode(code)) notFound();
  const user = await getCurrentUser();
  if (!user) redirect(`/connexion?next=${encodeURIComponent(`/pointage/${code}`)}`);
  const reg = await db.registration.findUnique({
    where: { checkinCode: code },
    include: {
      event: { select: { id: true, title: true, startsAt: true, organizationId: true, agencyId: true, venue: true, organization: { select: { name: true } } } },
      user: { select: { firstName: true, lastName: true } },
      benefits: { include: { benefit: { select: { label: true } } } },
    },
  });
  if (!reg || reg.cancelledAt) notFound();
  if (reg.userId === user.id) redirect(`/inscriptions/${reg.id}/badge`);
  if (!canCheckIn(user, reg.event)) notFound();
  const open = checkinOpen(reg.event.startsAt);
  const list = `/organisations/${reg.event.organizationId}/evenements/${reg.event.id}/pointage`;

  return (
    <>
      <SiteHeader />
      <main className="narrow stack">
        <p className="muted"><Link href={list}>← Liste de pointage</Link></p>
        <section className={`card stack-sm scan-card${reg.checkedInAt ? " done" : ""}`}>
          <span className="eyebrow-sm"><CalendarDays size={12} /> {reg.event.title} · {formatDate(reg.event.startsAt)}</span>
          <h1><UserRound size={22} /> {reg.user.firstName} {reg.user.lastName}</h1>
          <p className="muted">{[reg.profession, reg.structure].filter(Boolean).join(" · ") || "Participant"}</p>
          <p className="text-sm"><Gift size={13} /> {reg.benefits.length ? `${reg.benefits.map((b) => b.benefit.label).join(", ")} (${formatEUR(reg.benefits.reduce((s, b) => s + b.valueCents, 0))})` : "Aucune prestation acceptée"}</p>
          {open ? (
            <PresenceButton registrationId={reg.id} checkedAt={reg.checkedInAt ? formatTime(reg.checkedInAt) : null} big />
          ) : (
            <p className="notice">Le pointage ouvre la veille de l&apos;événement.</p>
          )}
        </section>
      </main>
    </>
  );
}
