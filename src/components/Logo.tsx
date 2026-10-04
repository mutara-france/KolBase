import Link from "next/link";

export function Logo({ tagline = true, size }: { tagline?: boolean; size?: number }) {
  return (
    <Link href="/" className="brand-lockup" aria-label="Kolbase — accueil">
      <span className="logo-word" style={size ? { fontSize: size } : undefined}>Kolbase</span>
      {tagline && (
        <>
          <span className="brand-rule" />
          <span className="brand-tag">praticiens × organisations</span>
        </>
      )}
    </Link>
  );
}
