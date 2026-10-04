import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <nav>
        <Link href="/mentions-legales">Mentions légales</Link>
        <Link href="/confidentialite">Confidentialité</Link>
        <Link href="/cgu">Conditions d&apos;utilisation</Link>
        <Link href="/evenements">Agenda</Link>
      </nav>
      <p>© {new Date().getFullYear()} Kolbase. Tous droits réservés.</p>
    </footer>
  );
}
