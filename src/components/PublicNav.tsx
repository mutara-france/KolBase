"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/Logo";
import { LocaleSwitch } from "@/components/LocaleSwitch";
import { useT } from "@/components/I18nProvider";
import { authLink, originOf } from "@/lib/safe-redirect";

const LINKS = [
  { href: "/experts", label: "Experts" },
  { href: "/evenements", label: "Événements" },
  { href: "/appels", label: "Opportunités" },
  { href: "/structures", label: "Organisations" },
  { href: "/actualites", label: "Actualités" },
];

export function PublicNav({ loggedIn }: { loggedIn: boolean }) {
  const path = usePathname();
  const t = useT();
  // Après la connexion ou la création du compte, retour à la page consultée (sauf accueil et pages d'authentification).
  const next = originOf(path);
  const signIn = authLink("/connexion", next);
  return (
    <header className="public-nav">
      <Logo />
      <nav aria-label={t("Navigation principale")}>
        {/* Mobile : « Se connecter » ouvre la rangée défilante (visible sans défiler), « Se référencer » reste un bouton. */}
        {!loggedIn && <Link href={signIn} className="nav-link nav-signin mobile-only">{t("Se connecter")}</Link>}
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} className={`nav-link${path === l.href || path.startsWith(l.href + "/") ? " on" : ""}`}>{t(l.label)}</Link>
        ))}
      </nav>
      <div className="nav-actions">
        <LocaleSwitch />
        {loggedIn ? (
          <Link href="/tableau-de-bord" className="btn">{t("Mon espace")}</Link>
        ) : (
          <>
            <Link href={signIn} className="btn ghost desktop-only">{t("Se connecter")}</Link>
            <Link href={authLink("/inscription", next)} className="btn">{t("Se référencer")}</Link>
          </>
        )}
      </div>
    </header>
  );
}
