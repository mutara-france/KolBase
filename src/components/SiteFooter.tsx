import Link from "next/link";
import { Logo } from "@/components/Logo";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <div>
          <Logo />
          <p className="text-xs mt-2" style={{ maxWidth: 340 }}>
            Plateforme de mise en relation entre praticiens et organisations du secteur dentaire.
          </p>
        </div>
        <div className="footer-links">
          <Link href="/mentions-legales" className="footer-link">Mentions légales</Link>
          <Link href="/confidentialite" className="footer-link">Confidentialité</Link>
          <Link href="/cgu" className="footer-link">Conditions d&apos;utilisation</Link>
          <Link href="/aide" className="footer-link">Aide</Link>
        </div>
      </div>
      <div className="footer-bottom">
        <span>© {new Date().getFullYear()} Kolbase. Tous droits réservés.</span>
        {process.env.SEED_DEMO === "1" && <span>Environnement de démonstration — données simulées</span>}
      </div>
    </footer>
  );
}
