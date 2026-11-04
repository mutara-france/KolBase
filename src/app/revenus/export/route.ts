import { requireUser } from "@/lib/auth";
import { toCSV } from "@/lib/events";
import { practitionerLedger } from "@/lib/revenues";
import { statusLabel } from "@/lib/projects";
import { canBeExpert } from "@/lib/professions";

/** Export CSV d'une année de revenus (honoraires et hospitalités), pour la comptabilité du praticien. */
export async function GET(req: Request) {
  const user = await requireUser();
  // Comme la page « Mes revenus » : réservé aux professions qui peuvent être expertes.
  if (!user.practitioner || (!canBeExpert(user.practitioner.profession) && !user.practitioner.listed)) return new Response("Réservé aux praticiens.", { status: 404 });
  const year = Number(new URL(req.url).searchParams.get("annee")) || new Date().getFullYear();
  const ledger = await practitionerLedger(user.id, user.practitioner.id);
  const eur = (c: number | null | undefined) => (c != null ? (c / 100).toFixed(2).replace(".", ",") : "");
  const day = (d: Date | null) => (d ? d.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" }) : "");
  // Statut, comme à l'écran : payé, à percevoir (convention signée) ou en préparation ; hospitalité reçue ou absent.
  const rows: unknown[][] = [["Type", "Date", "Organisation", "Objet", "Montant (€)", "HT/TTC", "Statut", "Payé le", "Montant payé (€)", "Déclaré Transparence Santé"]];
  for (const f of ledger.fees.filter((x) => x.year === year)) {
    const status = f.paidAt ? "payé" : f.signed ? "convention signée, paiement à venir" : statusLabel(f.status, "expert");
    rows.push(["Honoraires", day(f.date), f.org.name, f.title, eur(f.feeCents), "HT", status, day(f.paidAt), eur(f.paidCents), f.declared ? "oui" : "non"]);
  }
  for (const h of ledger.hospitality.filter((x) => x.year === year))
    rows.push(["Hospitalité", day(h.date), h.org.name, `${h.title} : ${h.items.join(", ")}`, eur(h.valueCents), "TTC", h.absent ? "absent : non consommée" : "reçue", "", "", h.declared ? "oui" : h.absent ? "absent : non déclaré" : "non"]);
  return new Response(toCSV(rows), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="kolbase-revenus-${year}.csv"`, "Cache-Control": "private, no-store" },
  });
}
