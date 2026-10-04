/** Génération de calendriers iCalendar (RFC 5545) : import dans Outlook, Google Agenda, Apple Calendrier. */
export type IcsEvent = { uid: string; start: Date; minutes: number | null; title: string; location?: string | null; description?: string | null; url?: string };

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

// Repli des lignes à 75 octets (continuation par une espace).
function fold(line: string) {
  const bytes = new TextEncoder();
  if (bytes.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = "";
  for (const ch of line) {
    if (bytes.encode(cur + ch).length > (out.length ? 74 : 75)) { out.push(cur); cur = ""; }
    cur += ch;
  }
  out.push(cur);
  return out.join("\r\n ");
}

export function toIcs(name: string, events: IcsEvent[]) {
  const now = stamp(new Date());
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Kolbase//Agenda//FR", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${esc(name)}`, "X-WR-TIMEZONE:Europe/Paris"];
  for (const e of events) {
    const end = new Date(e.start.getTime() + (e.minutes ?? 60) * 60000);
    lines.push(
      "BEGIN:VEVENT", `UID:${e.uid}@kolbase`, `DTSTAMP:${now}`, `DTSTART:${stamp(e.start)}`, `DTEND:${stamp(end)}`, `SUMMARY:${esc(e.title)}`,
      ...(e.location ? [`LOCATION:${esc(e.location)}`] : []),
      ...(e.description || e.url ? [`DESCRIPTION:${esc([e.description, e.url].filter(Boolean).join("\n\n"))}`] : []),
      ...(e.url ? [`URL:${e.url}`] : []),
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

export function icsResponse(filename: string, body: string) {
  return new Response(body, { headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"` } });
}

export const appUrl = () => (process.env.APP_URL ?? "").replace(/\/$/, "");
export const eventLocation = (e: { format: string; venue: string | null; city: string | null }) =>
  e.format === "DISTANCIEL" ? "Visioconférence" : [e.venue, e.city].filter(Boolean).join(", ") || null;
