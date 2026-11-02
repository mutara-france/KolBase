import { LegalPage } from "@/components/LegalPage";
import { LEGAL, legal } from "@/lib/legal";

export const metadata = { title: "Mentions légales — KolBase" };

export default function Page() {
  return (
    <LegalPage
      title="Mentions légales"
      updated="novembre 2026"
      sections={[
        ["Éditeur", <p key="e">KolBase est édité par {legal("editor")}, {legal("legalForm")}, dont le siège est situé {legal("address")}, immatriculée {legal("registration")}{LEGAL.vatNumber ? `, TVA ${LEGAL.vatNumber}` : ""}. Directeur ou directrice de la publication : {legal("publicationDirector")}. Contact : {legal("contactEmail")}.</p>],
        ["Hébergement", <p key="h">Application hébergée par Render Services, Inc., 525 Brannan Street, Suite 300, San Francisco, CA 94107, États-Unis. Les serveurs applicatifs et la base de données sont situés dans la région de Francfort (Union européenne). Documents déposés dans les dossiers : {legal("storageProvider")}.</p>],
        ["Nature du service", <p key="n">KolBase met en relation des professionnels de santé et des organisations du secteur dentaire et facilite la gestion administrative et réglementaire de leurs collaborations. KolBase n&apos;est pas partie aux conventions conclues entre utilisateurs et ne fournit pas de conseil juridique.</p>],
        ["Propriété intellectuelle", <p key="p">Les éléments du site (marque, interface, textes, code) sont protégés. Toute reproduction non autorisée est interdite. Les contenus publiés par les utilisateurs restent leur propriété.</p>],
        ["Données de démonstration", <p key="d">Pendant la phase de pré-lancement, la plateforme contient des organisations, praticiens et événements entièrement fictifs, signalés comme tels. Toute ressemblance avec des personnes ou structures existantes serait fortuite.</p>],
      ]}
    />
  );
}
