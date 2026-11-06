import Link from "next/link";
import { LegalPage, L, P } from "@/components/LegalPage";
import { LEGAL, legal } from "@/lib/legal";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export const metadata = { title: "Mentions légales — KolBase", alternates: { canonical: "/mentions-legales" } };

/** Mentions légales (loi n° 2004-575 du 21 juin 2004 pour la confiance dans l'économie numérique, art. 6). */
export default async function Page() {
  // Données fictives encore présentes (pré-lancement) : signalées tant qu'elles n'ont pas été retirées.
  const demo = await db.organization.count({ where: { id: { startsWith: "demo-" } } });
  return (
    <LegalPage
      path="/mentions-legales"
      title="Mentions légales"
      updated="6 novembre 2026"
      sections={[
        ["Éditeur", <P key="e">{[
          `Le site kolbase.io et le service KolBase sont édités par ${legal("editor")}, ${legal("legalForm")} au capital de ${legal("capital")}, dont le siège est situé ${legal("address")}, immatriculée ${legal("registration")}${LEGAL.vatNumber ? `, numéro de TVA intracommunautaire ${LEGAL.vatNumber}` : ""}.`,
          `Directeur de la publication : ${legal("publicationDirector")}.`,
          <>Contact : <a href={`mailto:${LEGAL.contactEmail}`}>{legal("contactEmail")}</a>.</>,
        ]}</P>],
        ["Hébergement", <P key="h">{[
          `Application et base de données : ${legal("host")}. Les serveurs sont situés à ${legal("hostRegion")}.`,
          // Hébergeur des documents pas encore choisi : ligne omise (l'alerte reste dans l'onglet Lancement de /admin).
          ...(LEGAL.storageProvider ? [`Documents déposés dans les dossiers : ${LEGAL.storageProvider}.`] : []),
        ]}</P>],
        ["Prestataires techniques", <L key="t" items={[
          `Envoi des e-mails : ${legal("emailProvider")}.`,
          `Paiement des abonnements et des services : ${legal("paymentProvider")}. KolBase ne conserve aucun numéro de carte ni coordonnée bancaire complète.`,
          `Signature électronique des conventions : ${legal("signatureProvider")}.`,
          `Assistant de rédaction (intelligence artificielle) : ${legal("aiProvider")}.`,
        ]} />],
        ["Nature du service", <P key="n">{[
          "KolBase met en relation des professionnels de santé du secteur dentaire et des organisations (industriels, sociétés savantes, associations, organismes de formation, prestataires) et facilite la gestion administrative et réglementaire de leurs collaborations.",
          "KolBase n'est pas partie aux conventions conclues entre ses utilisateurs, n'exerce aucune activité de soin, ne fournit pas de conseil juridique et ne fait pas la promotion de produits de santé.",
        ]}</P>],
        ["Propriété intellectuelle", <P key="p">{[
          "La marque KolBase, marque européenne déposée, son logotype, l'interface, les textes et le code du site sont la propriété de l'éditeur. Toute reproduction ou représentation, totale ou partielle, sans autorisation écrite est interdite.",
          "Les noms et logos des organisations présentes sur KolBase appartiennent à leurs titulaires et sont reproduits avec leur autorisation. Les contenus publiés par les utilisateurs (profils, publications, programmes, photos) restent leur propriété ; ils en concèdent à l'éditeur le droit d'affichage nécessaire au service, comme le prévoient les conditions générales d'utilisation.",
          "Polices de caractères : Figtree, Montserrat et IBM Plex Mono, sous licence SIL Open Font License, servies par KolBase.",
        ]}</P>],
        ["Signaler un contenu", <P key="s">{[
          <>Tout contenu manifestement illicite, inexact ou contraire à la déontologie peut être signalé à <a href={`mailto:${LEGAL.contactEmail}`}>{legal("contactEmail")}</a>, en précisant l&apos;adresse de la page, le contenu en cause et les raisons du signalement. L&apos;éditeur l&apos;examine sans délai, retire ou rend inaccessible le contenu si nécessaire et informe de sa décision l&apos;auteur du signalement et celui du contenu.</>,
          "Cette adresse est aussi le point de contact unique de KolBase auprès des autorités et des utilisateurs au sens du règlement (UE) 2022/2065 sur les services numériques ; les échanges s'y font en français ou en anglais.",
        ]}</P>],
        ...(demo > 0 ? [["Données de démonstration", <P key="demo">{["Pendant la phase de pré-lancement, la plateforme présente aussi des organisations, praticiens et événements entièrement fictifs, signalés comme tels. Toute ressemblance avec des personnes ou des structures existantes serait fortuite."]}</P>] as [string, React.ReactNode]] : []),
        ["Données personnelles", <P key="d">{[
          <>Les traitements de données réalisés par KolBase sont décrits dans la <Link href="/confidentialite">politique de confidentialité</Link>. Pour les données que les organisations traitent dans KolBase, l&apos;éditeur agit comme sous-traitant selon le <Link href="/sous-traitance">contrat de sous-traitance</Link>.</>,
        ]}</P>],
      ]}
    />
  );
}
