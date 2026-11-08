import "server-only";
import { db } from "@/lib/db";
import { collabType } from "@/lib/projects";
import { EXPENSE_NATURE_BE, isExpenseCategory } from "@/lib/expert-costs";

/**
 * Préparation de la publication belge (betransparent.be, loi dite « Sunshine Act ») : primes et avantages accordés sur
 * une année civile à des praticiens exerçant en Belgique, que l'entreprise soit belge ou non. Une ligne par
 * avantage (hospitalités d'un événement) ou par rémunération versée, avec le numéro INAMI et, pour une manifestation
 * de plusieurs jours, le visa Mdeon. Format KolBase, à reporter dans le modèle de la plateforme : ce fichier est une
 * aide à la préparation, pas le fichier officiel.
 */

export const BE_COLUMNS = [
  "Nom", "Prénom", "Numéro INAMI", "Profession", "Ville", "Catégorie", "Nature", "Date", "Montant (EUR)", "Objet", "Visa Mdeon", "Référence KolBase",
] as const;
type Row = Record<(typeof BE_COLUMNS)[number], string | number>;

/** Catégories de la publication belge (frais liés aux manifestations ; honoraires de prestations et de consultance). */
const EVENT_COSTS = "Frais liés à des manifestations scientifiques";
const SERVICE_FEES = "Honoraires de prestations de services et de consultance";
const NATURE: Record<string, string> = {
  inscription: "Frais d'inscription",
  transport: "Frais de déplacement",
  nuitee: "Frais d'hébergement",
  dejeuner: "Repas",
  cocktail: "Repas",
  cafe: "Collation",
};

const day = (d: Date) => d.toLocaleDateString("fr-BE", { timeZone: "Europe/Brussels", day: "2-digit", month: "2-digit", year: "numeric" });
const amount = (cents: number) => Math.round(cents) / 100;

export type BelgianReport = { rows: Row[]; practitioners: number; advantages: number; remunerations: number; excludedAbsent: number };

/** Lignes de l'année pour l'organisation : hospitalités consommées (présence pointée) et honoraires versés. */
export async function belgianRows(orgId: string, year: number): Promise<BelgianReport> {
  const range = { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) };
  const [regs, links] = await Promise.all([
    db.registration.findMany({
      where: { event: { organizationId: orgId, startsAt: range }, cancelledAt: null, benefits: { some: {} }, user: { practitioner: { country: "BE" } } },
      include: { user: { select: { firstName: true, lastName: true, practitioner: true } }, event: true, benefits: { include: { benefit: true } } },
      orderBy: { event: { startsAt: "asc" } },
    }),
    db.projectExpert.findMany({
      where: { project: { organizationId: orgId }, paidAt: range, paidCents: { gt: 0 }, practitioner: { country: "BE" } },
      include: { project: true, practitioner: { include: { user: { select: { firstName: true, lastName: true } } } } },
      orderBy: { paidAt: "asc" },
    }),
  ]);
  // Frais liés à la prestation (transport, hébergement, repas), remboursés dans l'année.
  const expenses = await db.expertExpense.findMany({
    where: { status: "paid", paidAt: range, projectExpert: { project: { organizationId: orgId }, practitioner: { country: "BE" } } },
    include: { projectExpert: { include: { project: true, practitioner: { include: { user: { select: { firstName: true, lastName: true } } } } } } },
    orderBy: { paidAt: "asc" },
  });
  const pointed = new Set((await db.registration.groupBy({ by: ["eventId"], where: { eventId: { in: [...new Set(regs.map((r) => r.eventId))] }, checkedInAt: { not: null } } })).map((g) => g.eventId));
  const rows: Row[] = [];
  const people = new Set<string>();
  const report: BelgianReport = { rows, practitioners: 0, advantages: 0, remunerations: 0, excludedAbsent: 0 };
  const who = (p: { licenseNumber: string | null; profession: string; city: string | null } | null, u: { firstName: string; lastName: string }) => ({
    Nom: u.lastName.toUpperCase(), Prénom: u.firstName, "Numéro INAMI": p?.licenseNumber ?? "", Profession: p?.profession ?? "", Ville: p?.city ?? "",
  });

  for (const r of regs) {
    // Événement pointé et participant absent : rien n'a été consommé.
    if (pointed.has(r.eventId) && !r.checkedInAt) { report.excludedAbsent += r.benefits.length; continue; }
    people.add(r.userId);
    r.benefits.forEach((b, i) => {
      rows.push({
        ...who(r.user.practitioner, r.user),
        Catégorie: EVENT_COSTS,
        Nature: (b.benefit.catalogId && NATURE[b.benefit.catalogId]) || b.benefit.label,
        Date: day(r.event.startsAt),
        "Montant (EUR)": amount(b.valueCents),
        Objet: r.event.title.slice(0, 300),
        "Visa Mdeon": r.event.mdeonVisa ?? "",
        "Référence KolBase": `KB-BE-A-${r.id}-${i + 1}`.toUpperCase(),
      });
      report.advantages++;
    });
  }
  for (const l of links) {
    people.add(l.practitioner.userId);
    rows.push({
      ...who(l.practitioner, l.practitioner.user),
      Catégorie: SERVICE_FEES,
      Nature: collabType(l.project.typeId)?.label ?? "Honoraires",
      Date: day(l.paidAt!),
      "Montant (EUR)": amount(l.paidCents!),
      Objet: l.project.title.slice(0, 300),
      "Visa Mdeon": "",
      "Référence KolBase": `KB-BE-R-${l.id}`.toUpperCase(),
    });
    report.remunerations++;
  }
  for (const x of expenses) {
    const l = x.projectExpert;
    people.add(l.practitioner.userId);
    rows.push({
      ...who(l.practitioner, l.practitioner.user),
      Catégorie: SERVICE_FEES,
      Nature: isExpenseCategory(x.category) ? EXPENSE_NATURE_BE[x.category] : x.label,
      Date: day(x.paidAt!),
      "Montant (EUR)": amount(x.amountCents),
      Objet: `${l.project.title} : ${x.label}`.slice(0, 300),
      "Visa Mdeon": "",
      "Référence KolBase": `KB-BE-F-${x.id}`.toUpperCase(),
    });
    report.advantages++;
  }
  report.practitioners = people.size;
  return report;
}
