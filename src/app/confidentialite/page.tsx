import Link from "next/link";
import { LegalPage, L, P, T } from "@/components/LegalPage";
import { LEGAL, legal } from "@/lib/legal";

export const metadata = { title: "Politique de confidentialité — KolBase", alternates: { canonical: "/confidentialite" } };

/** Politique de confidentialité (articles 12 à 14 du RGPD) : traitements dont l'éditeur est responsable. */
export default function Page() {
  const contact = <a href={`mailto:${LEGAL.privacyContact}`}>{legal("privacyContact")}</a>;
  return (
    <LegalPage
      path="/confidentialite"
      title="Politique de confidentialité"
      updated="3 novembre 2026"
      intro={<P>{["Cette politique explique quelles données personnelles KolBase traite, pourquoi, combien de temps, avec qui elles sont partagées et comment exercer vos droits. Elle s'applique aux praticiens, aux membres des organisations et des prestataires, aux visiteurs du site et aux destinataires de la lettre d'information."]}</P>}
      sections={[
        ["Responsable de traitement", <P key="1">{[
          <>{legal("editor")}, {legal("legalForm")}, {legal("address")}, {legal("registration")}, éditeur de KolBase, est responsable des traitements décrits ci-dessous. Contact pour vos données personnelles : {contact}.</>,
          <>Pour les données qu&apos;une organisation traite dans KolBase pour ses propres besoins (sollicitations, conventions, inscriptions à ses événements, déclarations), c&apos;est elle qui est responsable de traitement et l&apos;éditeur agit pour son compte comme sous-traitant (<Link href="/sous-traitance">contrat de sous-traitance</Link>). Vos demandes sur ces données peuvent être adressées à l&apos;organisation ou à l&apos;éditeur, qui les lui transmet.</>,
        ]}</P>],
        ["Données traitées", <L key="2" items={[
          "Compte : nom, prénom, adresse e-mail, téléphone (facultatif), langue, mot de passe (stocké sous forme irréversible), réglages de notifications, et, si elle est activée, la clé de double authentification et les codes de secours (hachés).",
          "Profil professionnel : profession, pays d'exercice, numéro RPPS ou identifiant professionnel étranger, lieu d'exercice, spécialité, présentation, photo (facultative, recadrée et débarrassée de ses métadonnées : lieu de prise de vue, appareil, date), publications, structures juridiques et coordonnées de facturation des experts, tarifs indicatifs, réglages de visibilité.",
          "Activité : inscriptions et présence aux événements, avantages acceptés, sollicitations, candidatures, projets proposés aux organisations, messages, conventions, honoraires et notes d'honoraires, documents déposés, avis laissés aux prestataires.",
          "Organisations et prestataires : rôle dans l'organisation, coordonnées professionnelles, données de facturation et d'abonnement (le moyen de paiement reste chez le prestataire de paiement).",
          "Données techniques : journal des actions sensibles (connexions, validations, décisions, exports), adresse IP utilisée pour limiter les tentatives de connexion, cookies décrits plus bas.",
          "Aucune donnée de santé de patients n'est traitée ; il est interdit d'en déposer.",
        ]} />],
        ["Finalités, bases légales et durées de conservation", <T key="3" head={["Finalité", "Base légale", "Conservation"]} rows={[
          ["Créer et gérer votre compte, vous authentifier, sécuriser le service", "Exécution du contrat (conditions d'utilisation)", "Tant que le compte existe ; effacement à la suppression du compte"],
          ["Vérifier l'identité professionnelle des experts et la réalité des organisations (RPPS, SIREN)", "Intérêt légitime (fiabilité de l'annuaire)", "Tant que le compte ou l'organisation existe"],
          ["Afficher votre fiche dans l'annuaire et sur les pages publiques", "Consentement, retirable à tout moment dans « Mon compte »", "Jusqu'au retrait du référencement"],
          ["Mettre en relation, gérer les dossiers, événements, devis et messages", "Exécution du contrat", "Tant que le compte existe ; ce qui relève d'une organisation suit le contrat de sous-traitance"],
          ["Conventions, avantages, hospitalités et déclarations Transparence Santé (pour le compte des organisations)", "Obligation légale des organisations (articles L.1453-1 et suivants du Code de la santé publique)", "Durée des obligations déclaratives des organisations ; les éléments déclarés sont conservés même après suppression du compte"],
          ["Notifications par e-mail liées à votre activité", "Intérêt légitime ; désactivables dans « Mon compte »", "Le temps de l'envoi"],
          ["Utiliser la photo d'un expert pour annoncer ses interventions (programme, affiches, réseaux sociaux, e-mailing), par les organisations avec qui il collabore et par KolBase", "Consentement (case à cocher, retirable à tout moment dans « Mon compte »)", "Jusqu'au retrait de l'accord ou de la photo"],
          ["Lettre d'information de KolBase", "Consentement (case à cocher, retirable en un clic)", "Jusqu'à la désinscription"],
          ["Mesure des services de communication (visites et inscriptions obtenues par un lien suivi)", "Intérêt légitime ; statistiques agrégées, sans nom", "13 mois"],
          ["Facturation des abonnements et des services", "Obligation légale (Code de commerce)", "10 ans pour les factures et pièces comptables"],
          ["Journal des actions sensibles et sécurité (prévention des fraudes, limitation des tentatives)", "Intérêt légitime et obligation légale (traçabilité des conventions)", "Durée du compte, puis 5 ans ; sessions et liens de connexion expirés supprimés sous 30 jours"],
          ["Assistant de rédaction (intelligence artificielle), à votre demande", "Intérêt légitime (aide à la rédaction)", "Non conservé par KolBase au-delà du brouillon proposé"],
          ["Prospection commerciale auprès des organisations et des prestataires", "Intérêt légitime (prospection entre professionnels, avec possibilité de refus à chaque message)", "3 ans après le dernier contact"],
        ]} />],
        ["Destinataires", <P key="4">{[
          "Selon vos réglages de visibilité et votre activité : les organisations avec lesquelles vous interagissez (inscription, sollicitation, candidature, devis), les membres d'organisations validées qui consultent l'annuaire, et le public pour les éléments que vous rendez publics. Une attestation de présence porte un code de vérification : toute personne qui la détient peut en vérifier l'authenticité (nom, événement, date).",
          "L'équipe KolBase, dans la limite de ses missions (validation, assistance, réalisation des services). Les données ne sont jamais vendues ni louées.",
        ]}</P>],
        ["Sous-traitants et transferts hors de l'Union européenne", <>
          <L items={[
            `Hébergement de l'application et de la base de données : ${legal("host")} ; serveurs situés à ${legal("hostRegion")}.`,
            // Hébergeur des documents pas encore choisi : ligne omise (alerte dans l'onglet Lancement de /admin).
            ...(LEGAL.storageProvider ? [`Documents déposés dans les dossiers : ${LEGAL.storageProvider}.`] : []),
            `Envoi des e-mails : ${legal("emailProvider")}.`,
            `Paiement des abonnements et des services : ${legal("paymentProvider")} (données de facturation des organisations et des prestataires).`,
            `Signature électronique des conventions, lorsqu'une organisation l'utilise : ${legal("signatureProvider")}, qui reçoit la convention, les nom, prénom et adresse e-mail des signataires et conserve le dossier de preuve.`,
            `Assistant de rédaction, lorsqu'un utilisateur le sollicite : ${legal("aiProvider")}. Il reçoit les éléments du texte demandé (titre, dates, lieu, besoin ; pour une suggestion d'experts ou une relecture, le nom, la spécialité, les collaborations et les honoraires des profils concernés), jamais d'adresse e-mail ni de donnée de santé.`,
            "Services publics consultés : répertoire des entreprises (contrôle du SIREN), Annuaire Santé (contrôle du RPPS), ORCID si vous connectez votre compte.",
          ]} />
          <P>{["L'hébergeur et le fournisseur de l'assistant de rédaction sont des sociétés établies aux États-Unis ; le prestataire de paiement peut aussi y transférer des données. Ces transferts sont encadrés par les clauses contractuelles types de la Commission européenne ou par la décision d'adéquation du cadre de protection des données UE–États-Unis, selon le prestataire."]}</P>
        </>],
        ["Cookies", <>
          <P>{["KolBase n'utilise ni cookie publicitaire ni outil de mesure d'audience tiers. Les cookies suivants sont strictement nécessaires au service ou exemptés de consentement :"]}</P>
          <T head={["Cookie", "Rôle", "Durée"]} rows={[
            ["kb_session", "Maintenir votre connexion", "30 jours"],
            ["kb_2fa", "Étape de vérification en deux étapes, entre le mot de passe et le code", "10 minutes"],
            ["kb_lang", "Langue choisie (français ou anglais)", "1 an"],
            ["kb_espace", "Dernier espace utilisé (praticien ou organisation)", "1 an"],
            ["kb_src", "Compter l'inscription qui suit un lien de communication diffusée par KolBase (mesure des services, totaux seulement)", "30 jours"],
          ]} />
          <P>{["Les polices de caractères sont servies par KolBase : aucune donnée de navigation n'est transmise à un tiers pour l'affichage des pages. Les visites des liens suivis sont comptées à l'aide d'une empreinte non réversible, sans conserver l'adresse IP."]}</P>
        </>],
        ["Sécurité", <P key="7">{[
          "Les données sont chiffrées en transit. Les mots de passe sont hachés (scrypt) ; les jetons de session, d'invitation, de désinscription et les liens envoyés par e-mail ne sont stockés que sous forme hachée ou aléatoire. Chaque compte peut activer la double authentification, obligatoire pour l'équipe KolBase et exigible par une organisation. Les accès sont limités selon les rôles et les actions sensibles sont journalisées.",
          "En cas de violation de données présentant un risque pour vos droits, l'éditeur la notifie à la CNIL et, si nécessaire, aux personnes concernées.",
        ]}</P>],
        ["Vos droits", <P key="8">{[
          "Vous disposez des droits d'accès, de rectification, d'effacement, de limitation, d'opposition et de portabilité, ainsi que du droit de retirer votre consentement à tout moment et de définir des directives sur le sort de vos données après votre décès.",
          "Depuis « Mon compte », vous pouvez télécharger vos données (format JSON), modifier votre profil et votre visibilité, couper les notifications, vous désinscrire de la lettre d'information et supprimer votre compte. La suppression efface vos données personnelles ; seuls les éléments liés aux conventions et aux hospitalités déclarées (nom, profession, RPPS, ville, structure de facturation) sont conservés pour les obligations des organisations.",
          <>Pour toute autre demande, écrivez à {contact} ; une réponse vous est apportée sous un mois. Vous pouvez introduire une réclamation auprès de la CNIL (cnil.fr). Les données publiées sur la base Transparence Santé relèvent de leur propre régime.</>,
        ]}</P>],
        ["Modification de la politique", <P key="9">{[
          "Cette politique peut évoluer avec le service ou la réglementation. Toute modification importante est annoncée par e-mail ou à la connexion ; la date de mise à jour figure en haut de la page.",
        ]}</P>],
      ]}
    />
  );
}
