import Link from "next/link";
import { Logo } from "@/components/Logo";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <div>
          <Logo tone="light" height={26} />
          <p className="text-xs mt-2" style={{ maxWidth: 360 }}>
            La plateforme qui met en relation les chirurgiens-dentistes et les organisations du secteur.
          </p>
        </div>
        <nav className="footer-links" aria-label="Informations légales">
          <Link href="/mentions-legales" className="footer-link">Mentions légales</Link>
          <Link href="/confidentialite" className="footer-link">Confidentialité</Link>
          <Link href="/cgu" className="footer-link">Conditions d&apos;utilisation</Link>
          <Link href="/aide" className="footer-link">Aide</Link>
        </nav>
      </div>
      <div className="footer-bottom">
        <span>© {new Date().getFullYear()} KolBase. Tous droits réservés.</span>
        {process.env.SEED_DEMO === "1" && <span>Environnement de démonstration — données simulées</span>}
      </div>
    </footer>
  );
}
