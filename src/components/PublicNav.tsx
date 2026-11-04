"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/Logo";
import { LocaleSwitch } from "@/components/LocaleSwitch";
import { useT } from "@/components/I18nProvider";

const LINKS = [
  { href: "/experts", label: "Experts" },
  { href: "/evenements", label: "Événements" },
  { href: "/appels", label: "Opportunités" },
  { href: "/structures", label: "Organisations" },
  { href: "/actualites", label: "Actualités" },
  { href: "/aide", label: "Aide" },
];

export function PublicNav({ loggedIn }: { loggedIn: boolean }) {
  const path = usePathname();
  const t = useT();
  return (
    <header className="public-nav">
      <Logo />
      <nav aria-label={t("Navigation principale")}>
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} className={`nav-link${path === l.href || path.startsWith(l.href + "/") ? " on" : ""}`}>{t(l.label)}</Link>
        ))}
        {/* Mobile : « Se connecter » rejoint la rangée défilante, « Se référencer » reste un bouton visible. */}
        {!loggedIn && <Link href="/connexion" className="nav-link mobile-only">{t("Se connecter")}</Link>}
      </nav>
      <div className="nav-actions">
        <LocaleSwitch />
        {loggedIn ? (
          <Link href="/tableau-de-bord" className="btn">{t("Mon espace")}</Link>
        ) : (
          <>
            <Link href="/connexion" className="btn ghost desktop-only">{t("Se connecter")}</Link>
            <Link href="/inscription" className="btn">{t("Se référencer")}</Link>
          </>
        )}
      </div>
    </header>
  );
}
