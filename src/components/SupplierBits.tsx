import { BedDouble, Briefcase, Building2, Bus, Check, Megaphone, Printer, Utensils, Video, type LucideIcon } from "lucide-react";

/**
 * Pièces visuelles communes aux prestataires et devis (côté client, prestataire et pages publiques).
 * Sans dépendance serveur : utilisables dans les composants client comme serveur.
 */

/** Icône de chaque catégorie de prestation. */
export const CATEGORY_ICON: Record<string, LucideIcon> = {
  evenementiel: Briefcase,
  communication: Megaphone,
  salle: Building2,
  restauration: Utensils,
  hebergement: BedDouble,
  transport: Bus,
  audiovisuel: Video,
  impression: Printer,
};

/** Pastille colorée de la catégorie (couleur propre à chaque catégorie, même dessin partout). */
export function CategoryIcon({ category, size = 18, className = "" }: { category: string; size?: number; className?: string }) {
  const Icon = CATEGORY_ICON[category] ?? Briefcase;
  return (
    <span className={`cat-icon cat-${category}${className ? ` ${className}` : ""}`} aria-hidden>
      <Icon size={size} strokeWidth={1.8} />
    </span>
  );
}

export type Step = { key: string; label: string; detail?: string | null; state: "done" | "current" | "todo" | "bad" };

/** Frise d'étapes (même dessin que les étapes d'un dossier), avec une précision sous chaque étape. */
export function StepTrail({ steps, label }: { steps: Step[]; label: string }) {
  return (
    <ol className="pipeline step-trail" aria-label={label}>
      {steps.map((s, i) => (
        <li key={s.key} className={s.state === "done" ? "done" : s.state === "current" ? "current" : s.state === "bad" ? "current bad" : ""} aria-current={s.state === "current" ? "step" : undefined}>
          <span className="dot" aria-hidden>{s.state === "done" ? <Check size={13} strokeWidth={3} /> : i + 1}</span>
          <span className="lbl">{s.label}</span>
          {s.detail && <span className="step-detail">{s.detail}</span>}
        </li>
      ))}
    </ol>
  );
}

/**
 * Coût par participant face au seuil d'hospitalité (repas, nuitée) : une jauge, verte sous le seuil, orange au-dessus.
 * Sans seuil (autres catégories), le montant seul.
 */
export function PerHeadGauge({ each, max, over, label, limitLabel }: { each: number; max?: number | null; over: boolean; label: string; limitLabel?: string | null }) {
  const pct = max ? Math.min(100, Math.round((each / max) * 100)) : null;
  return (
    <div className={`perhead${over ? " over" : ""}`}>
      <div className="perhead-top">
        <span className="perhead-value">{label}</span>
        {limitLabel && <span className="perhead-limit">{limitLabel}</span>}
      </div>
      {pct != null && (
        <div className="perhead-track" aria-hidden>
          <div className="perhead-fill" style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}
