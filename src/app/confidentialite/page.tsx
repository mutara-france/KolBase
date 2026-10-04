import { LegalPage } from "@/components/LegalPage";

export const metadata = { title: "Politique de confidentialité — Kolbase" };

export default function Page() {
  return (
    <LegalPage
      title="Politique de confidentialité"
      updated="octobre 2026"
      sections={[
        ["Responsable de traitement", <p key="r">Mutara France, éditeur de Kolbase — [coordonnées et contact du délégué à la protection des données à compléter].</p>],
        ["Données traitées", <ul key="d" className="plain">
          <li>Compte : nom, prénom, e-mail, téléphone, mot de passe (stocké sous forme chiffrée irréversible).</li>
          <li>Profil professionnel : profession, n° RPPS, lieu d&apos;exercice, spécialité, présentation, tarifs indicatifs.</li>
          <li>Activité : inscriptions aux événements, avantages acceptés, sollicitations, candidatures, messages, conventions.</li>
          <li>Journal technique des actions sensibles (traçabilité réglementaire).</li>
        </ul>],
        ["Finalités et bases légales", <ul key="f" className="plain">
          <li>Fourniture du service et gestion des comptes : exécution du contrat (CGU).</li>
          <li>Conventionnement, déclaration et publication des avantages et rémunérations : obligation légale (articles L.1453-1 et suivants du Code de la santé publique), à la charge des organisations.</li>
          <li>Visibilité dans l&apos;annuaire : consentement du praticien, révocable à tout moment depuis « Mon compte ».</li>
        </ul>],
        ["Destinataires", <p key="dest">Les organisations avec lesquelles vous interagissez (inscription, sollicitation, candidature) et, pour les experts référencés, les membres d&apos;organisations consultant l&apos;annuaire. Les données ne sont jamais vendues.</p>],
        ["Durées de conservation", <p key="c">Données de compte : durée d&apos;utilisation du service, puis 3 ans. Conventions et données déclaratives : durée imposée par la réglementation applicable [à préciser avec votre conseil].</p>],
        ["Vos droits", <p key="dr">Accès, rectification, effacement, limitation, opposition et portabilité, à exercer auprès de [contact à compléter]. Vous pouvez introduire une réclamation auprès de la CNIL. Les données publiées sur Transparence Santé relèvent de leur propre régime.</p>],
        ["Hébergement et sécurité", <p key="h">Données hébergées dans l&apos;Union européenne (Francfort), chiffrées en transit. Les mots de passe sont hachés (scrypt) ; les jetons de session et d&apos;invitation ne sont stockés que sous forme hachée.</p>],
      ]}
    />
  );
}
