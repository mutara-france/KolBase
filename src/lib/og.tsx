import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

/** Format des images d'aperçu (Open Graph, LinkedIn, WhatsApp…). */
export const OG_SIZE = { width: 1200, height: 630 };
export const OG_TYPE = "image/png";

let cache: Promise<{ title: Buffer; text: Buffer; logo: string }> | null = null;
/** Polices de la marque (WOFF, lues une fois) et logotype blanc. */
function assets() {
  // Chemins littéraux : seuls ces trois fichiers sont embarqués avec le serveur.
  cache ??= Promise.all([
    readFile(join(process.cwd(), "node_modules/@fontsource/montserrat/files/montserrat-latin-700-normal.woff")),
    readFile(join(process.cwd(), "node_modules/@fontsource/figtree/files/figtree-latin-500-normal.woff")),
    readFile(join(process.cwd(), "public/brand/kolbase-logo-blanc.svg")),
  ]).then(([title, text, logo]) => ({ title, text, logo: `data:image/svg+xml;base64,${logo.toString("base64")}` }));
  return cache;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** Image d'aperçu aux couleurs de KolBase : surtitre, titre, lignes d'information et pied. */
export async function ogImage({ kicker, title, lines = [], footer }: { kicker?: string; title: string; lines?: string[]; footer?: string }) {
  const a = await assets();
  const long = title.length > 70;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "64px 72px", background: "linear-gradient(135deg, #0e0066 0%, #1800ab 62%, #5638f0 100%)", color: "#ffffff", fontFamily: "Figtree" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={a.logo} width={260} height={50} alt="" />
          <div style={{ display: "flex", fontSize: 26, color: "#cfc8f5" }}>praticiens × organisations</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          {kicker && <div style={{ display: "flex", fontSize: 28, letterSpacing: 2, textTransform: "uppercase", color: "#f0845e" }}>{clip(kicker, 60)}</div>}
          <div style={{ display: "flex", fontFamily: "Montserrat", fontSize: long ? 54 : 66, lineHeight: 1.12 }}>{clip(title, 120)}</div>
          {lines.filter(Boolean).map((l) => <div key={l} style={{ display: "flex", fontSize: 32, color: "#ece8ff" }}>{clip(l, 80)}</div>)}
        </div>
        <div style={{ display: "flex", fontSize: 26, color: "#cfc8f5" }}>{footer ?? "kolbase.io"}</div>
      </div>
    ),
    { ...OG_SIZE, fonts: [{ name: "Montserrat", data: a.title, weight: 700, style: "normal" }, { name: "Figtree", data: a.text, weight: 500, style: "normal" }] },
  );
}
