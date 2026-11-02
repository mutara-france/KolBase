import Link from "next/link";
import { Megaphone, UserSearch } from "lucide-react";

/**
 * Les deux sortes d'appels, côte à côte : l'appel à experts recrute pour une collaboration rémunérée,
 * l'appel à intervenants cherche des orateurs pour un événement. Dans les deux cas, la personne retenue ouvre un dossier.
 */
export function CallKinds({ orgId, current }: { orgId: string; current: "experts" | "intervenants" }) {
  const kinds = [
    {
      key: "experts", href: `/organisations/${orgId}/opportunites`, icon: <UserSearch size={18} />, title: "Appel à experts",
      what: "Recruter un ou plusieurs praticiens pour une collaboration rémunérée : board, étude, rédaction, formation, consultation…",
      how: "Les experts référencés candidatent ; vous retenez, un dossier de collaboration s'ouvre.",
    },
    {
      key: "intervenants", href: `/organisations/${orgId}/intervenants`, icon: <Megaphone size={18} />, title: "Appel à intervenants",
      what: "Trouver des orateurs pour l'un de vos événements : symposium, soirée scientifique, formation, live surgery…",
      how: "L'appel est rattaché à l'événement ; l'intervenant retenu y apparaît et un dossier s'ouvre pour sa convention.",
    },
  ] as const;
  return (
    <div className="call-kinds">
      {kinds.map((k) => (
        <Link key={k.key} href={k.href} className={`call-kind${k.key === current ? " current" : ""}`} aria-current={k.key === current ? "page" : undefined}>
          <span className="call-kind-icon">{k.icon}</span>
          <span>
            <strong>{k.title}</strong>
            <span className="text-sm">{k.what}</span>
            <span className="text-xs muted">{k.how}</span>
          </span>
        </Link>
      ))}
    </div>
  );
}
