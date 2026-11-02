import { LegalPage } from "@/components/LegalPage";
import { legal } from "@/lib/legal";

export const metadata = { title: "Conditions d'utilisation — KolBase" };

export default function Page() {
  return (
    <LegalPage
      title="Conditions générales d'utilisation"
      updated="novembre 2026"
      sections={[
        ["Objet", <p key="o">Les présentes conditions encadrent l&apos;utilisation de KolBase par les professionnels de santé et les organisations du secteur dentaire.</p>],
        ["Comptes", <p key="c">Chaque compte est personnel. L&apos;utilisateur garantit l&apos;exactitude des informations fournies, notamment sa profession, son pays d&apos;exercice et son identifiant professionnel (RPPS en France, numéro INAMI, NPI ou inscription à l&apos;Ordre ailleurs), et préserve la confidentialité de ses identifiants.</p>],
        ["Praticiens référencés", <p key="p">Le référencement comme expert est volontaire et révocable. Il est réservé aux chirurgiens-dentistes, orthodontistes, chirurgiens oraux et stomatologues, et suppose un identifiant professionnel (RPPS pour un exercice en France, identifiant du pays d&apos;exercice sinon), que KolBase contrôle avant d&apos;afficher la mention « Identité vérifiée ». Le praticien s&apos;engage à déclarer ses liens d&apos;intérêts et à ne pas accepter d&apos;avantage en dehors du cadre conventionnel.</p>],
        ["Validation des organisations", <p key="v">Une organisation ne peut solliciter de praticiens, publier ou apparaître sur le site public qu&apos;après validation par KolBase, qui contrôle notamment son numéro SIREN. KolBase peut refuser ou suspendre une organisation, en particulier en cas d&apos;informations inexactes ou d&apos;usurpation d&apos;identité ; un changement de nom ou de SIREN relance la validation. L&apos;organisation qui publie un nom ou un logo garantit être titulaire des droits sur ces signes ou autorisée à les utiliser ; KolBase peut retirer un logo ou un nom litigieux.</p>],
        ["Organisations", <p key="org">Les organisations restent seules responsables du respect de leurs obligations réglementaires : conventionnement, déclaration ou autorisation ordinale, publication sur Transparence Santé, juste contrepartie. Les outils de KolBase (contrôle de juste contrepartie, modèles de convention, exports) sont des aides et ne valent pas conseil juridique.</p>],
        ["Contenus, messages et documents", <p key="m">Les utilisateurs s&apos;interdisent tout contenu illicite, promotionnel non conforme ou contraire à la déontologie, et ne déposent dans les dossiers que des documents qu&apos;ils sont en droit de partager. KolBase peut suspendre un compte en cas de manquement.</p>],
        ["Signature électronique", <p key="se">Une organisation peut faire signer une convention électroniquement par l&apos;intermédiaire de {legal("signatureProvider")} (signature électronique simple au sens du règlement (UE) n° 910/2014 dit « eIDAS », avec un code de vérification envoyé par e-mail). Le prestataire écrit à chaque signataire à l&apos;adresse de son compte ; la convention signée est ensuite disponible dans le dossier. Chaque signataire peut refuser la signature électronique ; la convention se signe alors sur papier.</p>],
        ["E-mails", <p key="e">KolBase envoie des e-mails de service (confirmation d&apos;adresse, mot de passe, invitations) et, sauf désactivation dans « Mon compte », des notifications liées à l&apos;activité de l&apos;utilisateur.</p>],
        ["Suppression du compte", <p key="s">L&apos;utilisateur peut supprimer son compte à tout moment depuis « Mon compte ». Les éléments liés aux conventions et aux hospitalités déclarées sont conservés pour les obligations des organisations, comme décrit dans la politique de confidentialité.</p>],
        ["Responsabilité", <p key="r">KolBase fournit un service de mise en relation et de gestion. Il n&apos;est pas partie aux conventions conclues entre utilisateurs.</p>],
        ["Droit applicable", <p key="d">Droit français. Juridiction compétente : {legal("court")}. [Modalités de modification des CGU à compléter.]</p>],
      ]}
    />
  );
}
