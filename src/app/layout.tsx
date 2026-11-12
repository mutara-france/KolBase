import type { Metadata } from "next";
// Polices auto-hébergées (servies par KolBase, sans appel à Google Fonts) : sous-ensemble latin, graisses utilisées.
import "@fontsource/figtree/latin-400.css";
import "@fontsource/figtree/latin-500.css";
import "@fontsource/figtree/latin-600.css";
import "@fontsource/figtree/latin-700.css";
import "@fontsource/montserrat/latin-600.css";
import "@fontsource/montserrat/latin-700.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "./globals.css";
import { cookies } from "next/headers";
import { CookieConsent } from "@/components/CookieConsent";
import { SiteFooter } from "@/components/SiteFooter";
import { I18nProvider } from "@/components/I18nProvider";
import { getLocale, getT } from "@/lib/i18n/server";
import { CONSENT_COOKIE, optionalServices, readConsent } from "@/lib/consent";
import { appUrl } from "@/lib/ics";
import { BrandProvider } from "@/components/BrandProvider";
import { currentBrand } from "@/lib/brand-server";
import { brandPalette } from "@/lib/brand";

export async function generateMetadata(): Promise<Metadata> {
  const { t, locale } = await getT();
  // KolBase Business : sur le nom de domaine d'une organisation, le site porte son nom et n'est pas indexé (ses pages
  // publiques le sont déjà sur KolBase).
  const brand = await currentBrand();
  if (brand) return { metadataBase: new URL(appUrl() || "http://localhost:3000"), title: brand.name, description: t("Espace {name} : experts, événements et collaborations.", { name: brand.name }), robots: { index: false, follow: false } };
  const title = t("KolBase — praticiens × organisations");
  const description = t("KolBase met en relation les chirurgiens-dentistes et les organisations du secteur : industriels, sociétés savantes, associations, organismes de formation.");
  return {
    // Adresses absolues des aperçus de partage (images, liens canoniques).
    metadataBase: new URL(appUrl() || "http://localhost:3000"),
    title,
    description,
    openGraph: { type: "website", siteName: "KolBase", locale: locale === "en" ? "en_GB" : "fr_FR", title, description },
    twitter: { card: "summary_large_image" },
    // Validation du site dans Google Search Console (balise HTML), si elle est configurée.
    ...(process.env.GOOGLE_SITE_VERIFICATION ? { verification: { google: process.env.GOOGLE_SITE_VERIFICATION } } : {}),
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  // Choix sur les cookies lu côté serveur : le bandeau ne clignote pas pour qui a déjà répondu.
  const consent = readConsent((await cookies()).get(CONSENT_COOKIE)?.value);
  const brand = await currentBrand();
  const palette = brand?.color ? brandPalette(brand.color) : null;
  return (
    <html lang={locale} style={palette ?? undefined}>
      <head>
        <meta name="theme-color" content={palette?.["--outremer-deep"] ?? "#0E0066"} />
      </head>
      <body>
        <I18nProvider locale={locale}>
          <BrandProvider brand={brand}>
            <div className="page">{children}</div>
            <SiteFooter />
            <CookieConsent initial={consent} services={optionalServices()} />
          </BrandProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
