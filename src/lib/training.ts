/**
 * Formations (module pur) : fiche d'information du public (Qualiopi), demi-journées et émargement, évaluation des
 * acquis, indicateurs de résultats publiés avec leur mode de calcul.
 */
import { parseParisDateTime } from "@/lib/events";

export const FUNDING = [
  { id: "dpc", label: "DPC (ANDPC)" },
  { id: "fifpl", label: "FIF-PL" },
  { id: "opco", label: "OPCO" },
  { id: "employeur", label: "Employeur ou établissement" },
  { id: "personnel", label: "Financement personnel" },
] as const;
export const fundingLabel = (id: string) => FUNDING.find((f) => f.id === id)?.label ?? id;
export const isFunding = (id: string) => FUNDING.some((f) => f.id === id);

export const ASSESSMENTS = [
  { id: "acquis", label: "Acquis" },
  { id: "partiel", label: "Partiellement acquis" },
  { id: "non_acquis", label: "Non acquis" },
] as const;
export const assessmentLabel = (id: string | null | undefined) => ASSESSMENTS.find((a) => a.id === id)?.label ?? null;
export const isAssessment = (id: string) => ASSESSMENTS.some((a) => a.id === id);

export type Sheet = {
  objectives: string; audience: string | null; prerequisites: string | null; hours: number | null; methods: string | null; assessment: string | null;
  accessDelay: string | null; accessibility: string | null; price: string | null; funding: string[]; fundingNote: string | null; dpcRef: string | null; contact: string | null;
};

/**
 * Informations attendues sur une action de formation (indicateur 1 du référentiel Qualiopi) : ce qui manque à la
 * fiche, libellés à afficher. Le numéro de déclaration d'activité est demandé à l'organisme de formation.
 */
export function sheetMissing(s: Partial<Sheet> | null, org: { kind: string; nda: string | null; handicapContact: string | null }) {
  const out: string[] = [];
  if (!s?.objectives) out.push("Objectifs");
  if (!s?.audience) out.push("Public visé");
  if (!s?.prerequisites) out.push("Prérequis");
  if (!s?.hours) out.push("Durée");
  if (!s?.methods) out.push("Modalités pédagogiques");
  if (!s?.assessment) out.push("Modalités d'évaluation");
  if (!s?.accessDelay) out.push("Modalités et délai d'accès");
  if (!s?.accessibility && !org.handicapContact) out.push("Accessibilité");
  if (!s?.price) out.push("Tarif");
  if (!s?.funding?.length) out.push("Modalités de financement");
  if (!s?.contact) out.push("Contact");
  if (org.kind === "ORGANISME_FORMATION" && !org.nda) out.push("Numéro de déclaration d'activité");
  return out;
}

// ─── Demi-journées et émargement ──────────────────────────────────────────

export const MAX_DAYS = 10;
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Demi-journées de plusieurs jours consécutifs (heure de Paris) : matin et/ou après-midi, aux horaires indiqués.
 * Erreur (message), ou la liste des séquences.
 */
export function halfDays(o: { firstDay: string; days: number; am: [string, string] | null; pm: [string, string] | null }): { startsAt: Date; endsAt: Date }[] | string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o.firstDay)) return "Indiquez le premier jour.";
  if (!Number.isInteger(o.days) || o.days < 1 || o.days > MAX_DAYS) return "De 1 à 10 jours.";
  if (!o.am && !o.pm) return "Choisissez le matin, l'après-midi, ou les deux.";
  for (const h of [o.am, o.pm]) if (h && (!HM.test(h[0]) || !HM.test(h[1]) || h[1] <= h[0])) return "Horaires invalides : la fin suit le début.";
  if (o.am && o.pm && o.pm[0] < o.am[1]) return "L'après-midi commence après la fin du matin.";
  const out: { startsAt: Date; endsAt: Date }[] = [];
  const [y, m, d] = o.firstDay.split("-").map(Number);
  for (let i = 0; i < o.days; i++) {
    const day = new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10);
    for (const h of [o.am, o.pm]) {
      if (!h) continue;
      const startsAt = parseParisDateTime(`${day}T${h[0]}`);
      const endsAt = parseParisDateTime(`${day}T${h[1]}`);
      if (!startsAt || !endsAt) return "Horaires invalides : la fin suit le début.";
      out.push({ startsAt, endsAt });
    }
  }
  return out;
}

/** Durée d'une séquence, en heures (arrondie au quart d'heure). */
export const sessionHours = (s: { startsAt: Date; endsAt: Date }) => Math.round(((s.endsAt.getTime() - s.startsAt.getTime()) / 3600e3) * 4) / 4;
export const totalHours = (ss: { startsAt: Date; endsAt: Date }[]) => ss.reduce((x, s) => x + sessionHours(s), 0);

/** Le participant signe lui-même, connecté, de 30 minutes avant le début à la fin de la demi-journée. */
export const SELF_SIGN_EARLY_MS = 30 * 60e3;
export const selfSignOpen = (s: { startsAt: Date; endsAt: Date }, now = new Date()) =>
  now.getTime() >= s.startsAt.getTime() - SELF_SIGN_EARLY_MS && now.getTime() <= s.endsAt.getTime();

/** Heures suivies : demi-journées émargées. */
export const attendedHours = (sessions: { id: string; startsAt: Date; endsAt: Date }[], signed: Set<string>) => totalHours(sessions.filter((s) => signed.has(s.id)));

/** Couverture d'un événement par ses demi-journées : du début de la première à la fin de la dernière (minutes). */
export function spanMinutes(sessions: { startsAt: Date; endsAt: Date }[]) {
  if (!sessions.length) return null;
  const start = Math.min(...sessions.map((s) => s.startsAt.getTime()));
  const end = Math.max(...sessions.map((s) => s.endsAt.getTime()));
  return { start: new Date(start), minutes: Math.round((end - start) / 60e3) };
}

// ─── Indicateurs de résultats ─────────────────────────────────────────────

/** Formations prises en compte : terminées sur les douze derniers mois. */
export const INDICATOR_MONTHS = 12;
export const SATISFACTION_METHOD = "Part des répondants ayant donné une note globale de 4 ou 5 sur 5 au questionnaire de fin de formation, formations terminées sur les 12 derniers mois.";
export const ACQUISITION_METHOD = "Part des participants évalués dont les acquis sont validés, sur les mêmes formations.";

/** Taux de satisfaction (notes 4 ou 5 sur 5) et taux de réponse ; null sans réponse. */
export function satisfaction(responses: { overall: number }[], participants: number) {
  if (!responses.length) return null;
  const satisfied = responses.filter((r) => r.overall >= 4).length;
  return {
    respondents: responses.length,
    rate: Math.round((satisfied / responses.length) * 100),
    responseRate: participants > 0 ? Math.min(100, Math.round((responses.length / participants) * 100)) : null,
  };
}

/** Taux d'acquisition : participants évalués « acquis » ; null sans évaluation. */
export function acquisition(assessments: (string | null)[]) {
  const done = assessments.filter((a): a is string => !!a);
  if (!done.length) return null;
  return { assessed: done.length, rate: Math.round((done.filter((a) => a === "acquis").length / done.length) * 100) };
}

/** Progression perçue (auto-positionnement avant / après, 1 à 5) ; null sans réponse complète. */
export function selfProgress(rs: { selfBefore: number | null; selfAfter: number | null }[]) {
  const both = rs.filter((r) => r.selfBefore != null && r.selfAfter != null) as { selfBefore: number; selfAfter: number }[];
  if (!both.length) return null;
  const avg = (xs: number[]) => Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10;
  return { n: both.length, before: avg(both.map((r) => r.selfBefore)), after: avg(both.map((r) => r.selfAfter)) };
}
