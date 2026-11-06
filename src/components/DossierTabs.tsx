import Link from "next/link";
import { Lock, type LucideIcon } from "lucide-react";
import { TabsScroll } from "@/components/TabsScroll";

export type DossierTab = {
  key: string;
  label: string;
  icon: LucideIcon;
  /** Nombre affiché à côté du libellé (experts, documents…). */
  count?: number;
  /** Quelque chose attend une action dans l'onglet : pastille corail (avec le nombre, ou un point). */
  alert?: boolean;
  /** Onglet pas encore ouvert : la raison s'affiche au survol et reste lue par les lecteurs d'écran. */
  disabled?: string;
};

/** Onglets horizontaux d'une fiche (dossier, collaboration) : une page par onglet, adresse partageable. */
export function DossierTabs({ tabs, active, href, label }: { tabs: DossierTab[]; active: string; href: (key: string) => string; label: string }) {
  return (
    <nav className="dossier-tabs" aria-label={label}>
      {tabs.map((tb) => {
        const Icon = tb.icon;
        const badge = tb.count != null ? <span className={`tab-count${tb.alert ? " alert" : ""}`}>{tb.count}</span> : tb.alert ? <span className="tab-dot" aria-hidden /> : null;
        if (tb.disabled)
          return (
            <span key={tb.key} className="dossier-tab disabled" aria-disabled="true" title={tb.disabled}>
              <Icon size={17} strokeWidth={1.8} aria-hidden />
              {tb.label}
              <Lock size={13} aria-hidden />
              <span className="sr-only">{` (${tb.disabled})`}</span>
            </span>
          );
        return (
          <Link key={tb.key} href={href(tb.key)} className={`dossier-tab${tb.key === active ? " active" : ""}`} aria-current={tb.key === active ? "page" : undefined}>
            <Icon size={17} strokeWidth={1.8} aria-hidden />
            {tb.label}
            {badge}
          </Link>
        );
      })}
      <TabsScroll />
    </nav>
  );
}
