import Link from "next/link";
import { BadgeCheck, Calendar, ChevronRight, MapPin, Ticket, Video } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { eventTypeLabel, TZ } from "@/lib/events";
import { collabType } from "@/lib/projects";
import { fmtDate, fmtEur } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";

/* Cartes publiques — charte KolBase : vignettes sur fond Aurore, cartes blanches, une seule couleur d'action. */

const hashCode = (s: string) => [...s].reduce((h, c) => (Math.imul(31, h) + c.charCodeAt(0)) | 0, 0);
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
export async function EventCard({ ev, compact = false }: { ev: EventCardData; compact?: boolean }) {
  const { t, locale } = await getT();
  const dur = (m: number | null) => (m == null ? "" : m >= 60 ? ` · ${t("{h} h{m}", { h: Math.floor(m / 60), m: m % 60 ? String(m % 60).padStart(2, "0") : "" })}` : ` · ${m} min`);
  const full = ev.capacity != null && ev.registrations >= ev.capacity;
  // Parties numériques seulement (jour, année, heure 24 h) : identiques en français et en anglais.
  const parts = new Intl.DateTimeFormat("fr-FR", { timeZone: TZ, day: "2-digit", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }).formatToParts(ev.startsAt);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const FormatIcon = ev.format === "DISTANCIEL" ? Video : MapPin;
  const href = `/evenements/${ev.id}`;
  const left = ev.capacity != null ? Math.max(ev.capacity - ev.registrations, 0) : null;
  return (
    <article className="event-card">
      <Link href={href} className="event-cover" aria-hidden="true" tabIndex={-1}>
        <AreaArt seed={ev.id + (ev.therapeuticArea ?? "")} height={compact ? 112 : 128} />
        <time className="event-date-chip" dateTime={ev.startsAt.toISOString()}>
          <span className="event-month">{fmtDate(locale, ev.startsAt, { month: "short" })}</span>
          <span className="event-day">{get("day")}</span>
          <span className="event-year">{get("year")}</span>
        </time>
        <span className="event-type">{t(eventTypeLabel(ev.typeId))}</span>
      </Link>
      <div className="event-body">
        <h3 className="card-title" style={{ marginBottom: 2 }}><Link href={href} className="ink">{ev.title}</Link></h3>
        <div className="meta-line"><FormatIcon size={14} /> {[ev.city, t(FORMAT[ev.format])].filter(Boolean).join(" · ")} · {get("hour")}:{get("minute")}{dur(ev.durationMinutes)}</div>
        {ev.therapeuticArea && <div className="meta-line">{t(ev.therapeuticArea)}</div>}
        <div className="event-org">{ev.organization.name}</div>
        <div className="event-foot">
          <span>
            {!ev.registrationOpen ? t("Inscriptions closes") : full ? t("Complet") : left != null ? <><span className="mono ink">{left}</span> {t(left > 1 ? "places restantes" : "place restante")}</> : t("Inscriptions ouvertes")}
          </span>
          {ev.registrationOpen && !full && <Link href={href} className="btn small"><Ticket size={14} /> {t("S'inscrire")}</Link>}
        </div>
      </div>
    </article>
  );
}

export type KolCardData = {
  id: string; name: string; specialty: string | null; subspecialty: string | null; profession: string; city: string | null; hospital: string | null;
  /** Pays d'exercice (nom affiché) ; « France » par défaut. */
  country?: string;
  verified: boolean; types: string[]; collaborations: number | null; organizations: number | null;
};
export async function KolCard({ k }: { k: KolCardData }) {
  const { t } = await getT();
  return (
    <Link href={`/experts/${k.id}`} className="kol-card">
      <div className="kol-head">
        <Avatar name={k.name} size={60} />
        {k.verified && <span className="verif ok small"><BadgeCheck size={13} /> {t("Identité vérifiée")}</span>}
      </div>
      <h3 className="kol-name">{k.name}</h3>
      <p className="text-sm">{[t(k.specialty || k.profession), k.subspecialty].filter(Boolean).join(" · ")}</p>
      <div className="meta-line mt-1"><MapPin size={13} /> {[[k.city, k.hospital].filter(Boolean).join(" — "), k.country && k.country !== "France" ? t(k.country) : null].filter(Boolean).join(" · ") || t(k.country || "France")}</div>
      <div className="tags mt-3 mb-3">{k.types.slice(0, 3).map((x) => <span key={x} className="tag tag-sm">{t(x)}</span>)}</div>
      <div className="kol-foot">
        <span className="text-xs">
          {k.collaborations == null ? null : k.collaborations > 0 ? <><span className="mono ink">{k.collaborations}</span> {t(k.collaborations > 1 ? "collaborations" : "collaboration")}</> : t("Nouveau sur KolBase")}
        </span>
        <span className="card-cta">{t("Voir le profil")} <ChevronRight size={15} /></span>
      </div>
    </Link>
  );
}

export type OrgCardData = { id: string; name: string; logo?: string | null; kind: string; family?: string; categories?: string[]; coverage?: string | null; sector: string | null; about: string | null; hq: string | null; areas: string[]; openCalls: number; collaborations: number };
export async function OrgCard({ o }: { o: OrgCardData }) {
  const { t } = await getT();
  const supplier = o.family === "prestataires";
  return (
    <Link href={`/structures/${o.id}`} className="kol-card">
      <div className="kol-head">
        <Avatar name={o.name} size={56} square src={o.logo} />
        <span className="sector-tag">{t(o.kind)}</span>
      </div>
      <h3 className="kol-name">{o.name}</h3>
      {o.sector && <p className="text-sm">{o.sector}</p>}
      {o.hq && <div className="meta-line mt-1"><MapPin size={13} /> {o.hq}</div>}
      {o.about && <p className="text-sm mt-2 clamp-4">{o.about}</p>}
      {/* Prestataire : ses prestations et sa zone ; autres organisations : domaines, appels et collaborations. */}
      <div className="tags mt-3 mb-3">{(supplier ? o.categories ?? [] : o.areas).slice(0, 4).map((a) => <span key={a} className="tag tag-sm">{t(a)}</span>)}</div>
      <div className="kol-foot">
        {supplier ? (
          <span className="text-xs">{o.coverage ? t("Zone : {zone}", { zone: o.coverage }) : ""}</span>
        ) : (
          <span className="text-xs">
            <span className="mono ink">{o.openCalls}</span> {t(o.openCalls > 1 ? "appels ouverts" : "appel ouvert")} · <span className="mono ink">{o.collaborations}</span> {t(o.collaborations > 1 ? "collaborations" : "collaboration")}
          </span>
        )}
        <span className="card-cta">{t("Voir la fiche")} <ChevronRight size={15} /></span>
      </div>
    </Link>
  );
}

export type CallCardData = { id: string; title: string; specialty: string | null; typeId: string; poster: string; posterLogo?: string | null; deadline: Date | null; description: string | null; budgetMinCents: number | null; budgetMaxCents: number | null; open: boolean };
export async function CallCard({ c, action }: { c: CallCardData; action?: React.ReactNode }) {
  const { t, locale } = await getT();
  const date = c.deadline ? fmtDate(locale, c.deadline, { day: "2-digit", month: "2-digit", year: "numeric" }) : undefined;
  const budget = c.budgetMinCents != null || c.budgetMaxCents != null
    ? [c.budgetMinCents, c.budgetMaxCents].filter((x) => x != null).map((x) => fmtEur(locale, x!)).join(" – ")
    : null;
  return (
    <article className="dossier-card">
      <div className="flex-center gap-3 mb-3">
        <Avatar name={c.poster} size={40} square src={c.posterLogo} />
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="ink" style={{ fontWeight: 600 }}>{c.poster}</div>
          <div className="text-xs">{[c.specialty && t(c.specialty), t(collabType(c.typeId)?.label ?? c.typeId)].filter(Boolean).join(" · ")}</div>
        </div>
        {!c.open && <span className="pill st-neutral">{t("Clôturé")}</span>}
      </div>
      <h3 className="card-title" style={{ fontSize: 21 }}>{c.title}</h3>
      {c.description && <p className="text-sm mb-3">{c.description}</p>}
      <div className="tags mb-1">
        {budget && <span className="tag mono">{budget}</span>}
        {date && <span className="tag"><Calendar size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />{t("Jusqu'au {date}", { date })}</span>}
      </div>
      {action && <div className="mt-3">{action}</div>}
    </article>
  );
}
