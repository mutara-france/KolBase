import { LegalPage } from "@/components/LegalPage";

export const metadata = { title: "Mentions légales — Kolbase" };

export default function Page() {
  return (
    <LegalPage
      title="Mentions légales"
      updated="octobre 2026"
      sections={[
        ["Éditeur", <p key="e">Kolbase est édité par Mutara France — [forme sociale, capital, adresse du siège, RCS et numéro SIREN à compléter]. Directeur de la publication : [à compléter]. Contact : [adresse e-mail à compléter].</p>],
        ["Hébergement", <p key="h">Application hébergée par Render Services, Inc., 525 Brannan Street, Suite 300, San Francisco, CA 94107, États-Unis. Les serveurs applicatifs et la base de données sont situés dans la région de Francfort (Union européenne).</p>],
        ["Nature du service", <p key="n">Kolbase met en relation des professionnels de santé et des organisations du secteur dentaire et facilite la gestion administrative et réglementaire de leurs collaborations. Kolbase n&apos;est pas partie aux conventions conclues entre utilisateurs et ne fournit pas de conseil juridique.</p>],
        ["Propriété intellectuelle", <p key="p">Les éléments du site (marque, interface, textes, code) sont protégés. Toute reproduction non autorisée est interdite. Les contenus publiés par les utilisateurs restent leur propriété.</p>],
        ["Données de démonstration", <p key="d">Pendant la phase de pré-lancement, la plateforme contient des organisations, praticiens et événements entièrement fictifs, signalés comme tels. Toute ressemblance avec des personnes ou structures existantes serait fortuite.</p>],
      ]}
    />
  );
}
