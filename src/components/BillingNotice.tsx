import Link from "next/link";
import { engagementAllowed, stripeEnabled } from "@/lib/billing";
import { ENGAGING, type Motive } from "@/lib/billing-plans";

/** Bandeau des pages d'actions engageantes : l'abonnement est à activer avant d'envoyer ou de publier. */
export async function BillingNotice({ orgId, motive }: { orgId: string; motive: Motive }) {
  if (!stripeEnabled() || (await engagementAllowed(orgId))) return null;
  return (
    <p className="notice warn">
      Pour {ENGAGING[motive]}, l&apos;abonnement de l&apos;organisation doit être activé (premier mois offert).{motive === "evenement" || motive === "devis" ? " Vous pouvez préparer et enregistrer des brouillons dès maintenant." : ""}{" "}
      <Link href={`/organisations/${orgId}/abonnement?motif=${motive}`}>Voir l&apos;abonnement</Link>
    </p>
  );
}
