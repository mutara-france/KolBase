import Link from "next/link";
import { billingBlocked, dpaAccepted } from "@/lib/billing";
import { ENGAGING, subscribeHref, type Motive } from "@/lib/billing-plans";
import { dpaHref } from "@/lib/dpa";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/events";

/**
 * Bandeaux des pages d'actions engageantes (le bouton d'envoi est désactivé à côté) : le contrat de sous-traitance
 * est à accepter, puis l'abonnement à activer, avant d'envoyer ou de publier. `objet` : l'action à reprendre
 * ensuite (événement, dossier, demande).
 */
export async function BillingNotice({ orgId, motive, objet }: { orgId: string; motive: Motive; objet?: string }) {
  // Organisation pas encore validée : la validation prime (l'abonnement ne débloquerait rien avant elle).
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { verification: true, verificationRequestedAt: true, verificationNote: true } });
  if (org && org.verification !== "VERIFIED")
    return (
      <p className="notice warn" role="status">
        {org.verification === "SUSPENDED"
          ? `Organisation suspendue${org.verificationNote ? ` : ${org.verificationNote}` : ""} : aucune nouvelle action n'est possible jusqu'à la réactivation par KolBase.`
          : org.verification === "REJECTED"
            ? `KolBase n'a pas validé votre organisation${org.verificationNote ? ` : ${org.verificationNote}` : ""}. Pour ${ENGAGING[motive]}, corrigez d'abord son identité.`
            : `Votre organisation est en attente de validation par KolBase${org.verificationRequestedAt ? ` (demande transmise le ${formatDate(org.verificationRequestedAt)})` : ""}. Pour ${ENGAGING[motive]}, cette validation vient d'abord ; l'abonnement se règle ensuite.`}{" "}
        {org.verification !== "SUSPENDED" && <Link href={`/organisations/${orgId}/membres?onglet=organisation`}>Suivre la validation</Link>}
      </p>
    );
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
