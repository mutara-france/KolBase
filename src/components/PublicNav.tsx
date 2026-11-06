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
  const signUp = authLink("/inscription", next);
  return (
    <header className="public-nav">
      <Logo />
      <nav aria-label={t("Navigation principale")}>
        {/* Mobile : « Se référencer » ouvre la rangée défilante (visible sans défiler), « Se connecter » reste un bouton. */}
        {!loggedIn && <Link href={signUp} className="nav-link nav-signin mobile-only">{t("Se référencer")}</Link>}
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} className={`nav-link${path === l.href || path.startsWith(l.href + "/") ? " on" : ""}`}>{t(l.label)}</Link>
        ))}
      </nav>
      <div className="nav-actions">
        {/* Langue : choix du visiteur ; une fois connecté, elle se règle dans « Mon compte ». */}
        {!loggedIn && <LocaleSwitch />}
        {loggedIn ? (
          <Link href="/tableau-de-bord" className="btn">{t("Mon espace")}</Link>
        ) : (
          <>
            <Link href={signIn} className="btn ghost desktop-only">{t("Se connecter")}</Link>
            <Link href={signUp} className="btn desktop-only">{t("Se référencer")}</Link>
            <Link href={signIn} className="btn mobile-only">{t("Se connecter")}</Link>
          </>
        )}
      </div>
    </header>
  );
}
