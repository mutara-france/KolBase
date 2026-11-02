import { LegalPage } from "@/components/LegalPage";
import { legal } from "@/lib/legal";

export const metadata = { title: "Politique de confidentialité — KolBase" };

export default function Page() {
  return (
    <LegalPage
      title="Politique de confidentialité"
      updated="novembre 2026"
      sections={[
        ["Responsable de traitement", <p key="r">{legal("editor")}, éditeur de KolBase, {legal("address")}. Contact pour vos données personnelles : {legal("privacyContact")}.</p>],
        ["Données traitées", <ul key="d" className="plain">
          <li>Compte : nom, prénom, e-mail, téléphone, mot de passe (stocké sous forme chiffrée irréversible).</li>
          <li>Profil professionnel : profession, pays d&apos;exercice, n° RPPS ou identifiant professionnel étranger (INAMI, NPI…), lieu d&apos;exercice, spécialité, présentation, tarifs indicatifs.</li>
          <li>Activité : inscriptions aux événements, avantages acceptés, sollicitations, candidatures, messages, conventions (et, en cas de signature électronique, le dossier de preuve établi par le prestataire de signature).</li>
          <li>Journal technique des actions sensibles (traçabilité réglementaire).</li>
        </ul>],
        ["Finalités et bases légales", <ul key="f" className="plain">
          <li>Fourniture du service et gestion des comptes : exécution du contrat (CGU).</li>
          <li>Conventionnement, déclaration et publication des avantages et rémunérations : obligation légale (articles L.1453-1 et suivants du Code de la santé publique), à la charge des organisations.</li>
          <li>Visibilité dans l&apos;annuaire : consentement du praticien, révocable à tout moment depuis « Mon compte ».</li>
        </ul>],
        ["Destinataires", <p key="dest">Les organisations avec lesquelles vous interagissez (inscription, sollicitation, candidature) et, pour les experts référencés, les membres d&apos;organisations consultant l&apos;annuaire. Les données ne sont jamais vendues.</p>],
        ["Durées de conservation", <p key="c">Données de compte : durée d&apos;utilisation du service, puis 3 ans. Conventions et données déclaratives : durée imposée par la réglementation applicable [à préciser avec votre conseil].</p>],
        ["Vos droits", <p key="dr">Accès, rectification, effacement, limitation, opposition et portabilité. Depuis « Mon compte », vous pouvez télécharger vos données (format JSON), modifier votre profil et votre visibilité, couper les notifications par e-mail et supprimer votre compte. La suppression efface vos données personnelles ; seuls les éléments liés aux conventions et aux hospitalités déclarées (nom, profession, RPPS, ville, structure de facturation) sont conservés pour les obligations des organisations. Pour toute autre demande : {legal("privacyContact")}. Vous pouvez introduire une réclamation auprès de la CNIL. Les données publiées sur Transparence Santé relèvent de leur propre régime.</p>],
        ["Hébergement et sécurité", <p key="h">Données hébergées dans l&apos;Union européenne (Francfort), chiffrées en transit. Les mots de passe sont hachés (scrypt) ; les jetons de session, d&apos;invitation et les liens envoyés par e-mail ne sont stockés que sous forme hachée. Les polices de caractères sont servies par KolBase : aucune donnée de navigation n&apos;est transmise à un service tiers pour l&apos;affichage des pages.</p>],
        ["Services tiers", <p key="t">Répertoire public des entreprises (contrôle du SIREN des organisations), ORCID (si vous connectez votre compte ORCID), prestataire d&apos;envoi d&apos;e-mails ({legal("emailProvider")}), hébergeur des documents déposés dans les dossiers ({legal("storageProvider")}), prestataire de signature électronique ({legal("signatureProvider")}) lorsqu&apos;une organisation envoie une convention à signer électroniquement : il reçoit la convention ainsi que le nom, le prénom et l&apos;adresse e-mail des signataires, leur écrit pour recueillir la signature et conserve le dossier de preuve. Le numéro RPPS est contrôlé sur l&apos;Annuaire Santé public.</p>],
      ]}
    />
  );
}
