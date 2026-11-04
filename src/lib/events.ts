import type { OrgRole } from "@/generated/prisma/client";

/** Fin d'un événement (durée inconnue : deux heures). Commencé n'est pas terminé : pointage pendant, bilan après. */
export const eventEnd = (e: { startsAt: Date; durationMinutes: number | null }) => new Date(e.startsAt.getTime() + (e.durationMinutes ?? 120) * 60000);
export const eventEnded = (e: { startsAt: Date; durationMinutes: number | null }, now = new Date()) => eventEnd(e) <= now;

/** Moment d'un événement : à venir, en cours (commencé, pas terminé), passé. */
export type EventMoment = "a_venir" | "en_cours" | "passe";
export const eventMoment = (e: { startsAt: Date; durationMinutes: number | null }, now = new Date()): EventMoment =>
  e.startsAt > now ? "a_venir" : eventEnded(e, now) ? "passe" : "en_cours";

type Stateful = { startsAt: Date; durationMinutes: number | null; cancelledAt?: Date | null; registrationOpen: boolean; capacity: number | null };
/** État d'un événement publié, le même partout : annulé, passé, en cours, inscriptions closes, complet, inscriptions ouvertes. */
export type EventState = "annule" | "passe" | "en_cours" | "closes" | "complet" | "ouvertes";
/**
 * États dans le temps communs au public, aux inscrits et à l'organisation : les inscriptions ferment dès le début
 * (« en cours »), un événement terminé est « passé ». Places restantes et prix par personne n'ont de sens que tant que
 * l'on peut encore s'inscrire (`upcoming`).
 */
export function eventState(e: Stateful, registrations: number, now = new Date()) {
  const moment = eventMoment(e, now);
  const full = e.capacity != null && registrations >= e.capacity;
  const state: EventState = e.cancelledAt ? "annule" : moment === "passe" ? "passe" : moment === "en_cours" ? "en_cours" : !e.registrationOpen ? "closes" : full ? "complet" : "ouvertes";
  return { moment, state, full, upcoming: moment === "a_venir" && !e.cancelledAt, canRegister: state === "ouvertes" };
}
/** Libellés publics (traduits par t() sur les pages publiques). */
export const EVENT_STATE_LABEL: Record<EventState, { label: string; tone: string }> = {
  annule: { label: "Événement annulé", tone: "bad" },
  passe: { label: "Événement passé", tone: "done" },
  en_cours: { label: "En cours · inscriptions closes", tone: "electric" },
  closes: { label: "Inscriptions closes", tone: "done" },
  complet: { label: "Complet", tone: "bad" },
  ouvertes: { label: "Inscriptions ouvertes", tone: "ok" },
};

/**
 * Statut d'un événement vu par l'organisation (liste, fiche) : annulé, réunion interne, brouillon ou retiré de
 * l'agenda, masqué pendant la suspension de l'organisation, puis l'état commun (publié, en cours, passé, complet…).
 */
export function orgEventStatus(
  e: Stateful & { internal: boolean; publishedAt: Date | null },
  registrations: number,
  o: { suspended: boolean; withdrawn?: boolean },
  now = new Date(),
): { label: string; tone: string } {
  if (e.cancelledAt) return { label: "Annulé", tone: "bad" };
  if (e.internal) return { label: "Réunion interne", tone: "electric" };
  if (!e.publishedAt) return o.withdrawn ? { label: "Retiré de l'agenda", tone: "done" } : { label: "Brouillon", tone: "wait" };
  if (o.suspended) return { label: "Masqué (organisation suspendue)", tone: "bad" };
  const { state } = eventState(e, registrations, now);
  if (state === "passe") return { label: "Passé", tone: "done" };
  if (state === "en_cours") return { label: "En cours · inscriptions closes", tone: "electric" };
  if (state === "closes") return { label: "Publié · inscriptions closes", tone: "done" };
  if (state === "complet") return { label: "Publié · complet", tone: "wait" };
  return { label: "Publié · inscriptions ouvertes", tone: "ok" };
}

/** Durée lisible, la même partout : « 15 min », « 1 h », « 1 h 30 » (en anglais : « 1h30 »). */
export const formatDuration = (min: number, locale: string = "fr") => {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60 ? String(min % 60).padStart(2, "0") : "";
  return locale === "en" ? `${h}h${m}` : `${h} h${m ? ` ${m}` : ""}`;
};

/** Types d'événements publiables (repris du prototype). */
export const EVENT_TYPES = [
  { id: "symposium", label: "Symposium de congrès" },
  { id: "pleniere", label: "Conférence plénière" },
  { id: "table-ronde", label: "Table ronde" },
  { id: "webinaire", label: "Webinaire" },
  { id: "travaux-pratiques", label: "Travaux pratiques sur simulateur" },
  { id: "dpc", label: "Formation DPC" },
  { id: "live-surgery", label: "Chirurgie en direct" },
] as const;

export const eventTypeLabel = (id: string) => EVENT_TYPES.find((t) => t.id === id)?.label ?? id;

/** Catalogue des hospitalités et valeurs habituelles (€ TTC). */
export const BENEFIT_CATALOG = [
  { id: "cafe", label: "Pause café d'accueil", typical: 12 },
  { id: "dejeuner", label: "Déjeuner sur place", typical: 34 },
  { id: "cocktail", label: "Cocktail dînatoire", typical: 45 },
  { id: "nuitee", label: "Nuitée d'hôtel", typical: 140 },
  { id: "transport", label: "Transport aller-retour", typical: 95 },
] as const;

export const FORMAT_LABEL = { PRESENTIEL: "Présentiel", DISTANCIEL: "Visioconférence", HYBRIDE: "Hybride" } as const;

/** Organisateurs internes : tous les événements de l'organisation. */
export const EVENT_ORGANIZER_ROLES: OrgRole[] = ["ADMIN", "PROJETS"];
/** Accès aux événements : organisateurs + prestataire mandaté (limité aux événements confiés, voir eventScope). */
export const EVENT_MANAGER_ROLES: OrgRole[] = [...EVENT_ORGANIZER_ROLES, "PRESTATAIRE"];

/**
 * Filtre Prisma des événements visibles : tout pour un organisateur interne,
 * seulement les événements confiés à son agence pour un prestataire mandaté.
 */
export function eventScope(
  user: { memberships: { organizationId: string; organization: { kind: string } }[] },
  roles: OrgRole[],
): { agencyId?: { in: string[] } } {
  if (roles.some((r) => EVENT_ORGANIZER_ROLES.includes(r))) return {};
  const agencies = [...new Set(user.memberships.filter((m) => m.organization.kind === "PRESTATAIRE").map((m) => m.organizationId))];
  return { agencyId: { in: agencies } };
}
export const COMPLIANCE_ROLES: OrgRole[] = ["ADMIN", "CONFORMITE"];

/**
 * Périmètre du dispositif Transparence / anti-cadeaux : toute personne inscrite
 * avec un profil praticien (professionnels de santé, étudiants, assistants…).
 * Règle centralisée ici pour pouvoir l'ajuster.
 */
export const isHcp = (user: { practitioner: unknown | null }) => !!user.practitioner;

export const TZ = "Europe/Paris";

export const formatEUR = (cents: number) =>
  (cents / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: cents % 100 ? 2 : 0 });

export const formatDateTime = (d: Date) =>
  d.toLocaleString("fr-FR", { timeZone: TZ, weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });

export const formatTime = (d: Date) => d.toLocaleTimeString("fr-FR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });

export const formatDate = (d: Date) => d.toLocaleDateString("fr-FR", { timeZone: TZ, day: "numeric", month: "short", year: "numeric" });

/** Date du jour à Paris, au format « AAAA-MM-JJ » (valeur d'un champ date). */
export const parisToday = (now = new Date()) => now.toLocaleDateString("sv-SE", { timeZone: TZ });

/** Convertit une saisie « AAAA-MM-JJTHH:MM » (heure de Paris) en Date UTC. */
export function parseParisDateTime(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);
  // Date impossible (31 février, 25 h…) : refusée plutôt que reportée au mois suivant.
  const check = new Date(asUtc);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d || check.getUTCHours() !== h || check.getUTCMinutes() !== mi) return null;
  // Décalage de Paris à cet instant (gère heure d'été / d'hiver).
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    .formatToParts(new Date(asUtc))
    .reduce<Record<string, number>>((acc, p) => (p.type !== "literal" ? { ...acc, [p.type]: Number(p.value) } : acc), {});
  const parisAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour % 24, parts.minute);
  return new Date(asUtc - (parisAsUtc - asUtc));
}

/** Valeur d'un champ « date et heure » (« AAAA-MM-JJTHH:MM », heure de Paris) : inverse de parseParisDateTime. */
export function toParisInput(d: Date): string {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    .formatToParts(d)
    .reduce<Record<string, string>>((acc, x) => (x.type !== "literal" ? { ...acc, [x.type]: x.value } : acc), {});
  return `${p.year}-${p.month}-${p.day}T${p.hour === "24" ? "00" : p.hour}:${p.minute}`;
}

/**
 * Lien de connexion d'un événement en ligne : https uniquement (pas de lien en clair ni de schéma exotique).
 * Vide : null. Invalide : undefined (à refuser).
 */
export function parseOnlineUrl(v: string): string | null | undefined {
  const s = v.trim();
  if (!s) return null;
  if (s.length > 500 || /\s/.test(s)) return undefined;
  try {
    const u = new URL(s);
    return u.protocol === "https:" && !!u.hostname && u.hostname.includes(".") && !u.username && !u.password ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}
export const ONLINE_URL_INVALID = "Lien de connexion invalide : indiquez une adresse complète commençant par https://.";

/** Événement en ligne ou hybride sans lien de connexion à deux jours (ou moins) de son début : l'organisateur est relancé. */
export const needsOnlineLink = (e: { format: string; internal: boolean; onlineUrl: string | null; startsAt: Date }, now = new Date()) =>
  e.format !== "PRESENTIEL" && !e.internal && !e.onlineUrl && e.startsAt > now && e.startsAt.getTime() - now.getTime() <= 2 * 864e5;

export type EventChange = "date" | "lieu" | "format" | "lien";
type Logistics = { startsAt: Date; durationMinutes?: number | null; city: string | null; venue: string | null; format: string; onlineUrl: string | null };
/** Changements qui concernent les inscrits (ils sont prévenus par e-mail) : date ou heure, lieu, format, lien de connexion. */
export function eventChanges(before: Logistics, after: Logistics): EventChange[] {
  const out: EventChange[] = [];
  if (before.startsAt.getTime() !== after.startsAt.getTime()) out.push("date");
  if ((before.city ?? "") !== (after.city ?? "") || (before.venue ?? "") !== (after.venue ?? "")) out.push("lieu");
  if (before.format !== after.format) out.push("format");
  if ((before.onlineUrl ?? "") !== (after.onlineUrl ?? "")) out.push("lien");
  return out;
}

export const csvEscape = (v: unknown) => {
  let s = v == null ? "" : String(v);
  // Injection de formule : un nom saisi « =HYPERLINK(…) » serait exécuté par Excel à l'ouverture.
  // Les nombres (montants négatifs compris) restent tels quels ; tout autre texte commençant par
  // = + - @ (ou une tabulation, un retour chariot) est neutralisé par une apostrophe.
  if (typeof v !== "number" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[";\n\r\t]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV séparé par « ; » avec BOM, lisible directement par Excel en français. */
export const toCSV = (rows: unknown[][]) => "﻿" + rows.map((r) => r.map(csvEscape).join(";")).join("\r\n");
