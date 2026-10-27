import Link from "next/link";

/** Logotype KōlBase (SVG vectoriel). `tone="light"` pour les fonds sombres. */
export function Logo({ tagline = false, height, tone = "dark" }: { tagline?: boolean; height?: number; tone?: "dark" | "light" }) {
  const src = tone === "light" ? "/brand/kolbase-logo-blanc.svg" : "/brand/kolbase-logo-outremer.svg";
  return (
    <Link href="/" className="brand-lockup" aria-label="KolBase — accueil">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="KōlBase" className="brand-logo" style={height ? { height } : undefined} width={140} height={27} />
      {tagline && (
        <>
          <span className="brand-rule" />
          <span className="brand-tag">praticiens × organisations</span>
        </>
      )}
    </Link>
  );
}
