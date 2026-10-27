import { normalize } from "@/lib/search";

/** Illustrations 3D des spécialités (public/visuels/specialites). */
const VISUALS: Record<string, string> = {
  implantologie: "implantologie",
  parodontologie: "parodontologie",
  "chirurgie orale": "chirurgie-orale",
  orthodontie: "orthodontie",
  endodontie: "endodontie",
  prothese: "prothese",
  esthetique: "esthetique",
  pedodontie: "pedodontie",
  occlusodontie: "occlusodontie",
};

export function specialtyVisual(name: string | null | undefined): string | null {
  const key = normalize(name);
  const file = VISUALS[key] ?? Object.entries(VISUALS).find(([k]) => key.startsWith(k))?.[1];
  return file ? `/visuels/specialites/${file}.webp` : null;
}
