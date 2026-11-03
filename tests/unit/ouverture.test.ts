import { describe, expect, it } from "vitest";
import { defaultVatBp } from "@/lib/quotes";

describe("devis : taux de TVA proposé", () => {
  it("10 % pour la restauration, l'hébergement et le transport, 20 % sinon", () => {
    expect(defaultVatBp("restauration")).toBe(1000);
    expect(defaultVatBp("hebergement")).toBe(1000);
    expect(defaultVatBp("transport")).toBe(1000);
    expect(defaultVatBp("salle")).toBe(2000);
    expect(defaultVatBp("audiovisuel")).toBe(2000);
  });
});
