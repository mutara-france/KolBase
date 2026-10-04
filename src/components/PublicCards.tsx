import Link from "next/link";
import { BadgeCheck, BookOpen, Calendar, ChevronRight, Clock, MapPin, Ticket, Users, Video } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { eventTypeLabel, formatEUR, TZ } from "@/lib/events";
import { collabType } from "@/lib/projects";

/* Cartes publiques reprises du prototype (EventCard, PublicKolCard, PublicCompanyCard, OpenProjectCard, StatCard). */

const hashCode = (s: string) => [...s].reduce((h, c) => (Math.imul(31, h) + c.charCodeAt(0)) | 0, 0);
const HUES = [214, 232, 258, 276, 192, 168, 24, 340];
const hueOf = (s: string) => HUES[Math.abs(hashCode(s)) % HUES.length];
const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

export function AreaArt({ seed, height = 132, label }: { seed: string; height?: number; label?: string | null }) {
  const hue = hueOf(seed);
  const h2 = (hue + 40) % 360;
  const n = Math.abs(hashCode(seed)) % 3;
  const id = `g-${Math.abs(hashCode(seed))}`;
  return (
    <div className="area-art" style={{ height }}>
      <svg viewBox="0 0 400 160" preserveAspectRatio="none" width="100%" height="100%" aria-hidden>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={`hsl(${hue} 74% 52%)`} />
            <stop offset="100%" stopColor={`hsl(${h2} 68% 34%)`} />
          </linearGradient>
        </defs>
        <rect width="400" height="160" fill={`url(#${id})`} />
        <g fill="none" stroke="rgba(255,255,255,.28)" strokeWidth="1.4">
          {n === 0 && [0, 1, 2, 3, 4, 5].map((i) => <circle key={i} cx={60 + i * 58} cy={80} r={18 + i * 9} />)}
          {n === 1 && [0, 1, 2, 3, 4, 5, 6].map((i) => <path key={i} d={`M${-20 + i * 64} 170 Q ${20 + i * 64} 70 ${80 + i * 64} 170`} />)}
          {n === 2 && [0, 1, 2, 3, 4, 5, 6, 7].map((i) => <line key={i} x1={i * 60 - 40} y1="170" x2={i * 60 + 60} y2="-10" />)}
        </g>
      </svg>
      {label && <span className="area-art-label">{label}</span>}
    </div>
  );
}

export function StatCard({ label, value, hint, electric }: { label: string; value: number | string; hint?: string; electric?: boolean }) {
  return (
    <div className="stat-card">
      <div className={`stat-value${electric ? " tone-electric" : ""}`}>{value}</div>
      <div className="stat-label">{label}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

export type EventCardData = {
  id: string; title: string; typeId: string; therapeuticArea: string | null; startsAt: Date; durationMinutes: number | null;
  format: "PRESENTIEL" | "DISTANCIEL" | "HYBRIDE"; city: string | null; capacity: number | null; registrationOpen: boolean;
  organization: { name: string }; registrations: number;
};
const FORMAT = { PRESENTIEL: "Présentiel", DISTANCIEL: "Visioconférence", HYBRIDE: "Hybride" } as const;
const dur = (m: number | null) => (m == null ? "" : m >= 60 ? ` · ${Math.floor(m / 60)} h${m % 60 ? String(m % 60).padStart(2, "0") : ""}` : ` · ${m} min`);

export function EventCard({ ev, compact = false }: { ev: EventCardData; compact?: boolean }) {
  const full = ev.capacity != null && ev.registrations >= ev.capacity;
  const status = !ev.registrationOpen ? "Inscriptions closes" : full ? "Complet" : "Inscriptions ouvertes";
  const cls = status === "Inscriptions ouvertes" ? "st-ok" : full ? "st-warn" : "st-neutral";
  const parts = new Intl.DateTimeFormat("fr-FR", { timeZone: TZ, day: "2-digit", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }).formatToParts(ev.startsAt);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const FormatIcon = ev.format === "DISTANCIEL" ? Video : MapPin;
  const href = `/evenements/${ev.id}`;
  return (
    <div className="event-card">
      <Link href={href} className="event-cover">
        <AreaArt seed={(ev.therapeuticArea ?? "") + ev.id} height={compact ? 96 : 128} label={ev.therapeuticArea} />
        <span className="event-date-chip">
          <span className="event-day">{get("day")}</span>
          <span className="event-month">{MONTHS[Number(get("month")) - 1]}</span>
        </span>
      </Link>
      <div className="event-body">
        <div className="flex-between mb-1">
          <span className="sector-tag">{eventTypeLabel(ev.typeId)}</span>
          <span className={`pill ${cls}`}>{status}</span>
        </div>
        <h3 className="card-title">{ev.title}</h3>
        <div className="meta-line"><Clock size={12} /> {get("day")}/{get("month").padStart(2, "0")}/{get("year")} à {get("hour")}:{get("minute")}{dur(ev.durationMinutes)}</div>
        <div className="meta-line"><FormatIcon size={12} /> {FORMAT[ev.format]}{ev.city ? ` — ${ev.city}` : ""}</div>
        <div className="meta-line"><Users size={12} /> {ev.registrations} inscrit{ev.registrations > 1 ? "s" : ""}{ev.capacity ? ` sur ${ev.capacity} places` : ""}</div>
        <div className="event-foot">
          <span className="flex-center gap-2"><Avatar name={ev.organization.name} size={26} square /><span className="text-xs">{ev.organization.name}</span></span>
        </div>
        <div className="mt-3"><Link href={href} className="btn secondary small"><Ticket size={13} /> S&apos;inscrire</Link></div>
      </div>
    </div>
  );
}

export type KolCardData = {
  id: string; name: string; specialty: string | null; subspecialty: string | null; profession: string; city: string | null; hospital: string | null;
  verified: boolean; types: string[]; collaborations: number; organizations: number;
};
export function KolCard({ k }: { k: KolCardData }) {
  return (
    <Link href={`/annuaire/${k.id}`} className="kol-card">
      <div className="flex-between">
        <div className="eyebrow">KB-{k.id.slice(-4).toUpperCase()} · France</div>
        {k.verified && <span className="verif ok small"><BadgeCheck size={12} /> Vérifié</span>}
      </div>
      <div className="flex-start gap-3 mt-2 mb-2">
        <Avatar name={k.name} size={48} />
        <div>
          <h3 className="card-title">{k.name}</h3>
          <p className="text-sm">{[k.specialty || k.profession, k.subspecialty].filter(Boolean).join(" · ")}</p>
        </div>
      </div>
      <div className="meta-line"><MapPin size={12} /> {[k.city, k.hospital].filter(Boolean).join(" — ") || "France"}</div>
      <div className="meta-line"><BookOpen size={12} /> {k.types.length} type{k.types.length > 1 ? "s" : ""} d&apos;intervention</div>
      <div className="tags mt-2 mb-3">{k.types.slice(0, 3).map((t) => <span key={t} className="tag tag-sm">{t}</span>)}</div>
      <div className="hairline mb-2" />
      <div className="text-xs">{k.collaborations} collaboration{k.collaborations > 1 ? "s" : ""} · {k.organizations} organisation{k.organizations > 1 ? "s" : ""}</div>
      <div className="card-cta">Voir le profil <ChevronRight size={14} /></div>
    </Link>
  );
}

export type OrgCardData = { id: string; name: string; kind: string; sector: string | null; about: string | null; hq: string | null; areas: string[]; openCalls: number; collaborations: number };
export function OrgCard({ o }: { o: OrgCardData }) {
  return (
    <Link href={`/structures#${o.id}`} className="kol-card" id={o.id}>
      <div className="flex-between">
        <Avatar name={o.name} size={44} square />
        <span className="sector-tag">{o.kind}</span>
      </div>
      <h3 className="card-title mt-2">{o.name}</h3>
      {o.sector && <p className="text-xs mb-1">{o.sector}</p>}
      {o.about && <p className="text-sm mb-2">{o.about}</p>}
      {o.hq && <div className="meta-line"><MapPin size={12} /> {o.hq}</div>}
      <div className="tags mt-2 mb-3">{o.areas.slice(0, 4).map((a) => <span key={a} className="tag tag-sm">{a}</span>)}</div>
      <div className="hairline mb-2" />
      <div className="text-xs">{o.openCalls} appel{o.openCalls > 1 ? "s" : ""} ouvert{o.openCalls > 1 ? "s" : ""} · {o.collaborations} collaboration{o.collaborations > 1 ? "s" : ""}</div>
      <div className="card-cta">Voir le profil <ChevronRight size={14} /></div>
    </Link>
  );
}

export type CallCardData = { id: string; title: string; specialty: string | null; typeId: string; poster: string; deadline: Date | null; description: string | null; budgetMinCents: number | null; budgetMaxCents: number | null; open: boolean };
export function CallCard({ c, action }: { c: CallCardData; action?: React.ReactNode }) {
  const date = c.deadline?.toLocaleDateString("fr-FR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" });
  return (
    <div className="dossier-card">
      <div className="dossier-top">
        <div>
          {c.specialty && <span className="sector-tag">{c.specialty}</span>}
          <h3 className="card-title mt-1">{c.title}</h3>
        </div>
        <span className={`pill ${c.open ? "st-electric" : "st-neutral"}`}>{c.open ? "Ouverte" : "Clôturée"}</span>
      </div>
      <p className="text-sm mb-1">Publié par <strong className="ink">{c.poster}</strong> · {collabType(c.typeId)?.label ?? c.typeId}</p>
      {date && <p className="text-sm mb-2 flex-center gap-1"><Calendar size={12} /> Candidatures jusqu&apos;au {date}</p>}
      {c.description && <p className="text-sm mb-3">{c.description}</p>}
      {(c.budgetMinCents != null || c.budgetMaxCents != null) && (
        <p className="mono text-xs mb-3">{[c.budgetMinCents, c.budgetMaxCents].filter((x) => x != null).map((x) => formatEUR(x!)).join(" – ")}</p>
      )}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
