import Link from "next/link";
import { billingBlocked, dpaAccepted } from "@/lib/billing";
import { ENGAGING, subscribeHref, type Motive } from "@/lib/billing-plans";
import { dpaHref } from "@/lib/dpa";
import { db } from "@/lib/db";
import { inSentence } from "@/lib/elision";
import { getT } from "@/lib/i18n/server";
import { fmtDate } from "@/lib/i18n";

/**
 * Bandeaux des pages d'actions engageantes (le bouton d'envoi est désactivé à côté) : le contrat de sous-traitance
 * est à accepter, puis l'abonnement à activer, avant d'envoyer ou de publier. `objet` : l'action à reprendre
 * ensuite (événement, dossier, demande).
 */
export async function BillingNotice({ orgId, motive, objet }: { orgId: string; motive: Motive; objet?: string }) {
  const { t, locale } = await getT();
  // Organisation pas encore validée : la validation prime (l'abonnement ne débloquerait rien avant elle).
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { verification: true, verificationRequestedAt: true, verificationNote: true } });
  if (org && org.verification !== "VERIFIED")
    return (
      <p className="notice warn" role="status">
        {org.verification === "SUSPENDED"
          ? t("Organisation suspendue{v} : aucune nouvelle action n'est possible jusqu'à la réactivation par KolBase.", { v: org.verificationNote ? ` (${inSentence(org.verificationNote)})` : "" })
          : org.verification === "REJECTED"
            ? t("KolBase n'a pas validé votre organisation{v}. Pour {motive}, corrigez d'abord son identité.", { v: org.verificationNote ? ` : ${inSentence(org.verificationNote)}` : "", motive: t(ENGAGING[motive]) })
            : t("Votre organisation est en attente de validation par KolBase{v}. Pour {motive}, cette validation vient d'abord ; {v2}", { v: org.verificationRequestedAt ? ` (${t("demande transmise le {date}", { date: fmtDate(locale, org.verificationRequestedAt) })})` : "", motive: t(ENGAGING[motive]), v2: t(motive === "reponse" ? "répondre aux demandes reste gratuit jusqu'à votre premier devis retenu." : "l'abonnement se règle ensuite.") })}{" "}
        {org.verification !== "SUSPENDED" && <Link href={`/organisations/${orgId}/membres?onglet=organisation`}>{t("Suivre la validation")}</Link>}
      </p>
    );
  const dpa = motive !== "reponse" && !(await dpaAccepted(orgId)) ? (
    <p className="notice warn" role="status">
      {t("Pour {motive}, un administrateur de l'organisation doit d'abord accepter le contrat de sous-traitance (RGPD), qui encadre les données des experts, des inscrits et des conventions : Membres et réglages › Organisation.", { motive: t(ENGAGING[motive]) })}
      <Link href={dpaHref(orgId, motive, objet)}>{t("Accepter le contrat de sous-traitance")}</Link>
    </p>
  ) : null;
  if (!(await billingBlocked(orgId, motive))) return dpa;
  if (motive === "reponse")
    return (
      <p className="notice warn" role="status">
        {t("Votre premier devis a été retenu : pour {reponse}, activez l'abonnement prestataire (premier mois offert). Les prestations retenues et vos échanges en cours restent accessibles.", { reponse: ENGAGING.reponse })}
        <Link href={subscribeHref(orgId, motive, objet)}>{t("Activer l'abonnement")}</Link>
      </p>
    );
  return (
    <>
      {dpa}
      <p className="notice warn" role="status">
        {t("Pour {motive}, l'abonnement de l'organisation doit être activé (premier mois offert).", { motive: t(ENGAGING[motive]) })}{motive === "evenement" || motive === "devis" ? t(" Vous pouvez préparer et enregistrer des brouillons dès maintenant.") : ""}{" "}
        <Link href={subscribeHref(orgId, motive, objet)}>{t("Activer l'abonnement")}</Link>
      </p>
    </>
  );
}
