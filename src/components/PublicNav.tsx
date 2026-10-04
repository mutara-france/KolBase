"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogIn } from "lucide-react";
import { Logo } from "@/components/Logo";

const LINKS = [
  { href: "/evenements", label: "Événements" },
  { href: "/experts", label: "Experts" },
  { href: "/structures", label: "Organisations" },
  { href: "/appels", label: "Opportunités" },
  { href: "/aide", label: "Aide" },
];

export function PublicNav({ loggedIn }: { loggedIn: boolean }) {
  const path = usePathname();
  return (
    <header className="public-nav">
      <Logo />
      <nav>
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} className={`nav-link${path === l.href || path.startsWith(l.href + "/") ? " on" : ""}`}>{l.label}</Link>
        ))}
        {loggedIn ? (
          <Link href="/tableau-de-bord" className="btn ml-2">Mon espace</Link>
        ) : (
          <Link href="/connexion" className="btn ml-2"><LogIn size={15} /> Se connecter</Link>
        )}
      </nav>
    </header>
  );
}
