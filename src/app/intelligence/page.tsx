import type { Metadata } from "next";
import { Lightbulb, Newspaper, Package, Radar, ShieldCheck, Users } from "lucide-react";
import { OfferPage, type OfferCopy } from "@/components/OfferPage";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  const title = t("KolBase Intelligence : pilotez votre KOL management");
  const description = t("Vos experts, vos produits et vos concurrents sur une même page, avec les recommandations qui en découlent. Pour les industriels.");
  return { title: `${title} — KolBase`, description, alternates: { canonical: "/intelligence" }, openGraph: { siteName: "KolBase", url: "/intelligence", title, description } };
}

const COPY: OfferCopy = {
  path: "intelligence",
  paid: { pill: "Option de l'abonnement · industriels", step: "Un administrateur ajoute l'option depuis la page Abonnement.", note: "Réservée aux industriels abonnés ; ajoutée ou retirée à tout moment." },
  free: { pill: "En accès libre · industriels", note: "Ouverte à tous les industriels pendant sa mise au point, sans paiement : elle s'ouvre depuis vos Statistiques." },
  title: "Pilotez votre KOL management.",
  accent: "Décidez sur des chiffres.",
  lede: "Vos experts, vos produits et vos concurrents sur une même page, avec les recommandations qui en découlent.",
  features: [
    { icon: Lightbulb, title: "Des recommandations, pas seulement des chiffres", text: "En tête de page, les constats les plus pressants : l'expert qu'un concurrent sollicite plus que vous, ceux à relancer, le panel trop concentré. Chacun est chiffré et mène à l'action." },
    { icon: Users, title: "Votre portefeuille d'experts", text: "Qui est nouveau, fidèle, de retour ou dormant, année après année, et quelle part de vos experts vous gardez." },
    { icon: Package, title: "Vos produits, un par un", text: "Quel produit fait entrer le plus de nouveaux experts, lequel est souvent décliné, combien d'inscrits réunissent ses événements." },
    { icon: Radar, title: "Vos concurrents suivis", text: "Leurs déclarations publiques par type de lien, leurs premiers bénéficiaires, et les experts que vous partagez avec eux, à partir des fichiers Transparence Santé que vous importez." },
    { icon: Newspaper, title: "La veille du secteur", text: "Les publications des sites spécialisés qui citent vos concurrents ou votre organisation, réunies sur 90 jours. Vous y ajoutez les publications des réseaux sociaux qui comptent." },
    { icon: ShieldCheck, title: "Vos données restent les vôtres", text: "L'analyse porte sur vos dossiers, vos événements et vos imports. Aucune donnée d'une autre organisation cliente de KolBase n'est lue." },
  ],
  steps: [
    "Le portefeuille et les premières recommandations se lisent aussitôt : ils viennent de vos dossiers existants.",
    "Vous décrivez vos produits et y rattachez vos dossiers, d'un coup quand le titre nomme le produit.",
    "Vous ajoutez vos concurrents et importez leurs déclarations publiques.",
  ],
  notes: [
    "Les recommandations sont des règles lisibles, avec leurs seuils : vous voyez toujours le chiffre qui les déclenche.",
    "La réutilisation de la base Transparence Santé est encadrée par sa licence : votre organisation en répond pour les fichiers qu'elle importe.",
    "Les réseaux sociaux ne sont pas collectés automatiquement : leurs conditions l'interdisent.",
  ],
};

export default function Page() {
  return <OfferPage addon="intelligence" copy={COPY} />;
}
