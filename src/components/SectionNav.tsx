import Link from "next/link";
import type { SectionTab } from "@/lib/nav";

/** Onglets d'une rubrique (pages sœurs). Masqués s'il n'y a qu'une page. */
export function SectionNav({ tabs, active, label }: { tabs: SectionTab[]; active: string; label: string }) {
  if (tabs.length < 2) return null;
  return (
    <nav className="section-nav" aria-label={label}>
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} className={t.key === active ? "active" : undefined} aria-current={t.key === active ? "page" : undefined}>
          {t.label}
          {t.count ? <span className="count">{t.count}</span> : null}
        </Link>
      ))}
    </nav>
  );
}
