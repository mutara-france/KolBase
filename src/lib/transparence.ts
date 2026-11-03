import "server-only";
import { db } from "@/lib/db";
import { collabType } from "@/lib/projects";
import { country } from "@/lib/countries";
import { BENEFIT_NATURE, COLUMNS, CONVENTION_OBJECT, HOSPITALITY_CONVENTION, semesterRange, THRESHOLD_EUR, type Semester } from "@/lib/transparence-shared";

export * from "@/lib/transparence-shared";

/**
 * Fichier de déclaration Transparence Santé : une ligne par déclaration (convention, rémunération, avantage),
 * avec les libellés de la plateforme (saisie par copier-coller). Les avantages sont rattachés à leur convention
 * d'hospitalité, les rémunérations à leur convention, comme l'exige la plateforme.
 */

const idOf = (prefix: string, raw: string) => `KB-${prefix}-${raw}`.toUpperCase().replace(/[^A-Z0-9_-]/g, "_").slice(0, 128);
const day = (d: Date) => d.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", year: "numeric" });
const euros = (cents: number) => Math.round(cents / 100);

type Row = Record<(typeof COLUMNS)[number], string | number>;
export type DeclarationReport = { rows: Row[]; conventions: number; remunerations: number; advantages: number; excludedAbsent: number; belowThreshold: number; projectIds: string[]; registrationIds: string[] };

/** Lignes à déclarer sur un semestre (par défaut : seulement ce qui n'est pas encore marqué publié). */
export async function declarationRows(orgId: string, s: Semester, { includeDeclared = false } = {}): Promise<DeclarationReport> {
  const range = semesterRange(s);
  const [links, regs] = await Promise.all([
    db.projectExpert.findMany({
      where: { project: { organizationId: orgId, status: { in: ["SIGNE", "TERMINE"] }, ...(includeDeclared ? {} : { declared: false }) }, status: { notIn: ["DECLINE", "ATT_EXPERTS"] } },
      include: { project: true, signature: { select: { completedAt: true } }, practitioner: { include: { user: { select: { firstName: true, lastName: true } } } } },
      orderBy: { createdAt: "asc" },
    }),
    db.registration.findMany({
      where: { event: { organizationId: orgId, startsAt: range }, profession: { not: null }, benefits: { some: {} }, ...(includeDeclared ? {} : { declared: false }) },
      include: { user: { select: { firstName: true, lastName: true, practitioner: true } }, event: true, benefits: { include: { benefit: true } } },
      orderBy: { event: { startsAt: "asc" } },
    }),
  ]);
  const signedLogs = await db.auditLog.findMany({
    where: { entityType: "Project", entityId: { in: [...new Set(links.map((l) => l.projectId))] }, action: { in: ["project.signed", "project.attest"] } },
    select: { entityId: true, createdAt: true },
  });
  const pointedEvents = new Set((await db.registration.groupBy({ by: ["eventId"], where: { eventId: { in: [...new Set(regs.map((r) => r.eventId))] }, checkedInAt: { not: null } } })).map((g) => g.eventId));

  const rows: Row[] = [];
  const report: DeclarationReport = { rows, conventions: 0, remunerations: 0, advantages: 0, excludedAbsent: 0, belowThreshold: 0, projectIds: [], registrationIds: [] };
  const projects = new Set<string>();
  const inRange = (d: Date | null) => !!d && d >= range.gte && d < range.lt;
  const person = (p: { rpps: string | null; country: string; licenseNumber: string | null; profession: string; hospital: string | null; city: string | null } | null, u: { firstName: string; lastName: string }, fallbackProfession?: string | null) => ({
    "Type identifiant professionnel": p?.rpps ? "RPPS" : "AUTRE",
    "N° identifiant": p?.rpps ?? p?.licenseNumber ?? "",
    Profession: p?.profession ?? fallbackProfession ?? "",
    "Identité / Nom": u.lastName.toUpperCase(),
    Prénom: u.firstName,
    "Structure d'exercice / de rattachement": p?.hospital ?? "",
    Adresse: "",
    "Code postal": "",
    Ville: p?.city ?? "",
    Pays: country(p?.country ?? "FR").name,
  });

  // Conventions de collaboration (signées sur le semestre) et rémunérations versées sur le semestre.
  for (const l of links) {
    const signedAt = l.signature?.completedAt ?? l.project.signatureAttestedAt ?? signedLogs.filter((g) => g.entityId === l.projectId).at(-1)?.createdAt ?? l.project.updatedAt;
    const who = person(l.practitioner, l.practitioner.user);
    const conventionId = idOf("C", l.id);
    const type = collabType(l.project.typeId);
    if (inRange(signedAt)) {
      const object = CONVENTION_OBJECT[l.project.typeId] ?? "Autre";
      rows.push({
        Action: "C", Déclaration: "Convention", "Identifiant unique": conventionId, "Convention liée": "", "Date de signature / versement": day(signedAt), "Date de fin": "",
        "Objet convention / nature avantage": object, Autre: object === "Autre" ? (type?.label ?? l.project.typeId) : "",
        "Montant des conventions / avantages / rémunération": euros(l.feeCents ?? 0),
        "Information convention": `${type?.label ?? l.project.typeId} : ${l.project.title}`.slice(0, 500),
        ...who,
      });
      report.conventions++;
      projects.add(l.projectId);
    }
    if (l.paidAt && l.paidCents && inRange(l.paidAt)) {
      if (l.paidCents / 100 < THRESHOLD_EUR) { report.belowThreshold++; continue; }
      rows.push({
        Action: "C", Déclaration: "Rémunération", "Identifiant unique": idOf("R", l.id), "Convention liée": conventionId, "Date de signature / versement": day(l.paidAt), "Date de fin": "",
        "Objet convention / nature avantage": "", Autre: "", "Montant des conventions / avantages / rémunération": euros(l.paidCents), "Information convention": "",
        ...who,
      });
      report.remunerations++;
      projects.add(l.projectId);
    }
  }
  report.projectIds = [...projects];

  // Hospitalités : une convention par inscription, puis ses avantages (consommés : présents au pointage).
  for (const r of regs) {
    const absent = pointedEvents.has(r.eventId) && !r.checkedInAt;
    const kept = r.benefits.filter((b) => b.valueCents / 100 >= THRESHOLD_EUR);
    report.belowThreshold += r.benefits.length - kept.length;
    if (absent) { report.excludedAbsent += kept.length; continue; }
    if (kept.length === 0) continue;
    const who = person(r.user.practitioner, r.user, r.profession);
    const conventionId = idOf("CH", r.id);
    rows.push({
      Action: "C", Déclaration: "Convention", "Identifiant unique": conventionId, "Convention liée": "", "Date de signature / versement": day(r.createdAt), "Date de fin": day(r.event.startsAt),
      "Objet convention / nature avantage": HOSPITALITY_CONVENTION, Autre: "",
      "Montant des conventions / avantages / rémunération": euros(kept.reduce((x, b) => x + b.valueCents, 0)),
      "Information convention": `Hospitalités : ${r.event.title} (${day(r.event.startsAt)})`.slice(0, 500),
      ...who,
    });
    report.conventions++;
    report.registrationIds.push(r.id);
    kept.forEach((b, i) => {
      const nature = (b.benefit.catalogId && BENEFIT_NATURE[b.benefit.catalogId]) || "Autre";
      rows.push({
        Action: "C", Déclaration: "Avantage", "Identifiant unique": idOf("A", `${r.id}-${i + 1}`), "Convention liée": conventionId, "Date de signature / versement": day(r.event.startsAt), "Date de fin": "",
        "Objet convention / nature avantage": nature, Autre: nature === "Autre" ? b.benefit.label : "",
        "Montant des conventions / avantages / rémunération": euros(b.valueCents), "Information convention": "",
        ...who,
      });
      report.advantages++;
    });
  }
  return report;
}
