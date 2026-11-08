import { requireMembership } from "@/lib/orgs";
import { audit } from "@/lib/auth";
import { db } from "@/lib/db";
import { toCSV } from "@/lib/events";
import { COLUMNS } from "@/lib/transparence-shared";

const day = (d: Date) => d.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", year: "numeric" });

/**
 * Conventions de partenariat signées (bénéficiaire personne morale : société savante, association, organisme de
 * formation), aux colonnes du fichier Transparence Santé : identifiant SIREN ou RNA, dénomination, montant HT.
 */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user } = await requireMembership(id, ["ADMIN", "CONFORMITE"]);
  const list = await db.eventPartner.findMany({
    where: { organizationId: id, signedAt: { not: null }, status: { in: ["signed", "paid"] } },
    include: { event: { select: { title: true, startsAt: true, organization: { select: { name: true, legalName: true, siren: true, rna: true, headquarters: true } } } } },
    orderBy: { signedAt: "asc" },
  });
  const rows = list.map((p) => {
    const o = p.event.organization;
    const r: Record<(typeof COLUMNS)[number], string | number> = {
      Action: "C", Déclaration: "Convention", "Identifiant unique": `KB-P-${p.id}`.toUpperCase().slice(0, 128), "Convention liée": "",
      "Date de signature / versement": day(p.signedAt!), "Date de fin": day(p.event.startsAt),
      "Objet convention / nature avantage": "Partenariat", Autre: "",
      "Montant des conventions / avantages / rémunération": p.amountCents != null ? Math.round(p.amountCents / 100) : "",
      "Information convention": `${p.event.title}${p.counterparts ? ` : ${p.counterparts}` : ""}`.slice(0, 500),
      "Type identifiant professionnel": o.siren ? "SIREN" : o.rna ? "RNA" : "AUTRE", "N° identifiant": o.siren ?? o.rna ?? "",
      Profession: "", "Identité / Nom": o.legalName ?? o.name, Prénom: "", "Structure d'exercice / de rattachement": "",
      Adresse: "", "Code postal": "", Ville: o.headquarters ?? "", Pays: "France",
    };
    return COLUMNS.map((c) => r[c]);
  });
  await audit(user.id, "partnership.export", "Organization", id, { lignes: rows.length });
  return new Response(toCSV([[...COLUMNS], ...rows]), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="partenariats-signes.csv"`, "Cache-Control": "private, no-store" },
  });
}
