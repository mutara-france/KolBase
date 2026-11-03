import "server-only";
import { db } from "@/lib/db";
import { collabType, interestWarning, SIGNED_STATUSES } from "@/lib/projects";
import { normalize } from "@/lib/search";
import { canSee, kolVisibility } from "@/lib/visibility";

/**
 * Suggestion d'experts pour un besoin : pertinence (spécialité, sous-spécialité, publications, types d'intervention)
 * pondérée par la diversité (part des honoraires déjà versés par l'organisation) et signalement des liens d'intérêts.
 * Le classement est explicable : chaque point du score a sa raison. Seuls les dossiers signés comptent comme
 * collaborations ; aucune autre organisation n'est nommée (ni à l'écran, ni dans ce qui est transmis à l'assistant).
 */
export type Suggestion = { id: string; name: string; detail: string; score: number; reasons: string[]; notes: string[]; warnings: string[]; dayRateCents: number | null };

const STOP = new Set(["avec", "pour", "dans", "des", "les", "une", "sur", "aux", "par", "est", "son", "ses", "leur", "cette", "entre", "plus", "comme", "dossier", "board", "reunion", "comite"]);
const tokens = (s: string) => [...new Set(normalize(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !STOP.has(w)))];

export async function suggestExperts(orgId: string, need: { title: string; typeId: string; area: string; description: string }, limit = 6): Promise<Suggestion[]> {
  const since = new Date(Date.now() - 365 * 86400e3);
  const [experts, orgLinks] = await Promise.all([
    db.practitionerProfile.findMany({
      where: { listed: true },
      include: {
        user: { select: { firstName: true, lastName: true } },
        publications: { select: { title: true, keywords: true }, take: 50 },
        declaredInterests: { select: { endYear: true } },
        projectLinks: {
          where: { status: { in: SIGNED_STATUSES }, createdAt: { gte: since } },
          select: { feeCents: true, project: { select: { organizationId: true, organization: { select: { kind: true } } } } },
        },
      },
      take: 1000,
    }),
    db.projectExpert.findMany({ where: { project: { organizationId: orgId }, status: { in: SIGNED_STATUSES }, createdAt: { gte: since } }, select: { feeCents: true } }),
  ]);
  const orgTotal = orgLinks.reduce((s, l) => s + (l.feeCents ?? 0), 0);
  const type = collabType(need.typeId);
  const area = normalize(need.area);
  const words = tokens(`${need.title} ${need.area} ${need.description}`);
  const year = new Date().getFullYear();

  const out: (Suggestion & { relevance: number })[] = experts.map((p) => {
    const reasons: string[] = [];
    const warnings: string[] = [];
    const notes: string[] = [];
    let score = 0;
    const spec = normalize(p.specialty);
    const sub = normalize(p.subspecialty);
    if (area && spec && (spec.includes(area) || area.includes(spec))) { score += 5; reasons.push(`Spécialité : ${p.specialty}`); }
    const subHit = sub && words.some((w) => sub.includes(w));
    if (subHit) { score += 3; reasons.push(`Sous-spécialité : ${p.subspecialty}`); }
    const pubText = normalize(p.publications.map((x) => `${x.title} ${x.keywords.join(" ")}`).join(" "));
    const pubHits = words.filter((w) => pubText.includes(w));
    if (pubHits.length) { score += Math.min(4, pubHits.length); reasons.push(`${p.publications.length} publication${p.publications.length > 1 ? "s" : ""} sur le sujet (${pubHits.slice(0, 3).join(", ")})`); }
    const bioHits = words.filter((w) => normalize(p.bio).includes(w) && !pubHits.includes(w));
    if (bioHits.length) { score += Math.min(2, bioHits.length); reasons.push("Parcours en lien avec le sujet"); }
    if (type && p.interventionTypes.some((t) => normalize(t).includes(normalize(type.label).split(" ")[0]) || t === type.id)) { score += 2; reasons.push(`A déjà proposé : ${type.label.toLowerCase()}`); }
    const relevance = score;
    if (p.rppsVerified) score += 1;
    if (p.responseDays != null && p.responseDays <= 3) { score += 1; reasons.push(`Répond en ${p.responseDays} j en moyenne`); }

    // Diversité : part des honoraires de l'organisation déjà versés à cet expert sur 12 mois.
    const mine = p.projectLinks.filter((l) => l.project.organizationId === orgId);
    const mineFees = mine.reduce((s, l) => s + (l.feeCents ?? 0), 0);
    if (mine.length) {
      const share = orgTotal ? mineFees / orgTotal : 0;
      if (share >= 0.2) { score -= 3; warnings.push(`Déjà ${Math.round(share * 100)} % de vos honoraires sur 12 mois (${mine.length} collaboration${mine.length > 1 ? "s" : ""})`); }
      else notes.push(`${mine.length} collaboration${mine.length > 1 ? "s" : ""} avec vous sur 12 mois`);
    }
    // Liens d'intérêts avec d'autres entreprises (dossiers signés sur KolBase, liens déclarés), sans les nommer.
    const otherCompanies = new Set(p.projectLinks.filter((l) => l.project.organizationId !== orgId && l.project.organization.kind === "INDUSTRIEL").map((l) => l.project.organizationId)).size;
    const interests = interestWarning(otherCompanies, p.declaredInterests.filter((d) => d.endYear == null || d.endYear >= year - 1).length);
    if (interests) { score -= 1; warnings.push(interests); }

    const v = kolVisibility(p.visibility);
    return {
      id: p.id, name: `Dr ${p.user.firstName} ${p.user.lastName}`, score, reasons, notes, warnings, relevance,
      detail: [p.specialty || p.profession, canSee(v.contact, "membre") ? p.city : null].filter(Boolean).join(" · "),
      dayRateCents: canSee(v.tarif, "membre") ? p.dayRateCents : null,
    };
  });
  return out
    .filter((s) => s.relevance > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map(({ relevance: _r, ...s }) => s);
}
