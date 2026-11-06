import Link from "next/link";
import { Logo } from "@/components/Logo";
import { CookieSettingsButton } from "@/components/CookieConsent";
import { LocaleSwitch } from "@/components/LocaleSwitch";
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
        <nav className="footer-links" aria-label={t("Informations légales")}>
          <Link href="/mentions-legales" className="footer-link">{t("Mentions légales")}</Link>
          <Link href="/confidentialite" className="footer-link">{t("Confidentialité")}</Link>
          <CookieSettingsButton className="footer-link" />
          <Link href="/cgu" className="footer-link">{t("Conditions d'utilisation")}</Link>
          <Link href="/conditions-de-vente" className="footer-link">{t("Conditions de vente")}</Link>
          <Link href="/actualites" className="footer-link">{t("Actualités")}</Link>
          <Link href="/aide" className="footer-link">{t("Aide")}</Link>
          <LocaleSwitch className="on-dark" />
        </nav>
      </div>
      <div className="footer-bottom">
        <span>{t("© {year} KolBase. Tous droits réservés.", { year: new Date().getFullYear() })}</span>
        {locale === "en" && <span>{t("Les documents juridiques font foi en français.")}</span>}
        {process.env.SEED_DEMO === "1" && <span>{t("Environnement de démonstration — données simulées")}</span>}
      </div>
    </footer>
  );
}
