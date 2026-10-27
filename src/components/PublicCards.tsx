import Link from "next/link";
import { BadgeCheck, Calendar, ChevronRight, MapPin, Ticket, Video } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { eventTypeLabel, formatEUR, TZ } from "@/lib/events";
import { collabType } from "@/lib/projects";

/* Cartes publiques — charte KolBase : vignettes sur fond Aurore, cartes blanches, une seule couleur d'action. */

const hashCode = (s: string) => [...s].reduce((h, c) => (Math.imul(31, h) + c.charCodeAt(0)) | 0, 0);
const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const AURORE_FRAMES = ["20% 30%", "50% 50%", "80% 70%", "35% 60%", "65% 35%", "45% 80%"];

/** Visuel de couverture : le dégradé Aurore de la marque, cadré différemment selon la graine. */
export function AreaArt({ seed, height = 132, label }: { seed: string; height?: number; label?: string | null }) {
  const frame = AURORE_FRAMES[Math.abs(hashCode(seed)) % AURORE_FRAMES.length];
  return (
    <div className="area-art" style={{ height }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/visuels/fond-aurore.webp" alt="" aria-hidden style={{ objectPosition: frame }} />
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
const FORMAT = { PRESENTIEL: "présentiel", DISTANCIEL: "visioconférence", HYBRIDE: "hybride" } as const;
const dur = (m: number | null) => (m == null ? "" : m >= 60 ? ` · ${Math.floor(m / 60)} h${m % 60 ? String(m % 60).padStart(2, "0") : ""}` : ` · ${m} min`);

export function EventCard({ ev, compact = false }: { ev: EventCardData; compact?: boolean }) {
  const full = ev.capacity != null && ev.registrations >= ev.capacity;
  const parts = new Intl.DateTimeFormat("fr-FR", { timeZone: TZ, day: "2-digit", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }).formatToParts(ev.startsAt);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const FormatIcon = ev.format === "DISTANCIEL" ? Video : MapPin;
  const href = `/evenements/${ev.id}`;
  const left = ev.capacity != null ? Math.max(ev.capacity - ev.registrations, 0) : null;
  return (
    <article className="event-card">
      <Link href={href} className="event-cover" aria-label={ev.title}>
        <AreaArt seed={ev.id + (ev.therapeuticArea ?? "")} height={compact ? 112 : 128} />
        <time className="event-date-chip" dateTime={ev.startsAt.toISOString()}>
          <span className="event-month">{MONTHS[Number(get("month")) - 1]}</span>
          <span className="event-day">{get("day")}</span>
          <span className="event-year">{get("year")}</span>
        </time>
        <span className="event-type">{eventTypeLabel(ev.typeId)}</span>
      </Link>
      <div className="event-body">
        <h3 className="card-title" style={{ marginBottom: 2 }}><Link href={href} className="ink">{ev.title}</Link></h3>
        <div className="meta-line"><FormatIcon size={14} /> {[ev.city, FORMAT[ev.format]].filter(Boolean).join(" · ")} · {get("hour")}:{get("minute")}{dur(ev.durationMinutes)}</div>
        {ev.therapeuticArea && <div className="meta-line">{ev.therapeuticArea}</div>}
        <div className="event-org">{ev.organization.name}</div>
        <div className="event-foot">
          <span>
            {!ev.registrationOpen ? "Inscriptions closes" : full ? "Complet" : left != null ? <><span className="mono ink">{left}</span> place{left > 1 ? "s" : ""} restante{left > 1 ? "s" : ""}</> : "Inscriptions ouvertes"}
          </span>
          {ev.registrationOpen && !full && <Link href={href} className="btn small"><Ticket size={14} /> S&apos;inscrire</Link>}
        </div>
      </div>
    </article>
  );
}

export type KolCardData = {
  id: string; name: string; specialty: string | null; subspecialty: string | null; profession: string; city: string | null; hospital: string | null;
  verified: boolean; types: string[]; collaborations: number; organizations: number;
};
export function KolCard({ k }: { k: KolCardData }) {
  return (
    <Link href={`/experts/${k.id}`} className="kol-card">
      <div className="kol-head">
        <Avatar name={k.name} size={60} />
        {k.verified && <span className="verif ok small"><BadgeCheck size={13} /> Identité vérifiée</span>}
      </div>
      <h3 className="kol-name">{k.name}</h3>
      <p className="text-sm">{[k.specialty || k.profession, k.subspecialty].filter(Boolean).join(" · ")}</p>
      <div className="meta-line mt-1"><MapPin size={13} /> {[k.city, k.hospital].filter(Boolean).join(" — ") || "France"}</div>
      <div className="tags mt-3 mb-3">{k.types.slice(0, 3).map((t) => <span key={t} className="tag tag-sm">{t}</span>)}</div>
      <div className="kol-foot">
        <span className="text-xs">
          {k.collaborations > 0 ? <><span className="mono ink">{k.collaborations}</span> collaboration{k.collaborations > 1 ? "s" : ""}</> : "Nouveau sur KolBase"}
        </span>
        <span className="card-cta">Voir le profil <ChevronRight size={15} /></span>
      </div>
    </Link>
  );
}

export type OrgCardData = { id: string; name: string; kind: string; sector: string | null; about: string | null; hq: string | null; areas: string[]; openCalls: number; collaborations: number };
export function OrgCard({ o }: { o: OrgCardData }) {
  return (
    <Link href={`/structures/${o.id}`} className="kol-card">
      <div className="kol-head">
        <Avatar name={o.name} size={56} square />
        <span className="sector-tag">{o.kind}</span>
      </div>
      <h3 className="kol-name">{o.name}</h3>
      {o.sector && <p className="text-sm">{o.sector}</p>}
      {o.hq && <div className="meta-line mt-1"><MapPin size={13} /> {o.hq}</div>}
      {o.about && <p className="text-sm mt-2">{o.about}</p>}
      <div className="tags mt-3 mb-3">{o.areas.slice(0, 4).map((a) => <span key={a} className="tag tag-sm">{a}</span>)}</div>
      <div className="kol-foot">
        <span className="text-xs">
          <span className="mono ink">{o.openCalls}</span> appel{o.openCalls > 1 ? "s" : ""} ouvert{o.openCalls > 1 ? "s" : ""} · <span className="mono ink">{o.collaborations}</span> collaboration{o.collaborations > 1 ? "s" : ""}
        </span>
        <span className="card-cta">Voir la fiche <ChevronRight size={15} /></span>
      </div>
    </Link>
  );
}

export type CallCardData = { id: string; title: string; specialty: string | null; typeId: string; poster: string; deadline: Date | null; description: string | null; budgetMinCents: number | null; budgetMaxCents: number | null; open: boolean };
export function CallCard({ c, action }: { c: CallCardData; action?: React.ReactNode }) {
  const date = c.deadline?.toLocaleDateString("fr-FR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" });
  const budget = c.budgetMinCents != null || c.budgetMaxCents != null
    ? [c.budgetMinCents, c.budgetMaxCents].filter((x) => x != null).map((x) => formatEUR(x!)).join(" – ")
    : null;
  return (
    <article className="dossier-card">
      <div className="flex-center gap-3 mb-3">
        <Avatar name={c.poster} size={40} square />
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="ink" style={{ fontWeight: 600 }}>{c.poster}</div>
          <div className="text-xs">{[c.specialty, collabType(c.typeId)?.label ?? c.typeId].filter(Boolean).join(" · ")}</div>
        </div>
        {!c.open && <span className="pill st-neutral">Clôturé</span>}
      </div>
      <h3 className="card-title" style={{ fontSize: 21 }}>{c.title}</h3>
      {c.description && <p className="text-sm mb-3">{c.description}</p>}
      <div className="tags mb-1">
        {budget && <span className="tag mono">{budget}</span>}
        {date && <span className="tag"><Calendar size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />Jusqu&apos;au {date}</span>}
      </div>
      {action && <div className="mt-3">{action}</div>}
    </article>
  );
}
