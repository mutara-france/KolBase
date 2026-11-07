import Link from "next/link";
import { LegalPage, L, P } from "@/components/LegalPage";
import { LEGAL, legal } from "@/lib/legal";

export const metadata = { title: "Conditions générales d'utilisation — KolBase", alternates: { canonical: "/cgu" } };

/** Conditions générales d'utilisation de KolBase (tous les utilisateurs). Les offres payantes relèvent des conditions de vente. */
export default function Page() {
  const contact = <a href={`mailto:${LEGAL.contactEmail}`}>{legal("contactEmail")}</a>;
  return (
    <LegalPage
      path="/cgu"
      title="Conditions générales d'utilisation"
      updated="6 novembre 2026"
      intro={<P>{[`Les présentes conditions régissent l'utilisation de KolBase, service édité par ${legal("editor")} (« l'éditeur »). Elles s'appliquent à toute personne qui crée un compte, quel que soit son profil. Les offres payantes sont régies en outre par les conditions générales de vente.`]}</P>}
      sections={[
        ["Objet et acceptation", <P key="1">{[
          "KolBase met en relation des professionnels de santé du secteur dentaire et des organisations (industriels, sociétés savantes, associations, organismes de formation) ainsi que leurs prestataires, et fournit les outils de gestion de leurs collaborations : annuaire, dossiers, conventions, événements, conformité et déclarations.",
          "La création d'un compte vaut acceptation des présentes conditions, cochée lors de l'inscription. KolBase s'adresse exclusivement à des professionnels agissant dans le cadre de leur activité.",
        ]}</P>],
        ["Définitions", <L key="2" items={[
          "Utilisateur : toute personne titulaire d'un compte.",
          "Praticien : utilisateur professionnel de santé ou étudiant du secteur dentaire ; il peut s'inscrire aux événements et, s'il le souhaite, se référencer comme expert.",
          "Expert référencé : praticien qui a choisi d'apparaître dans l'annuaire pour être sollicité, après contrôle de son identifiant professionnel.",
          "Organisation : personne morale cliente (industriel, société savante, association, organisme de formation) représentée par ses membres, qui y occupent un ou plusieurs rôles (administrateur, projets, conformité).",
          "Prestataire : entreprise référencée pour répondre aux demandes de devis des organisations (traiteur, lieu, hébergement, captation, transport…) ; une agence peut en outre recevoir un mandat pour gérer des événements.",
          "Collaboration : relation entre une organisation et un ou plusieurs experts (intervention, formation, conseil, comité…), formalisée dans un dossier.",
        ]} />],
        ["Comptes et sécurité", <P key="3">{[
          "Chaque compte est personnel et nominatif. L'utilisateur fournit des informations exactes et à jour, notamment son identité, son adresse e-mail professionnelle, sa profession, son pays d'exercice et, pour un praticien, son identifiant professionnel (RPPS en France, ou l'identifiant du pays d'exercice). Il confirme son adresse e-mail par le lien reçu.",
          "L'utilisateur choisit un mot de passe robuste, le garde confidentiel et signale sans délai toute utilisation non autorisée de son compte. Il peut activer la double authentification depuis « Mon compte » ; elle est obligatoire pour les administrateurs de la plateforme et peut être exigée par une organisation de tous ses membres.",
          "Un utilisateur peut appartenir à plusieurs organisations et disposer aussi d'un espace praticien : il agit dans chaque espace au nom de la personne concernée et dans la limite de ses rôles.",
        ]}</P>],
        ["Praticiens et experts référencés", <P key="4">{[
          "L'inscription aux événements et l'usage de l'espace praticien sont gratuits.",
          "Le référencement comme expert est volontaire, gratuit et révocable à tout moment. Il est réservé aux chirurgiens-dentistes, orthodontistes, chirurgiens oraux et stomatologues. L'éditeur contrôle l'identifiant professionnel sur le registre public du pays d'exercice avant d'afficher la mention « Identité vérifiée » ; il peut refuser ou retirer un référencement en cas d'informations inexactes.",
          "L'expert choisit ce que voient le public, les organisations et les membres de KolBase (coordonnées, activité, collaborations). Sa fiche présente une information professionnelle factuelle et ne constitue pas une publicité ; il veille au respect du code de déontologie des chirurgiens-dentistes.",
          "L'expert s'engage à n'accepter aucun avantage en dehors du cadre prévu par les articles L.1453-5 et suivants du Code de la santé publique, à déclarer ses liens d'intérêts lorsque la loi l'exige et à signaler toute situation de conflit d'intérêts à l'organisation qui le sollicite.",
        ]}</P>],
        ["Organisations", <P key="5">{[
          "La personne qui crée une organisation déclare être habilitée à la représenter. Une organisation ne peut solliciter des praticiens, publier une opportunité ou un événement, ni apparaître sur les pages publiques qu'après validation par l'éditeur, qui contrôle notamment son numéro SIREN au répertoire des entreprises. Un changement de nom ou de SIREN relance la validation.",
          "Les administrateurs de l'organisation invitent les membres, attribuent les rôles, acceptent le contrat de sous-traitance et gèrent l'abonnement. L'organisation répond des actions accomplies par ses membres et par les agences qu'elle mandate, dans la limite des événements qu'elle leur confie.",
          "L'organisation qui publie un nom ou un logo garantit en être titulaire ou être autorisée à l'utiliser ; l'éditeur peut retirer un signe litigieux.",
          <>Pour les données personnelles qu&apos;elle traite dans KolBase (experts, inscrits, conventions), l&apos;organisation est responsable de traitement et l&apos;éditeur agit comme sous-traitant selon le <Link href="/sous-traitance">contrat de sous-traitance</Link>.</>,
        ]}</P>],
        ["Prestataires et agences", <P key="6">{[
          "Le référencement d'un prestataire, sa page et la réception de demandes de devis sont gratuits. Le prestataire décrit fidèlement ses prestations, ses tarifs et ses références ; les avis affichés proviennent uniquement d'organisations l'ayant effectivement retenu.",
          "Les devis sont établis sous la seule responsabilité du prestataire, qui contracte directement avec l'organisation. L'éditeur n'intervient ni dans leur négociation ni dans leur exécution.",
          "Une agence mandatée accède aux seuls événements que l'organisation lui confie, pendant la durée du mandat, et y agit au nom de cette organisation.",
        ]}</P>],
        ["Collaborations et obligations réglementaires", <P key="7">{[
          "Les sollicitations, réponses, décisions, conventions, honoraires et documents d'une collaboration sont échangés dans le dossier correspondant. Les conventions sont conclues directement entre l'organisation et l'expert : l'éditeur n'y est jamais partie.",
          "L'organisation reste seule responsable du respect de ses obligations : juste contrepartie des prestations, encadrement des avantages et des hospitalités, déclaration ou demande d'autorisation des conventions auprès de l'ordre professionnel compétent (articles L.1453-8 à L.1453-11 du Code de la santé publique) et publication sur la base Transparence Santé (article L.1453-1).",
          "Les outils de KolBase (contrôle de juste contrepartie, seuils, modèles de convention, relecture assistée, fichiers de déclaration) sont des aides à la conformité : ils ne valent pas conseil juridique et ne dispensent pas l'organisation de vérifier leur résultat.",
        ]}</P>],
        ["Événements", <P key="8">{[
          "L'organisation publie ses événements dans l'agenda sous sa responsabilité : programme, lieu, capacité, avantages et hospitalités proposés. Les inscriptions sont nominatives ; le praticien qui accepte un avantage confirme avoir pris connaissance de l'information qui l'accompagne.",
          "Le pointage à l'accueil, la feuille d'émargement, les attestations de présence et le questionnaire de satisfaction sont établis à partir des données saisies par l'organisation et ses membres. Une attestation porte un code qui permet à toute personne qui la détient d'en vérifier l'authenticité.",
          "Un praticien peut annuler son inscription en ligne jusqu'au début de l'événement, sauf si l'inscription a déjà été déclarée ; il prévient alors l'organisateur.",
        ]}</P>],
        ["Signature électronique", <P key="9">{[
          `Une organisation peut faire signer une convention électroniquement par l'intermédiaire de ${legal("signatureProvider")}, au moyen d'une signature électronique simple au sens du règlement (UE) n° 910/2014 dit « eIDAS », avec un code de vérification envoyé par e-mail. Le prestataire écrit à chaque signataire à l'adresse de son compte et conserve le dossier de preuve ; la convention signée est ensuite disponible dans le dossier.`,
          "Chaque signataire peut refuser la signature électronique ; la convention se signe alors sur papier.",
        ]}</P>],
        ["E-mails, lettre d'information et services de communication", <P key="10">{[
          "L'éditeur envoie des e-mails de service (confirmation d'adresse, mot de passe, sécurité, invitations, facturation) et, sauf désactivation dans « Mon compte », des notifications liées à l'activité de l'utilisateur.",
          "La lettre d'information n'est envoyée qu'aux membres qui l'ont acceptée ; chaque envoi comporte un lien de désinscription en un clic. Elle peut présenter des événements d'organisations partenaires : toute communication réalisée pour le compte d'une organisation mentionne son nom.",
          "Les services de communication commandés par les organisations (e-mailing, publication sur les réseaux sociaux de KolBase, mise à la une) sont décrits dans les conditions générales de vente.",
        ]}</P>],
        ["Assistant de rédaction (intelligence artificielle)", <P key="11">{[
          `Certaines fonctions proposent un brouillon rédigé par un modèle d'intelligence artificielle (${legal("aiProvider")}) : description, programme, message, suggestion d'experts, relecture d'un dossier. L'assistant n'agit que lorsqu'un utilisateur le sollicite et ne reçoit que les éléments nécessaires au texte demandé, jamais d'adresse e-mail ni de donnée de santé.`,
          "Le résultat est une proposition : l'utilisateur la relit, la corrige et reste responsable de ce qu'il publie, envoie ou décide.",
        ]}</P>],
        ["Contenus et comportements interdits", <>
          <P>{["L'utilisateur s'interdit notamment :"]}</P>
          <L items={[
            "de publier un contenu illicite, trompeur, diffamatoire, ou contraire à la déontologie des professions de santé ;",
            "de diffuser une publicité pour des produits de santé non conforme à la réglementation, ou de présenter un avantage en dehors du cadre légal ;",
            "de déposer des données de santé de patients ou des documents qu'il n'a pas le droit de partager ;",
            "d'usurper l'identité d'une personne ou d'une organisation, ou de créer un compte pour autrui sans mandat ;",
            "d'extraire en masse les données de l'annuaire, de contourner les réglages de visibilité ou les mesures de sécurité, ou de perturber le service ;",
            "d'utiliser les coordonnées obtenues sur KolBase à d'autres fins que la collaboration pour laquelle elles ont été communiquées.",
          ]} />
          <P>{[
            "L'utilisateur concède à l'éditeur, pour la durée de son compte, le droit non exclusif d'héberger, reproduire et afficher les contenus qu'il publie, dans la seule mesure nécessaire au service et selon ses réglages de visibilité.",
            <>Tout contenu peut être signalé à {contact}. L&apos;éditeur examine les signalements, peut retirer un contenu, restreindre ou suspendre un compte, et informe l&apos;utilisateur concerné de sa décision motivée ; celui-ci peut la contester à la même adresse.</>,
          ]}</P>
        </>],
        ["Disponibilité et évolution du service", <P key="13">{[
          "L'éditeur s'efforce d'assurer l'accès au service en continu, sans garantie d'une disponibilité absolue. Il peut l'interrompre pour maintenance, en prévenant les utilisateurs lorsque c'est possible, et faire évoluer ses fonctions.",
          "L'utilisateur peut à tout moment télécharger les données de son compte (format JSON) ; une organisation peut exporter ses registres et ses fichiers de déclaration.",
        ]}</P>],
        ["Responsabilité", <P key="14">{[
          "L'éditeur fournit un service de mise en relation et de gestion. Il n'est pas partie aux conventions, inscriptions, devis et prestations conclus entre utilisateurs et ne répond pas de leur exécution, ni de l'exactitude des informations que les utilisateurs publient.",
          "L'éditeur est tenu d'une obligation de moyens. Sa responsabilité ne peut être engagée que pour une faute prouvée et pour les seuls dommages directs ; pour les offres payantes, elle est limitée dans les conditions des conditions générales de vente.",
        ]}</P>],
        ["Suspension et suppression du compte", <P key="15">{[
          "L'éditeur peut suspendre un compte ou une organisation en cas de manquement aux présentes conditions, d'informations inexactes ou de risque pour la sécurité du service, après avoir invité l'utilisateur à s'expliquer sauf urgence.",
          "L'utilisateur peut supprimer son compte à tout moment depuis « Mon compte ». Ses données personnelles sont alors effacées ; seuls les éléments liés aux conventions et aux hospitalités déclarées sont conservés pour les obligations des organisations, comme le décrit la politique de confidentialité.",
        ]}</P>],
        ["Données personnelles", <P key="16">{[
          <>Les traitements réalisés par l&apos;éditeur, les durées de conservation et les droits des personnes sont décrits dans la <Link href="/confidentialite">politique de confidentialité</Link>.</>,
        ]}</P>],
        ["Modification des conditions", <P key="17">{[
          "L'éditeur peut faire évoluer les présentes conditions, notamment pour suivre la réglementation ou les fonctions du service. Toute modification substantielle est annoncée par e-mail ou à la connexion au moins trente jours avant son entrée en vigueur ; l'utilisateur qui la refuse peut supprimer son compte. La poursuite de l'utilisation après cette date vaut acceptation.",
        ]}</P>],
        ["Droit applicable et litiges", <P key="18">{[
          `Les présentes conditions sont soumises au droit français. En cas de différend, les parties recherchent d'abord une solution amiable en écrivant à ${legal("contactEmail")}. À défaut, compétence est attribuée aux ${legal("court")}.`,
        ]}</P>],
      ]}
    />
  );
}
