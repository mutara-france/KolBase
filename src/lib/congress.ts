/**
 * Congrès et associations (module pur) : programme en salles, partenaires et leurs conventions, appel à
 * communications et relecture par le comité.
 */
import { parseParisDateTime } from "@/lib/events";

export const PROGRAM_KINDS = [
  { id: "conference", label: "Conférence" },
  { id: "table-ronde", label: "Table ronde" },
  { id: "atelier", label: "Atelier" },
  { id: "symposium", label: "Symposium" },
  { id: "communications", label: "Communications" },
  { id: "pause", label: "Pause" },
] as const;
export const programKindLabel = (id: string) => PROGRAM_KINDS.find((k) => k.id === id)?.label ?? id;
export const isProgramKind = (id: string) => PROGRAM_KINDS.some((k) => k.id === id);

export const PARTNER_LEVELS = [
  { id: "principal", label: "Partenaire principal" },
  { id: "or", label: "Partenaire or" },
  { id: "argent", label: "Partenaire argent" },
  { id: "bronze", label: "Partenaire bronze" },
  { id: "symposium", label: "Symposium" },
  { id: "exposant", label: "Exposant" },
  { id: "institutionnel", label: "Partenaire institutionnel" },
] as const;
export const partnerLevelLabel = (id: string) => PARTNER_LEVELS.find((l) => l.id === id)?.label ?? id;
export const isPartnerLevel = (id: string) => PARTNER_LEVELS.some((l) => l.id === id);
/** Ordre d'affichage des partenaires (page publique) : du plus haut niveau au plus bas. */
export const levelRank = (id: string) => {
  const i = PARTNER_LEVELS.findIndex((l) => l.id === id);
  return i < 0 ? PARTNER_LEVELS.length : i;
};

export const PARTNER_STATUS: Record<string, { label: string; tone: "wait" | "ok" | "bad" | "done" | "" }> = {
  draft: { label: "Brouillon", tone: "" },
  proposed: { label: "Proposée", tone: "wait" },
  signed: { label: "Signée", tone: "ok" },
  declined: { label: "Déclinée", tone: "bad" },
  paid: { label: "Réglée", tone: "done" },
};
/** Partenariat acquis (signé, réglé) : affiché sur la page publique, compté dans le financement. */
export const partnerSecured = (status: string) => status === "signed" || status === "paid";

/** Financement par les partenaires (centimes HT) : acquis et en attente de réponse. */
export function partnerTotals(ps: { status: string; amountCents: number | null }[]) {
  const sum = (f: (s: string) => boolean) => ps.filter((p) => f(p.status)).reduce((x, p) => x + (p.amountCents ?? 0), 0);
  return { secured: sum(partnerSecured), pending: sum((s) => s === "proposed" || s === "draft") };
}

export const ABSTRACT_FORMATS = [
  { id: "oral", label: "Communication orale" },
  { id: "poster", label: "Poster" },
  { id: "indifferent", label: "Orale ou poster" },
] as const;
export const abstractFormatLabel = (id: string | null | undefined) => ABSTRACT_FORMATS.find((f) => f.id === id)?.label ?? null;
export const isAbstractFormat = (id: string) => ABSTRACT_FORMATS.some((f) => f.id === id);

export const ABSTRACT_STATUS: Record<string, { label: string; tone: "wait" | "ok" | "bad" | "done" }> = {
  submitted: { label: "Soumise", tone: "wait" },
  accepted: { label: "Retenue", tone: "ok" },
  rejected: { label: "Non retenue", tone: "bad" },
  withdrawn: { label: "Retirée", tone: "done" },
};

export const MAX_ABSTRACT_CHARS = 3000;
export const MAX_ABSTRACTS_PER_USER = 3;
export const MAX_TOPICS = 20;

/** Appel à communications ouvert : date limite à venir, événement publié et non annulé. */
export const abstractsOpen = (e: { abstractsDeadline: Date | null; publishedAt: Date | null; cancelledAt: Date | null }, now = new Date()) =>
  !!e.abstractsDeadline && !!e.publishedAt && !e.cancelledAt && e.abstractsDeadline.getTime() > now.getTime();

/** Thèmes saisis (un par ligne ou séparés par des virgules) : sans doublon, 20 au plus, 80 caractères chacun. */
export function parseTopics(raw: string) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of raw.split(/[\n,;]/).map((s) => s.trim().slice(0, 80)).filter(Boolean)) {
    const k = x.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
    if (out.length >= MAX_TOPICS) break;
  }
  return out;
}

/** Moyenne des notes du comité (1 à 5), arrondie au dixième ; null sans avis. */
export function reviewScore(rs: { score: number }[]) {
  if (!rs.length) return null;
  return { n: rs.length, avg: Math.round((rs.reduce((x, r) => x + r.score, 0) / rs.length) * 10) / 10 };
}

/** Séance du programme saisie (jour, heure de début et de fin, heure de Paris) : erreur, ou les dates. */
export function programSlot(day: string, start: string, end: string): { startsAt: Date; endsAt: Date } | string {
  const startsAt = parseParisDateTime(`${day}T${start}`);
  const endsAt = parseParisDateTime(`${day}T${end}`);
  if (!startsAt || !endsAt) return "Indiquez le jour et les horaires de la séance.";
  if (endsAt <= startsAt) return "La fin de la séance suit son début.";
  return { startsAt, endsAt };
}

/** Programme par jour (heure de Paris), séances dans l'ordre ; salles dans l'ordre de leur création. */
export function programByDay<T extends { startsAt: Date; endsAt: Date }>(items: T[]) {
  const days = new Map<string, T[]>();
  for (const it of [...items].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.endsAt.getTime() - b.endsAt.getTime())) {
    const k = it.startsAt.toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
    days.set(k, [...(days.get(k) ?? []), it]);
  }
  return [...days.entries()].map(([day, list]) => ({ day, items: list }));
}

/** Deux séances dans la même salle qui se chevauchent : la seconde est signalée. */
export function roomConflicts(items: { id: string; roomId: string | null; startsAt: Date; endsAt: Date }[]) {
  const out = new Set<string>();
  const sorted = [...items].filter((i) => i.roomId).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  for (let i = 0; i < sorted.length; i++)
    for (let j = i + 1; j < sorted.length; j++)
      if (sorted[j].roomId === sorted[i].roomId && sorted[j].startsAt < sorted[i].endsAt) out.add(sorted[j].id);
  return out;
}
