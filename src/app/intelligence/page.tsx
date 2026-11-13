import type { Metadata } from "next";
import { Lightbulb, Newspaper, Package, Radar, ShieldCheck, Users } from "lucide-react";
import { OfferPage, type OfferCopy } from "@/components/OfferPage";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  const title = t("KolBase Intelligence : pilotez votre KOL management");
  const description = t("Votre organisation comparée au marché, à des organisations équivalentes et à celles que vous choisissez, avec les recommandations qui en découlent. Pour les industriels.");
  return { title: `${title} — KolBase`, description, alternates: { canonical: "/intelligence" }, openGraph: { siteName: "KolBase", url: "/intelligence", title, description } };
}

const COPY: OfferCopy = {
  path: "intelligence",
  paid: { pill: "Option de l'abonnement · industriels", step: "Un administrateur ajoute l'option depuis la page Abonnement.", note: "Réservée aux industriels abonnés ; ajoutée ou retirée à tout moment." },
  free: { pill: "En accès libre · industriels", note: "Ouverte à tous les industriels pendant sa mise au point, sans paiement : elle s'ouvre depuis vos Statistiques." },
  title: "Pilotez votre KOL management.",
  accent: "Décidez sur des chiffres.",
  lede: "Un tableau de bord qui vous compare au marché, à des organisations équivalentes et à celles que vous choisissez, et un moteur qui vous dit qui protéger, qui recruter et où mettre le budget.",
  features: [
    { icon: Lightbulb, title: "Des recommandations, pas seulement des chiffres", text: "En tête de page, les constats les plus pressants : les experts à protéger, ceux à recruter, le poste de budget où vous décrochez de vos équivalentes. Chacun est chiffré et mène à l'action." },
    { icon: Radar, title: "Vous, face au marché", text: "Votre rang, votre part du marché, vos montants et vos bénéficiaires, comparés à la médiane du marché, à des organisations de votre taille et à celles que vous choisissez — sur cinq ans, par motif et par région." },
    { icon: Users, title: "Vos experts : protéger, recruter", text: "Ceux que d'autres entreprises sollicitent plus que vous, et les professionnels qu'engagent vos comparables sans aucun lien avec vous. Plus votre portefeuille : nouveaux, fidèles, dormants." },
    { icon: Package, title: "Vos produits, un par un", text: "Quel produit fait entrer le plus de nouveaux experts, lequel est souvent décliné, combien d'inscrits réunissent ses événements." },
    { icon: Newspaper, title: "La veille du secteur", text: "Les publications des sites spécialisés qui citent vos concurrents ou votre organisation, réunies sur 90 jours. Vous y ajoutez les publications des réseaux sociaux qui comptent." },
    { icon: ShieldCheck, title: "Vos données restent les vôtres", text: "La comparaison repose sur la base publique Transparence Santé, mise à jour par l'équipe KolBase : vous n'importez rien. Aucune donnée d'une autre organisation cliente de KolBase n'est lue." },
  ],
  steps: [
    "La comparaison et les premières recommandations se lisent aussitôt : KolBase vous reconnaît dans la base publique sous votre nom.",
    "Vous décrivez vos produits et y rattachez vos dossiers, d'un coup quand le titre nomme le produit.",
    "Vous choisissez les organisations auxquelles vous comparer nommément.",
  ],
  notes: [
    "Les recommandations sont des règles lisibles, avec leurs seuils : vous voyez toujours le chiffre qui les déclenche.",
    "Les chiffres de marché viennent des déclarations publiées dans la base Transparence Santé : les entreprises déclarantes répondent de leur exactitude.",
    "Les réseaux sociaux ne sont pas collectés automatiquement : leurs conditions l'interdisent.",
  ],
};

export default function Page() {
  return <OfferPage addon="intelligence" copy={COPY} />;
}
