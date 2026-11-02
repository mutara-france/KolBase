import type { NextConfig } from "next";

/** En-têtes de sécurité appliqués à toutes les réponses. */
const securityHeaders = [
  // Interdit l'affichage de KolBase dans un cadre (détournement de clic).
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Dépôt de documents dans les dossiers (10 Mo au maximum, voir lib/storage).
  experimental: { serverActions: { bodySizeLimit: "11mb" } },
  headers: async () => [{ source: "/:path*", headers: securityHeaders }],
};

export default nextConfig;
