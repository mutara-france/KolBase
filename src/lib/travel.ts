/**
 * Voyage et hébergement des participants (nuitée, transport acceptés) : ce que le participant indique (ville de
 * départ), ce que l'organisateur ou son agence réserve (hôtel, dates, chambre, billets), le carnet de voyage envoyé
 * au participant et la liste des chambres transmise à l'hôtel.
 */

export const TRAVEL_BENEFITS = ["nuitee", "transport"];
export const ROOM_TYPES = [
  { id: "single", label: "Individuelle" },
  { id: "double", label: "Double" },
] as const;
export const roomTypeLabel = (id: string | null | undefined) => ROOM_TYPES.find((r) => r.id === id)?.label ?? null;

export type TravelInput = {
  checkIn: Date | null; checkOut: Date | null; roomType: string | null; hotel: string | null; hotelRef: string | null;
  outbound: string | null; returnTrip: string | null; ticketRef: string | null; notes: string | null;
};

const text = (v: FormDataEntryValue | null, n: number) => String(v ?? "").trim().slice(0, n) || null;
const day = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "");
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T12:00:00Z`) : null;
};

/** Réservations saisies par l'organisateur : dates (départ après l'arrivée), chambre, hôtel, trajets, billets. */
export function readTravel(form: FormData): TravelInput | { error: string } {
  const checkIn = day(form.get("checkIn"));
  const checkOut = day(form.get("checkOut"));
  if (checkIn && checkOut && checkOut <= checkIn) return { error: "Le départ de l'hôtel suit l'arrivée d'au moins une nuit." };
  const room = String(form.get("roomType") ?? "");
  return {
    checkIn, checkOut,
    roomType: ROOM_TYPES.some((r) => r.id === room) ? room : null,
    hotel: text(form.get("hotel"), 160),
    hotelRef: text(form.get("hotelRef"), 80),
    outbound: text(form.get("outbound"), 300),
    returnTrip: text(form.get("returnTrip"), 300),
    ticketRef: text(form.get("ticketRef"), 120),
    notes: text(form.get("notes"), 500),
  };
}

/** Réservation renseignée (au moins un hôtel ou un trajet) : le carnet de voyage peut partir. */
export const hasBooking = (t: Partial<TravelInput> | null | undefined) => !!t && !!(t.hotel || t.checkIn || t.outbound || t.returnTrip || t.ticketRef);

/** Nuits entre l'arrivée et le départ. */
export const nights = (t: { checkIn: Date | null; checkOut: Date | null }) =>
  t.checkIn && t.checkOut ? Math.max(0, Math.round((t.checkOut.getTime() - t.checkIn.getTime()) / 86400e3)) : null;
