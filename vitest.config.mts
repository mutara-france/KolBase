import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Modules de règles (sans base de données) : chacun doit rester couvert par les tests unitaires (`npm run test:coverage`,
 * lancé par la CI). Les actions serveur, elles, sont couvertes par le parcours de bout en bout.
 */
const RULE_MODULES = [
  "agenda", "article-format", "billing-plans", "compliance", "events", "fee-notes", "indicators", "intelligence", "nav",
  "org-roles", "projects", "quotes", "service-pack", "tabular", "totp", "visibility",
].map((m) => `src/lib/${m}.ts`);

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // Marqueur Next.js : sans effet hors du serveur React.
      "server-only": fileURLToPath(new URL("./tests/stubs/empty.ts", import.meta.url)),
    },
  },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: RULE_MODULES,
      reporter: ["text-summary", "text"],
      thresholds: { perFile: true, lines: 75, statements: 75, functions: 60, branches: 60 },
    },
  },
});
