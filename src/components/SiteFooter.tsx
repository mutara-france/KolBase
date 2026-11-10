import Link from "next/link";
import { Logo } from "@/components/Logo";
import { CookieSettingsButton } from "@/components/CookieConsent";
import { getT } from "@/lib/i18n/server";

export async function SiteFooter() {
  const { t, locale } = await getT();
  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <div>
          <Logo tone="light" height={26} />
          <p className="text-xs mt-2" style={{ maxWidth: 360 }}>
            {t("La plateforme qui met en relation les chirurgiens-dentistes et les organisations du secteur.")}
          </p>
        </div>
        {/* Premier niveau : contenus et aide ; les informations légales sont à part, en bas. */}
        <nav className="footer-links" aria-label={t("Pied de page")}>
          <Link href="/actualites" className="footer-link">{t("Actualités")}</Link>
          <Link href="/aide" className="footer-link">{t("Base de connaissances")}</Link>
        </nav>
      </div>
      <div className="footer-bottom">
        <nav className="footer-legal" aria-label={t("Informations légales")}>
          <Link href="/mentions-legales" className="footer-link">{t("Mentions légales")}</Link>
          <Link href="/confidentialite" className="footer-link">{t("Confidentialité")}</Link>
          <CookieSettingsButton className="footer-link" />
          <Link href="/cgu" className="footer-link">{t("Conditions d'utilisation")}</Link>
          <Link href="/conditions-de-vente" className="footer-link">{t("Conditions de vente")}</Link>
        </nav>
        <span>{t("© {year} KolBase. Tous droits réservés.", { year: new Date().getFullYear() })} {t("KolBase est une marque européenne déposée.")}</span>
        {locale === "en" && <span>{t("Les documents juridiques font foi en français.")}</span>}
      </div>
    </footer>
  );
}
