/**
 * Filtres de l'agenda public (/evenements) : lecture des paramètres d'adresse, sélection et liens (module pur, testé).
 * Discipline, type, format, période et ville se combinent avec la recherche libre ; chaque filtre a sa propre
 * adresse, partageable et indexable.
 */
import { EVENT_TYPES, FORMAT_LABEL } from "@/lib/events";
import { matches, normalize } from "@/lib/search";

export type EventFormatId = keyof typeof FORMAT_LABEL;

/** Périodes proposées, comptées depuis aujourd'hui. */
export const PERIODS = [
  { id: "30j", label: "Dans les 30 jours" },
  { id: "90j", label: "Dans les 3 mois" },
  { id: "plus", label: "Dans plus de 3 mois" },
] as const;
export type PeriodId = (typeof PERIODS)[number]["id"];

export type AgendaFilters = { q: string; ville: string; discipline: string; type: string; format: EventFormatId | ""; periode: PeriodId | "" };
export const NO_FILTERS: AgendaFilters = { q: "", ville: "", discipline: "", type: "", format: "", periode: "" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim().slice(0, 120) ?? "";

/** Paramètres de l'adresse → filtres valides (une valeur inconnue est ignorée, jamais une erreur). */
export function readAgendaFilters(sp: Record<string, string | string[] | undefined>): AgendaFilters {
  const type = one(sp.type);
  const format = one(sp.format);
  const periode = one(sp.periode);
  return {
    q: one(sp.q),
    ville: one(sp.ville),
    discipline: one(sp.discipline),
    type: EVENT_TYPES.some((t) => t.id === type) ? type : "",
    format: Object.hasOwn(FORMAT_LABEL, format) ? (format as EventFormatId) : "",
    periode: PERIODS.some((p) => p.id === periode) ? (periode as PeriodId) : "",
  };
}

const DAY = 864e5;
/** L'événement commence-t-il dans la période choisie ? (en cours : compte comme « dans les 30 jours ») */
export function inPeriod(startsAt: Date, periode: PeriodId | "", now = new Date()) {
  if (!periode) return true;
  const days = (startsAt.getTime() - now.getTime()) / DAY;
  return periode === "30j" ? days <= 30 : periode === "90j" ? days <= 90 : days > 90;
}

export type AgendaEvent = { title: string; typeId: string; therapeuticArea: string | null; format: string; city: string | null; startsAt: Date; organization: { name: string } };

/** Événements qui répondent à tous les filtres. `extra` : libellés traduits, pour la recherche libre en anglais. */
export function filterAgenda<E extends AgendaEvent>(events: E[], f: AgendaFilters, now = new Date(), extra: (e: E) => (string | null | undefined)[] = () => []) {
  const discipline = normalize(f.discipline);
  return events.filter((e) => {
    const typeLabel = EVENT_TYPES.find((t) => t.id === e.typeId)?.label ?? e.typeId;
    return matches(f.q, e.title, e.therapeuticArea, typeLabel, e.organization.name, e.city, ...extra(e))
      && matches(f.ville, e.city)
      && (!discipline || normalize(e.therapeuticArea) === discipline)
      && (!f.type || e.typeId === f.type)
      && (!f.format || e.format === f.format)
      && inPeriod(e.startsAt, f.periode, now);
  });
}

/** Disciplines des événements (saisie libre) : regroupées sans tenir compte de la casse ni des accents, les plus fréquentes d'abord. */
export function disciplinesOf(events: { therapeuticArea: string | null }[]) {
  const groups = new Map<string, { name: string; count: number }>();
  for (const e of events) {
    const name = e.therapeuticArea?.trim();
    if (!name) continue;
    const key = normalize(name);
    const g = groups.get(key);
    // Même discipline écrite autrement : la graphie qui commence par une majuscule l'emporte.
    if (g) { g.count++; if (g.name[0] === g.name[0].toLowerCase() && name[0] !== name[0].toLowerCase()) g.name = name; }
    else groups.set(key, { name, count: 1 });
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "fr"));
}

/** Adresse de l'agenda pour ces filtres (les vides sont omis ; ordre stable). */
export function agendaHref(f: Partial<AgendaFilters>) {
  const p = new URLSearchParams();
  for (const k of ["q", "discipline", "type", "format", "periode", "ville"] as const) if (f[k]) p.set(k, f[k]!);
  const qs = p.toString();
  return qs ? `/evenements?${qs}` : "/evenements";
}

/** Un filtre de plus est-il actif ? */
export const hasFilters = (f: AgendaFilters) => Object.values(f).some(Boolean);
