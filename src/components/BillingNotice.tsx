import Link from "next/link";
import { billingBlocked } from "@/lib/billing";
import { ENGAGING, subscribeHref, type Motive } from "@/lib/billing-plans";

/**
 * Bandeau des pages d'actions engageantes : l'abonnement est à activer avant d'envoyer ou de publier (le bouton
 * d'envoi est désactivé à côté). `objet` : l'action à reprendre après le paiement (événement, dossier, demande).
 */
export async function BillingNotice({ orgId, motive, objet }: { orgId: string; motive: Motive; objet?: string }) {
  if (!(await billingBlocked(orgId, motive))) return null;
  if (motive === "reponse")
    return (
      <p className="notice warn" role="status">
        Votre premier devis a été retenu : pour {ENGAGING.reponse}, activez l&apos;abonnement prestataire (premier mois offert). Les prestations retenues et vos échanges en cours restent accessibles.{" "}
        <Link href={subscribeHref(orgId, motive, objet)}>Activer l&apos;abonnement</Link>
      </p>
    );
  return (
    <p className="notice warn" role="status">
      Pour {ENGAGING[motive]}, l&apos;abonnement de l&apos;organisation doit être activé (premier mois offert).{motive === "evenement" || motive === "devis" ? " Vous pouvez préparer et enregistrer des brouillons dès maintenant." : ""}{" "}
      <Link href={subscribeHref(orgId, motive, objet)}>Activer l&apos;abonnement</Link>
    </p>
  );
}
