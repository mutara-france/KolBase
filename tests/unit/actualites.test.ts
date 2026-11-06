import { describe, expect, it } from "vitest";
import { inline, parseArticle, readingMinutes, slugify } from "@/lib/article-format";

describe("actualités", () => {
  it("découpe le texte en blocs sûrs", () => {
    const b = parseArticle("## Ce qui change\n\nPremier paragraphe\nsur deux lignes.\n\n- un\n- **deux**\n\nVoir [l'aide](/aide) ou [ici](javascript:alert(1)).");
    expect(b[0]).toEqual({ kind: "h2", text: "Ce qui change" });
    expect(b[1]).toEqual({ kind: "p", parts: [{ text: "Premier paragraphe sur deux lignes." }] });
    expect(b[2]).toEqual({ kind: "ul", items: [[{ text: "un" }], [{ text: "deux", bold: true }]] });
    const last = b[3] as { kind: "p"; parts: { text: string; href?: string }[] };
    expect(last.parts.find((p) => p.href === "/aide")?.text).toBe("l'aide");
    expect(last.parts.some((p) => p.href?.startsWith("javascript"))).toBe(false);
  });
  it("accepte les liens externes en https", () => {
    expect(inline("[CNIL](https://www.cnil.fr)")).toEqual([{ text: "CNIL", href: "https://www.cnil.fr" }]);
  });
  it("accepte les images du site seules sur leur ligne, jamais une image extérieure", () => {
    const b = parseArticle("Avant\n![Huit chiffres](/etudes/b/huit.webp)\nAprès\n\n![Pisteur](https://tiers.example/p.png)\n\n![](//tiers.example/p.png)");
    expect(b[0]).toEqual({ kind: "p", parts: [{ text: "Avant" }] });
    expect(b[1]).toEqual({ kind: "img", src: "/etudes/b/huit.webp", alt: "Huit chiffres" });
    expect(b[2]).toEqual({ kind: "p", parts: [{ text: "Après" }] });
    expect(b.slice(3).every((x) => x.kind === "p")).toBe(true);
  });
  it("crée des adresses lisibles", () => {
    expect(slugify("Nouveau : attestations vérifiables !")).toBe("nouveau-attestations-verifiables");
    expect(slugify("???")).toBe("article");
  });
  it("estime le temps de lecture", () => {
    expect(readingMinutes("mot ".repeat(450))).toBe(2);
    expect(readingMinutes("court")).toBe(1);
  });
});
