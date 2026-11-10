import Link from "next/link";
import { BookOpenText, CalendarDays, FileText, Handshake, Lightbulb, type LucideIcon, Mic, Scale, Sparkles } from "lucide-react";
import { ARTICLE_CATEGORIES, type ArticleCategory } from "@/lib/article-format";

/** Icône de chaque rubrique : les filtres se lisent d'un coup d'œil, même en anglais. */
const ICONS: Record<ArticleCategory, LucideIcon> = {
  Plateforme: Sparkles,
  Réglementation: Scale,
  Événements: CalendarDays,
  Partenaires: Handshake,
  Conseils: Lightbulb,
  Études: FileText,
  Podcasts: Mic,
  "Base de connaissances": BookOpenText,
};

/**
 * Filtres par rubrique de la page des actualités : des liens (pas d'état client), la rubrique choisie dans l'adresse
 * (?rubrique=…) pour être partageable. Seules les rubriques qui ont au moins un article publié sont proposées.
 */
export function NewsCategories({ counts, current, t, allLabel, ariaLabel }: { counts: Record<string, number>; current: string | null; t: (s: string) => string; allLabel: string; ariaLabel: string }) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const shown = ARTICLE_CATEGORIES.filter((c) => counts[c]);
  if (shown.length < 2) return null;
  return (
    <nav className="chips news-filters" aria-label={ariaLabel}>
      <Link href="/actualites" className={`chip chip-icon${current ? "" : " active"}`} aria-current={current ? undefined : "page"}>
        {allLabel}<span className="chip-count">{total}</span>
      </Link>
      {shown.map((c) => {
        const Icon = ICONS[c];
        const active = current === c;
        return (
          <Link key={c} href={`/actualites?rubrique=${encodeURIComponent(c)}`} className={`chip chip-icon${active ? " active" : ""}`} aria-current={active ? "page" : undefined}>
            <Icon size={15} aria-hidden /> {t(c)}<span className="chip-count">{counts[c]}</span>
          </Link>
        );
      })}
    </nav>
  );
}
