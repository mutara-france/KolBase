import { LegalPage } from "@/components/LegalPage";
import { legal } from "@/lib/legal";
import { DPA_UPDATED, DPA_VERSION } from "@/lib/dpa";

export const metadata = { title: "Contrat de sous-traitance (RGPD) — KolBase" };

/**
 * Accord de traitement des données (article 28 du RGPD) entre chaque organisation cliente (responsable de traitement
 * pour ses propres finalités : conventionnement, événements, déclarations) et l'éditeur de KolBase (sous-traitant).
 * Accepté au nom de l'organisation par un administrateur, dans « Membres et réglages › Organisation ».
 */
export default function Page() {
  return (
    <LegalPage
      title="Contrat de sous-traitance (RGPD)"
      updated={`${DPA_UPDATED} — version ${DPA_VERSION}`}
      sections={[
        ["Parties et objet", <p key="p">Le présent contrat est conclu entre l&apos;organisation cliente qui l&apos;accepte depuis son espace KolBase (le « responsable de traitement ») et {legal("editor")}, {legal("legalForm")}, {legal("address")}, {legal("registration")}, éditeur de KolBase (le « sous-traitant »). Il encadre, conformément à l&apos;article 28 du règlement (UE) 2016/679 (RGPD), les traitements de données personnelles que le sous-traitant effectue pour le compte de l&apos;organisation lorsqu&apos;elle utilise KolBase. Il complète les conditions générales d&apos;utilisation ; en cas de contradiction sur la protection des données, il prévaut.</p>],
        ["Traitements confiés", <ul key="t" className="plain">
          <li>Finalités : sollicitation et conventionnement d&apos;experts, gestion des dossiers de collaboration et de leur validation, organisation d&apos;événements (inscriptions, hospitalités, pointage, attestations, questionnaires), suivi des prestataires, préparation des déclarations et autorisations au titre des articles L.1453-1 et suivants du Code de la santé publique, statistiques internes.</li>
          <li>Personnes concernées : professionnels de santé et étudiants sollicités ou inscrits, membres de l&apos;organisation, interlocuteurs des prestataires.</li>
          <li>Données : identité, coordonnées professionnelles, profession, identifiant professionnel (RPPS ou étranger), spécialité, lieu d&apos;exercice, montants des conventions, rémunérations et avantages, présence aux événements, échanges et documents des dossiers, coordonnées de facturation des experts. Aucune donnée de santé de patients n&apos;est traitée.</li>
          <li>Durée : celle de l&apos;utilisation de KolBase par l&apos;organisation, puis les durées de conservation ci-dessous.</li>
        </ul>],
        ["Obligations du sous-traitant", <ul key="o" className="plain">
          <li>Ne traiter les données que sur instruction documentée de l&apos;organisation : ces instructions résultent du paramétrage et de l&apos;usage de KolBase par ses membres. Il informe l&apos;organisation si une instruction lui paraît contraire à la réglementation.</li>
          <li>Garantir la confidentialité : les personnes autorisées à traiter les données sont soumises à une obligation de confidentialité.</li>
          <li>Mettre en œuvre les mesures de sécurité décrites ci-dessous et les maintenir à un niveau adapté au risque.</li>
          <li>Aider l&apos;organisation à répondre aux demandes d&apos;exercice des droits (accès, rectification, effacement, limitation, opposition, portabilité), notamment par les exports et suppressions disponibles dans KolBase, et à réaliser, le cas échéant, une analyse d&apos;impact.</li>
          <li>Notifier à l&apos;organisation toute violation de données personnelles dans les meilleurs délais et au plus tard 48 heures après en avoir pris connaissance, avec les informations utiles à sa propre notification à la CNIL.</li>
          <li>Tenir un registre des traitements effectués pour le compte de l&apos;organisation et mettre à sa disposition les informations nécessaires pour démontrer le respect de ses obligations ; permettre des audits, sur demande écrite raisonnable et à la charge de l&apos;organisation, au plus une fois par an sauf violation avérée.</li>
          <li>Au terme du contrat, supprimer les données de l&apos;organisation ou les lui restituer (exports disponibles dans KolBase), sauf obligation légale de conservation.</li>
        </ul>],
        ["Sous-traitants ultérieurs", <p key="s">L&apos;organisation autorise le recours aux sous-traitants ultérieurs suivants : hébergement de l&apos;application et de la base de données (Render, région Francfort, Union européenne) ; envoi des e-mails ({legal("emailProvider")}) ; stockage des documents ({legal("storageProvider")}) ; signature électronique ({legal("signatureProvider")}), lorsque l&apos;organisation l&apos;utilise ; assistant d&apos;IA ({legal("aiProvider")}), seulement lorsqu&apos;un membre le sollicite. Le sous-traitant impose à chacun des obligations de protection équivalentes et informe l&apos;organisation de tout changement envisagé, qui peut s&apos;y opposer pour un motif légitime. Pour l&apos;assistant d&apos;IA, situé aux États-Unis, le transfert est encadré par les garanties prévues au chapitre V du RGPD [mécanisme à préciser avec votre conseil].</p>],
        ["Mesures de sécurité", <ul key="m" className="plain">
          <li>Hébergement dans l&apos;Union européenne, chiffrement des échanges (HTTPS), base de données accessible uniquement depuis le réseau privé de l&apos;hébergeur.</li>
          <li>Mots de passe hachés (scrypt) ; jetons de session et liens envoyés par e-mail stockés sous forme hachée ; limitation des tentatives de connexion.</li>
          <li>Cloisonnement par organisation et par rôle (administrateur, projets, conformité, agence mandatée), double validation des dossiers, journal des actions sensibles.</li>
          <li>Documents servis par liens temporaires, sur un stockage privé ; en-têtes de sécurité (cadres interdits, politique de contenu).</li>
          <li>Sauvegardes de la base par l&apos;hébergeur ; alertes en cas d&apos;erreur applicative.</li>
        </ul>],
        ["Durées de conservation", <ul key="c" className="plain">
          <li>Données de compte : durée d&apos;utilisation du service, puis 3 ans.</li>
          <li>Conventions, rémunérations, avantages et pièces justificatives : durée imposée par la réglementation applicable à l&apos;organisation [à préciser avec votre conseil].</li>
          <li>Sessions et liens de connexion expirés : supprimés automatiquement sous 30 jours.</li>
          <li>Journal des actions sensibles : durée de la relation, pour la traçabilité réglementaire.</li>
        </ul>],
        ["Obligations de l'organisation", <p key="r">L&apos;organisation, responsable de traitement, détermine les finalités et s&apos;assure de leur base légale (obligations légales de transparence et d&apos;encadrement des avantages, exécution des conventions, intérêt légitime pour les statistiques internes), informe les personnes concernées, et veille à ce que ses membres n&apos;utilisent KolBase que pour ces finalités. Contact du sous-traitant pour les données personnelles : {legal("privacyContact")}.</p>],
      ]}
    />
  );
}
