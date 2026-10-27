import type { Metadata } from "next";
import "./globals.css";
import { SiteFooter } from "@/components/SiteFooter";

export const metadata: Metadata = {
  title: "KolBase — praticiens × organisations",
  description:
    "KolBase met en relation les chirurgiens-dentistes et les organisations du secteur : industriels, sociétés savantes, associations, organismes de formation.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&family=Montserrat:wght@600;700&display=swap"
        />
        <meta name="theme-color" content="#0E0066" />
      </head>
      <body>
        <div className="page">{children}</div>
        <SiteFooter />
      </body>
    </html>
  );
}
