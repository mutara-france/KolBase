import type { OrgRole } from "@/generated/prisma/client";

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

export const EVENT_MANAGER_ROLES: OrgRole[] = ["ADMIN", "EVENEMENTS", "CUMUL", "PRESTATAIRE"];
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

export const formatDate = (d: Date) => d.toLocaleDateString("fr-FR", { timeZone: TZ, day: "numeric", month: "short", year: "numeric" });

/** Convertit une saisie « AAAA-MM-JJTHH:MM » (heure de Paris) en Date UTC. */
export function parseParisDateTime(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);
  // Décalage de Paris à cet instant (gère heure d'été / d'hiver).
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    .formatToParts(new Date(asUtc))
    .reduce<Record<string, number>>((acc, p) => (p.type !== "literal" ? { ...acc, [p.type]: Number(p.value) } : acc), {});
  const parisAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour % 24, parts.minute);
  return new Date(asUtc - (parisAsUtc - asUtc));
}

export const csvEscape = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV séparé par « ; » avec BOM, lisible directement par Excel en français. */
export const toCSV = (rows: unknown[][]) => "﻿" + rows.map((r) => r.map(csvEscape).join(";")).join("\r\n");
