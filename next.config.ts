import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Dépôt de documents dans les dossiers (10 Mo au maximum, voir lib/storage).
  experimental: { serverActions: { bodySizeLimit: "11mb" } },
};

export default nextConfig;
