import Link from "next/link";
import { LegalPage, L, P, T } from "@/components/LegalPage";
import { LEGAL, legal } from "@/lib/legal";
import { formatPrice, freeMonths, PLANS, TRIAL_DAYS } from "@/lib/billing-plans";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata = { title: "Conditions générales de vente — KolBase", alternates: { canonical: "/conditions-de-vente" } };

const eur = (cents: number) => `${(cents / 100).toLocaleString("fr-FR")} € HT`;

/** Conditions générales de vente : abonnements (organisations, prestataires) et services KolBase. Prix tirés du code et du catalogue. */
export default async function Page() {
  const offers = await db.serviceOffer.findMany({ where: { active: true }, orderBy: { position: "asc" } });
  const contact = <a href={`mailto:${LEGAL.contactEmail}`}>{legal("contactEmail")}</a>;
  return (
    <LegalPage
      path="/conditions-de-vente"
      title="Conditions générales de vente"
      updated="6 novembre 2026"
      intro={<P>{[`Les présentes conditions régissent les abonnements et les services payants de KolBase, vendus par ${legal("editor")} (« l'éditeur ») à des professionnels. Elles complètent les conditions générales d'utilisation.`]}</P>}
      sections={[
        ["Champ d'application", <P key="1">{[
          "Les présentes conditions s'appliquent à toute souscription d'abonnement et à toute commande de service passée sur KolBase par une organisation ou un prestataire (« le client »), représenté par un administrateur de son espace. Elles sont acceptées lors de l'activation de l'abonnement ou de la commande et prévalent sur tout autre document du client, sauf accord écrit contraire.",
          "Les offres de KolBase sont réservées aux professionnels. Les praticiens n'ont rien à payer pour utiliser KolBase.",
        ]}</P>],
        ["Offres et prix", <>
          <P>{["Les prix sont exprimés hors taxes ; la TVA au taux en vigueur s'y ajoute."]}</P>
          <T head={["Offre", "Mensuel, sans engagement", "Annuel"]} rows={[
            ["Organisation (industriel, société savante, association, organisme de formation)", formatPrice(PLANS.organisation.cents), `${formatPrice(PLANS.organisation.yearCents, "year")} (${freeMonths("organisation")} mois offerts)`],
            ["Prestataire (traiteur, lieu, hébergement, agence…)", formatPrice(PLANS.prestataire.cents), `${formatPrice(PLANS.prestataire.yearCents, "year")} (${freeMonths("prestataire")} mois offerts)`],
          ]} />
          <P>{["L'abonnement couvre l'ensemble de l'organisation : utilisateurs illimités, agences mandatées sans surcoût."]}</P>
        </>],
        ["Ce qui déclenche l'abonnement", <>
          <P>{["La création du compte, la validation de l'organisation, l'invitation de l'équipe, le paramétrage, la consultation de l'annuaire et les brouillons sont gratuits. L'abonnement est demandé :"]}</P>
          <L items={[
            "pour une organisation, à sa première action qui engage un tiers : envoi d'une sollicitation à des experts, publication d'une opportunité ou d'un événement dans l'agenda, envoi d'une demande de devis ; la publication d'un événement reste gratuite pour une société savante, une association professionnelle ou un organisme de formation ;",
            "pour un prestataire, après son premier devis retenu par une organisation : le référencement, la vitrine et les réponses restent gratuits jusque-là ; l'abonnement permet ensuite de répondre à de nouvelles demandes.",
          ]} />
          <P>{["Sans abonnement actif, le client conserve l'accès à ses dossiers, conventions, registres, déclarations et échanges en cours ; seules les nouvelles actions engageantes sont suspendues. Payer ne modifie jamais la place d'un prestataire ou d'un expert dans l'annuaire."]}</P>
        </>],
        ["Premier mois offert", <P key="4">{[
          `Le premier abonnement d'un client bénéficie d'une période d'essai de ${TRIAL_DAYS} jours, une seule fois par organisation. Le premier prélèvement intervient à son terme, sauf résiliation avant cette date ; une réactivation ultérieure n'ouvre pas droit à une nouvelle période offerte.`,
          "L'éditeur peut accorder des gratuités (phase pilote, partenariat, démonstration) pour une durée déterminée, indiquée dans l'espace Abonnement ; à son terme, l'abonnement est demandé dans les conditions ci-dessus.",
        ]}</P>],
        ["Souscription, paiement et factures", <P key="5">{[
          `L'abonnement est activé par un administrateur du client depuis la page Abonnement de son espace. Le paiement est traité par ${legal("paymentProvider")}, par carte bancaire ou par prélèvement SEPA (le client signe alors un mandat de prélèvement) ; l'éditeur ne conserve aucune donnée de carte.`,
          "L'abonnement est payable d'avance, à chaque échéance mensuelle ou annuelle. Une facture électronique est émise à chaque paiement et adressée par e-mail ; le client la retrouve, avec son moyen de paiement, dans l'espace client accessible depuis la page Abonnement.",
        ]}</P>],
        ["Durée et résiliation", <P key="6">{[
          "L'abonnement mensuel est sans engagement ; l'abonnement annuel est souscrit pour douze mois. L'un et l'autre se renouvellent tacitement pour une période identique.",
          "Le client peut résilier à tout moment depuis l'espace client. La résiliation prend effet à la fin de la période en cours (mois ou année) ; la période entamée reste due et n'est pas remboursée au prorata, sauf manquement de l'éditeur. Les données restent accessibles selon les conditions générales d'utilisation.",
        ]}</P>],
        ["Retard ou défaut de paiement", <P key="7">{[
          "En cas d'échec d'un paiement, le client est prévenu et le prestataire de paiement présente de nouveau l'échéance ; l'accès au service est maintenu pendant ces relances.",
          "Toute somme impayée à l'échéance porte de plein droit intérêt au taux égal à trois fois le taux d'intérêt légal, et donne lieu à une indemnité forfaitaire pour frais de recouvrement de 40 € (articles L.441-10 et D.441-5 du Code de commerce). Après une mise en demeure restée sans effet pendant quinze jours, l'éditeur peut suspendre les actions engageantes ou résilier l'abonnement.",
        ]}</P>],
        ["Services KolBase", <>
          <P>{["Sur chaque événement publié et à venir, une organisation peut commander des services réalisés par l'équipe KolBase pour le faire connaître. Les prix en vigueur sont les suivants ; le prix applicable est celui affiché au moment de la commande."]}</P>
          {offers.length > 0 && <T head={["Service", "Prix", "Description"]} rows={offers.map((o) => [o.label, eur(o.priceCents), o.description])} />}
          <L items={[
            "Commande : depuis la fiche de l'événement, avec des consignes et une date souhaitée facultatives. L'équipe KolBase planifie la réalisation ou refuse la commande par une décision motivée, notifiée par e-mail ; une commande peut être annulée sans frais tant qu'elle n'est pas planifiée.",
            "Pack : le prix réduit d'un pack est réparti entre les services qu'il comprend, au prorata de leurs prix séparés ; annuler un service du pack, avant sa planification, annule le pack entier.",
            "Contenus : l'organisation fournit des informations exactes et répond de leur conformité, notamment aux règles de la publicité des produits de santé. L'éditeur rédige ou met en forme la communication, la signale comme réalisée pour le compte de l'organisation et peut refuser un contenu non conforme.",
            "Diffusion : l'e-mailing est adressé aux seuls membres qui ont accepté la lettre d'information, sans transmission de leurs coordonnées à l'organisation ; la publication sur les réseaux sociaux se fait sur les comptes de KolBase ; la mise à la une dure sept jours.",
            "Résultats : l'éditeur s'engage sur la réalisation du service, non sur un nombre d'inscriptions. Un bilan (destinataires, visiteurs, inscriptions obtenues par le lien suivi) est communiqué à titre indicatif.",
            "Facturation : chaque service est facturé une fois réalisé, sur la facture suivante de l'abonnement ou par une facture distincte.",
          ]} />
        </>],
        ["Évolution des prix et des offres", <P key="9">{[
          "L'éditeur peut modifier ses prix et ses offres. Toute hausse applicable à un abonnement en cours est notifiée par e-mail au moins trente jours avant la prochaine échéance concernée ; le client qui la refuse peut résilier avant cette échéance. Les commandes de services déjà passées restent au prix de la commande.",
        ]}</P>],
        ["Obligations de l'éditeur et responsabilité", <P key="10">{[
          "L'éditeur fournit le service avec diligence, selon une obligation de moyens, et s'efforce d'en assurer la disponibilité continue. Il n'est pas partie aux conventions, inscriptions, devis et prestations conclus entre utilisateurs.",
          "La responsabilité de l'éditeur, toutes causes confondues, est limitée aux dommages directs prouvés et plafonnée aux sommes payées par le client au titre des douze mois précédant le fait générateur. Elle ne couvre ni les pertes de chiffre d'affaires, de clientèle ou de données imputables au client, ni les dommages indirects.",
        ]}</P>],
        ["Données personnelles et confidentialité", <P key="11">{[
          <>Les données de facturation du client sont traitées par l&apos;éditeur selon la <Link href="/confidentialite">politique de confidentialité</Link>. Pour les données que le client traite dans KolBase, l&apos;éditeur agit comme sous-traitant selon le <Link href="/sous-traitance">contrat de sous-traitance</Link>, accepté par l&apos;administrateur de l&apos;organisation.</>,
          "Chaque partie garde confidentielles les informations non publiques de l'autre dont elle a connaissance à l'occasion du contrat.",
        ]}</P>],
        ["Droit applicable et litiges", <P key="12">{[
          <>Les présentes conditions sont soumises au droit français. Toute réclamation est adressée à {contact} ; les parties recherchent une solution amiable pendant trente jours. À défaut, le litige est porté devant les {legal("court")}, y compris en cas de pluralité de défendeurs ou d&apos;appel en garantie.</>,
        ]}</P>],
      ]}
    />
  );
}
