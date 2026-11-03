import Link from "next/link";
import { billingBlocked, dpaAccepted } from "@/lib/billing";
import { ENGAGING, subscribeHref, type Motive } from "@/lib/billing-plans";
import { dpaHref } from "@/lib/dpa";

/**
 * Bandeaux des pages d'actions engageantes (le bouton d'envoi est désactivé à côté) : le contrat de sous-traitance
 * est à accepter, puis l'abonnement à activer, avant d'envoyer ou de publier. `objet` : l'action à reprendre
 * ensuite (événement, dossier, demande).
 */
export async function BillingNotice({ orgId, motive, objet }: { orgId: string; motive: Motive; objet?: string }) {
  const dpa = motive !== "reponse" && !(await dpaAccepted(orgId)) ? (
    <p className="notice warn" role="status">
      Pour {ENGAGING[motive]}, un administrateur de l&apos;organisation doit d&apos;abord accepter le contrat de sous-traitance (RGPD), qui encadre les données des experts, des inscrits et des conventions : Membres et réglages › Organisation.{" "}
      <Link href={dpaHref(orgId, motive, objet)}>Accepter le contrat de sous-traitance</Link>
    </p>
  ) : null;
  if (!(await billingBlocked(orgId, motive))) return dpa;
  if (motive === "reponse")
    return (
      <p className="notice warn" role="status">
        Votre premier devis a été retenu : pour {ENGAGING.reponse}, activez l&apos;abonnement prestataire (premier mois offert). Les prestations retenues et vos échanges en cours restent accessibles.{" "}
        <Link href={subscribeHref(orgId, motive, objet)}>Activer l&apos;abonnement</Link>
      </p>
    );
  return (
    <>
      {dpa}
      <p className="notice warn" role="status">
        Pour {ENGAGING[motive]}, l&apos;abonnement de l&apos;organisation doit être activé (premier mois offert).{motive === "evenement" || motive === "devis" ? " Vous pouvez préparer et enregistrer des brouillons dès maintenant." : ""}{" "}
        <Link href={subscribeHref(orgId, motive, objet)}>Activer l&apos;abonnement</Link>
      </p>
    </>
  );
}
