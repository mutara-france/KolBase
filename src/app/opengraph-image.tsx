import { ogImage, OG_SIZE, OG_TYPE } from "@/lib/og";

export const alt = "KolBase — la plateforme qui met en relation les chirurgiens-dentistes et les organisations du secteur";
export const size = OG_SIZE;
export const contentType = OG_TYPE;

/** Aperçu par défaut des pages de KolBase. */
export default function Image() {
  return ogImage({
    kicker: "Chirurgiens-dentistes et organisations du secteur",
    title: "Événements scientifiques, experts et collaborations",
    lines: ["Agenda, experts référencés, conventions et transparence"],
  });
}
