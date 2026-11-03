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
import { SiteFooter } from "@/components/SiteFooter";
import { I18nProvider } from "@/components/I18nProvider";
import { getLocale, getT } from "@/lib/i18n/server";
import { appUrl } from "@/lib/ics";

export async function generateMetadata(): Promise<Metadata> {
  const { t, locale } = await getT();
  const title = t("KolBase — praticiens × organisations");
  const description = t("KolBase met en relation les chirurgiens-dentistes et les organisations du secteur : industriels, sociétés savantes, associations, organismes de formation.");
  return {
    // Adresses absolues des aperçus de partage (images, liens canoniques).
    metadataBase: new URL(appUrl() || "http://localhost:3000"),
    title,
    description,
    openGraph: { type: "website", siteName: "KolBase", locale: locale === "en" ? "en_GB" : "fr_FR", title, description },
    twitter: { card: "summary_large_image" },
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale}>
      <head>
        <meta name="theme-color" content="#0E0066" />
      </head>
      <body>
        <I18nProvider locale={locale}>
          <div className="page">{children}</div>
          <SiteFooter />
        </I18nProvider>
      </body>
    </html>
  );
}
