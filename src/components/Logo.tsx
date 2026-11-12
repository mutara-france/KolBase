"use client";

import Link from "next/link";
import { useT } from "@/components/I18nProvider";
import { useBrand } from "@/components/BrandProvider";

/**
 * Logotype KōlBase (SVG vectoriel). `tone="light"` pour les fonds sombres. Sur le nom de domaine d'une organisation
 * (KolBase Business) : son logo, ou son nom si elle n'en a pas déposé.
 */
export function Logo({ tagline = false, height, tone = "dark" }: { tagline?: boolean; height?: number; tone?: "dark" | "light" }) {
  const t = useT();
  const brand = useBrand();
  if (brand)
    return (
      <Link href="/" className="brand-lockup" aria-label={t("{name} — accueil", { name: brand.name })}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {brand.logo ? <img src={brand.logo} alt={brand.name} className={`brand-logo brand-own${tone === "light" ? " on-dark" : ""}`} style={height ? { height } : undefined} /> : <span className="brand-name">{brand.name}</span>}
      </Link>
    );
  const src = tone === "light" ? "/brand/kolbase-logo-blanc.svg" : "/brand/kolbase-logo-outremer.svg";
  return (
    <Link href="/" className="brand-lockup" aria-label={t("KolBase — accueil")}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="KōlBase" className="brand-logo" style={height ? { height } : undefined} width={140} height={27} />
      {tagline && (
        <>
          <span className="brand-rule" />
          <span className="brand-tag">{t("praticiens × organisations")}</span>
        </>
      )}
    </Link>
  );
}
