import { describe, expect, it } from "vitest";
import { isAgencyOnly } from "@/lib/org-roles";
import { orgMenuLinks } from "@/lib/nav";
import { de, elides } from "@/lib/elision";
import { featuredUntil, groupOrders, packStatus } from "@/lib/service-pack";

describe("agence mandatée dans l'espace d'un client", () => {
  it("seul le rôle « Agence mandatée » dans une organisation cliente", () => {
    expect(isAgencyOnly(["PRESTATAIRE"], "INDUSTRIEL")).toBe(true);
    expect(isAgencyOnly(["PRESTATAIRE", "PROJETS"], "INDUSTRIEL")).toBe(false);
    expect(isAgencyOnly(["PRESTATAIRE"], "PRESTATAIRE")).toBe(false);
    expect(isAgencyOnly([], "INDUSTRIEL")).toBe(false);
  });
  it("ni abonnement ni « Voir notre page publique » dans le menu de l'agence", () => {
    const links = orgMenuLinks("o1", ["PRESTATAIRE"], "INDUSTRIEL").map((l) => l.href);
    expect(links).not.toContain("/structures/o1");
    expect(links).not.toContain("/organisations/o1/abonnement");
    expect(orgMenuLinks("o1", ["PROJETS"], "INDUSTRIEL").map((l) => l.href)).toContain("/structures/o1");
  });
});

describe("élision de « de » devant un nom", () => {
  it("voyelles et h muet courants", () => {
    expect(de("Académie Odonto Formation")).toBe("d'Académie Odonto Formation");
    expect(de("Agence Médiane Événements")).toBe("d'Agence Médiane Événements");
    expect(de("Hôtel Rive Gauche")).toBe("d'Hôtel Rive Gauche");
    expect(de("Espace Confluence")).toBe("d'Espace Confluence");
    expect(de("OrthoNova")).toBe("d'OrthoNova");
  });
  it("consonnes, Y et h aspiré gardent « de »", () => {
    expect(de("Dentalys Implants")).toBe("de Dentalys Implants");
    expect(de("Yousign")).toBe("de Yousign");
    expect(de("Hachette Santé")).toBe("de Hachette Santé");
    expect(elides("  Univers Dentaire")).toBe(true);
  });
  it("article contracté devant « Le » et « Les »", () => {
    expect(de("Les Tables du Sud")).toBe("des Tables du Sud");
    expect(de("Le Petit Traiteur")).toBe("du Petit Traiteur");
    expect(de("La Poste")).toBe("de La Poste");
  });
});

describe("services commandés en pack", () => {
  const t0 = new Date("2026-11-04T10:00:00Z");
  const o = (id: string, packLabel: string | null, ms = 0, by = "u1") => ({ id, packLabel, orderedById: by, createdAt: new Date(t0.getTime() + ms) });
  it("regroupe les services d'un même pack passé ensemble", () => {
    const g = groupOrders([o("a", "Pack visibilité"), o("b", "Pack visibilité", 20), o("c", null), o("d", "Pack visibilité", 60_000), o("e", "Pack visibilité", 30)]);
    expect(g.map((x) => x.orders.map((y) => y.id).join(""))).toEqual(["abe", "c", "d"]);
    expect(g[0].pack).toBe("Pack visibilité");
    expect(g[1].pack).toBeNull();
  });
  it("statut d'ensemble du pack", () => {
    expect(packStatus(["demandee", "demandee"])).toEqual({ status: "demandee", done: 0, total: 2 });
    expect(packStatus(["realisee", "planifiee", "demandee"])).toEqual({ status: "en_cours", done: 1, total: 3 });
    expect(packStatus(["realisee", "refusee"])).toEqual({ status: "realisee", done: 1, total: 1 });
    expect(packStatus(["annulee", "annulee"]).status).toBe("annulee");
  });
});

describe("mise à la une", () => {
  it("en cours sept jours après sa réalisation", () => {
    const doneAt = new Date("2026-11-01T10:00:00Z");
    const une = { status: "realisee", doneAt, offer: { kind: "une" } };
    expect(featuredUntil(une, new Date("2026-11-04T10:00:00Z"))?.toISOString()).toBe("2026-11-08T10:00:00.000Z");
    expect(featuredUntil(une, new Date("2026-11-09T10:00:00Z"))).toBeNull();
    expect(featuredUntil({ ...une, offer: { kind: "social" } }, new Date("2026-11-04T10:00:00Z"))).toBeNull();
    expect(featuredUntil({ ...une, status: "planifiee" }, new Date("2026-11-04T10:00:00Z"))).toBeNull();
  });
});
