import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <p>© {new Date().getFullYear()} Kolbase — praticiens × organisations. Tous droits réservés.</p>
      <nav>
        <Link href="/mentions-legales">Mentions légales</Link>
        <Link href="/confidentialite">Confidentialité</Link>
        <Link href="/cgu">Conditions d&apos;utilisation</Link>
      </nav>
    </footer>
  );
}
