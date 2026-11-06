import { ogImage, OG_SIZE, OG_TYPE } from "@/lib/og";

export const alt = "Baromètre des collaborations dentaires 2022-2025, étude KolBase";
export const size = OG_SIZE;
export const contentType = OG_TYPE;

/** Aperçu de partage de la page de l'étude (LinkedIn, messageries). */
export default function Image() {
  return ogImage({
    kicker: "Étude KolBase · accès libre",
    title: "Baromètre des collaborations dentaires 2022-2025",
    lines: ["134 583 déclarations Transparence Santé", "65 pages · 8 chapitres · 7 recommandations"],
    footer: "kolbase.io/barometre",
  });
}
