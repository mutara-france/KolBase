import { describe, expect, it } from "vitest";
import { createThrottle, MAX_PER_HOUR, SAME_ERROR_MS } from "@/lib/alert-throttle";

describe("alertes d'erreur", () => {
  it("une alerte par erreur identique toutes les 30 minutes", () => {
    const allow = createThrottle();
    expect(allow("a", 0)).toBe(true);
    expect(allow("a", 1000)).toBe(false);
    expect(allow("b", 1000)).toBe(true);
    expect(allow("a", SAME_ERROR_MS + 1)).toBe(true);
  });
  it("au plus dix alertes par heure", () => {
    const allow = createThrottle();
    for (let i = 0; i < MAX_PER_HOUR; i++) expect(allow(`e${i}`, i)).toBe(true);
    expect(allow("autre", 100)).toBe(false);
    expect(allow("autre", 3600_001)).toBe(true);
  });
});
