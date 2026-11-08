import { db } from "@/lib/db";
import { requireMembership } from "@/lib/orgs";
import { EVENT_MANAGER_ROLES, eventScope, formatDate, toCSV } from "@/lib/events";
import { nights, roomTypeLabel, TRAVEL_BENEFITS } from "@/lib/travel";
import { audit } from "@/lib/auth";

/** Liste des chambres pour l'hôtel (CSV) : participants avec une nuitée, dates, type de chambre, réservation. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string; eventId: string }> }) {
  const { id, eventId } = await params;
  const { user, roles } = await requireMembership(id, EVENT_MANAGER_ROLES);
  const event = await db.event.findFirst({ where: { id: eventId, organizationId: id, ...eventScope(user, roles) }, select: { id: true } });
  if (!event) return new Response("Introuvable", { status: 404 });
  const regs = await db.registration.findMany({
    where: { eventId, cancelledAt: null, benefits: { some: { benefit: { catalogId: { in: TRAVEL_BENEFITS.filter((b) => b === "nuitee") } } } } },
    include: { user: { select: { firstName: true, lastName: true } }, travel: true },
    orderBy: { user: { lastName: "asc" } },
  });
  const rows: unknown[][] = [["Nom", "Prénom", "Arrivée", "Départ", "Nuits", "Chambre", "Hôtel", "N° de réservation", "Remarque"]];
  for (const r of regs) {
    const tr = r.travel;
    rows.push([r.user.lastName.toUpperCase(), r.user.firstName, tr?.checkIn ? formatDate(tr.checkIn) : "", tr?.checkOut ? formatDate(tr.checkOut) : "", tr ? nights(tr) ?? "" : "", roomTypeLabel(tr?.roomType) ?? "", tr?.hotel ?? "", tr?.hotelRef ?? "", tr?.notes ?? ""]);
  }
  await audit(user.id, "event.rooming_list", "Event", eventId, { rows: regs.length });
  return new Response(toCSV(rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="chambres-${eventId}.csv"`, "Cache-Control": "private, no-store" } });
}
