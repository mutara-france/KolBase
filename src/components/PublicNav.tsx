"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/Logo";

const LINKS = [
  { href: "/experts", label: "Experts" },
  { href: "/evenements", label: "Événements" },
  { href: "/appels", label: "Opportunités" },
  { href: "/structures", label: "Organisations" },
  { href: "/aide", label: "Aide" },
];

export function PublicNav({ loggedIn }: { loggedIn: boolean }) {
  const path = usePathname();
  return (
    <header className="public-nav">
      <Logo />
      <nav aria-label="Navigation principale">
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} className={`nav-link${path === l.href || path.startsWith(l.href + "/") ? " on" : ""}`}>{l.label}</Link>
        ))}
      </nav>
      <div className="nav-actions">
        {loggedIn ? (
          <Link href="/tableau-de-bord" className="btn">Mon espace</Link>
        ) : (
          <>
            <Link href="/connexion" className="btn ghost">Se connecter</Link>
            <Link href="/inscription" className="btn">Se référencer</Link>
          </>
        )}
      </div>
    </header>
  );
}
