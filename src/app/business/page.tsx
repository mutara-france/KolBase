import type { Metadata } from "next";
import { Globe2, House, Lock, Palette, SearchX, Sparkles } from "lucide-react";
import { OfferPage, type OfferCopy } from "@/components/OfferPage";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  const title = t("KolBase Business : votre propre KolBase");
  const description = t("KolBase à votre adresse, à votre nom, avec votre logo et votre couleur.");
  return { title: `${title} — KolBase`, description, alternates: { canonical: "/business" }, openGraph: { siteName: "KolBase", url: "/business", title, description } };
}

const COPY: OfferCopy = {
  path: "marque",
  paid: { pill: "Option de l'abonnement · toute organisation", step: "Un administrateur ajoute l'option depuis la page Abonnement.", note: "Ouverte à toute organisation abonnée, hors prestataires ; ajoutée ou retirée à tout moment." },
  free: { pill: "En accès libre · toute organisation", note: "Ouverte à toute organisation, hors prestataires, pendant sa mise au point, sans paiement : un administrateur la règle depuis « Marque et nom de domaine »." },
  title: "Votre propre KolBase,",
  accent: "à votre nom.",
  lede: "Vos équipes travaillent sur KolBase à votre adresse, avec votre logo et votre couleur.",
  features: [
    { icon: Globe2, title: "Votre nom de domaine", text: "KolBase s'ouvre à une adresse qui vous appartient, par exemple kol.votre-domaine.com. Vous créez un enregistrement DNS, nous faisons le reste." },
    { icon: Palette, title: "Votre logo et votre couleur", text: "Dans l'en-tête, la barre latérale et le pied de page. La couleur est contrôlée pour que boutons et liens restent lisibles." },
    { icon: House, title: "Votre page d'accueil", text: "À votre adresse, vos membres arrivent dans votre espace ; vos experts et vos visiteurs, sur votre page publique." },
    { icon: Lock, title: "Un accès réservé à vos équipes", text: "Seuls les membres de votre organisation se connectent sur votre adresse, et n'y voient que votre espace." },
    { icon: SearchX, title: "Hors des moteurs de recherche", text: "Votre adresse n'est pas indexée : vos pages publiques restent référencées sur KolBase, sans doublon." },
    { icon: Sparkles, title: "Tout KolBase, sans rien installer", text: "Dossiers, événements, conformité, experts : les mêmes outils, tenus à jour par KolBase." },
  ],
  steps: [
    "Vous réglez votre nom affiché et votre couleur, avec un aperçu.",
    "Vous indiquez votre nom de domaine et créez l'enregistrement DNS affiché.",
    "L'équipe KolBase rattache le domaine, vérifie son certificat et l'active.",
  ],
  notes: [
    "Vos experts gardent leur compte et leur espace sur kolbase.io : ils ne se connectent pas sur votre adresse.",
    "KolBase reste l'éditeur du service : les e-mails et les textes légaux sont les siens.",
    "L'activation du nom de domaine est faite par l'équipe KolBase, après votre enregistrement DNS.",
  ],
};

export default function Page() {
  return <OfferPage addon="business" copy={COPY} />;
}
