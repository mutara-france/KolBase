import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kolbase — praticiens × organisations",
  description:
    "Kolbase met en relation les chirurgiens-dentistes et les organisations du secteur : industriels, sociétés savantes, associations, organismes de formation.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
