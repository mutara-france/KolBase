import { describe, expect, it } from "vitest";
import { conversion, reportLine, reportParts } from "@/lib/service-report";

describe("bilan des services", () => {
  const s = { clicks: 57, registrations: 9, recipients: 412, since: 35 };
  it("présente les chiffres clés selon le service", () => {
    expect(reportLine(s, "newsletter")).toBe("412 destinataires · 57 visiteurs du lien · 9 inscriptions par ce lien");
    expect(reportLine(s, "social")).toBe("57 visiteurs du lien · 9 inscriptions par ce lien");
    expect(reportParts({ clicks: 1, registrations: 0, recipients: 1, since: 0 }, "newsletter").map((p) => p.key)).toEqual([
      "{n} destinataire", "{n} visiteur du lien", "{n} inscription par ce lien",
    ]);
  });
  it("calcule la conversion seulement avec des visiteurs", () => {
    expect(conversion(s)).toBe(16);
    expect(conversion({ ...s, clicks: 0 })).toBeNull();
  });
});
