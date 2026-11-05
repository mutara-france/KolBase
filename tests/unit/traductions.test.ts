import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EN } from "@/lib/i18n/en";

/** Fichiers du code de l'interface (hors client Prisma généré). */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "generated" ? [] : sources(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("traductions", () => {
  it("chaque texte passé à t() a sa traduction anglaise", () => {
    const missing = new Set<string>();
    for (const file of sources("src")) {
      const code = readFileSync(file, "utf8");
      // t("…") avec une chaîne littérale : la clé du dictionnaire est le texte français lui-même.
      for (const m of code.matchAll(/\bt\("((?:[^"\\]|\\.)*)"/g)) {
        const key = JSON.parse(`"${m[1]}"`) as string;
        if (!(key in EN)) missing.add(`${key}  (${file})`);
      }
    }
    expect([...missing]).toEqual([]);
  });
});
