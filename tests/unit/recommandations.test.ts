import { describe, expect, it } from "vitest";
import { advise, ADVICE_RULES, suggestProduct, type AdviceInput } from "@/lib/intelligence-advice";
import { EN } from "@/lib/i18n/en";

const expert = (name: string, loyalty: string, cents: number, previousCents = 0, shared: { competitor: string; cents: number }[] = []) => ({ name, loyalty, cents, previousCents, shared });
/** Portefeuille sain : six experts, fidèles et nouveaux, honoraires répartis ; un produit couvert ; import récent. */
const base = (): AdviceInput => {
  const experts = [expert("A", "fidele", 300_000, 200_000), expert("B", "fidele", 250_000, 200_000), expert("C", "nouveau", 250_000), expert("D", "nouveau", 200_000), expert("E", "fidele", 200_000, 100_000), expert("F", "revenu", 200_000)];
  return {
    year: 2026, now: new Date("2026-11-12T12:00:00Z"), lastImportAt: new Date("2026-09-01T12:00:00Z"),
    portfolio: { active: 6, total: experts.reduce((s, e) => s + e.cents, 0), loyalty: { nouveau: 2, fidele: 3, dormant: 0 }, experts },
    competitors: [{ name: "Rival", lines: 10, year: { cents: 1_000_000, lines: 10 }, previousCents: 950_000, purposes: [{ label: "Formation" }] }],
    products: { count: 1, coverage: 1, unassigned: 0, rows: [{ name: "Axis", archived: false, recruited: 1, experts: 6, previousExperts: 4, accepted: 6, declined: 1 }] },
  };
};
const keys = (i: AdviceInput) => advise(i).map((a) => a.key);

describe("KolBase Intelligence : recommandations", () => {
  it("rien à signaler sur un portefeuille sain", () => {
    expect(advise(base())).toEqual([]);
  });
  it("signale d'abord l'expert qu'un concurrent paie davantage", () => {
    const i = base();
    i.portfolio.experts[2] = expert("C", "nouveau", 250_000, 0, [{ competitor: "Rival", cents: 900_000 }, { competitor: "Autre", cents: 100_000 }]);
    const [first] = advise(i);
    expect(first).toMatchObject({ key: "experts-partages", level: 1, tone: "danger", vars: { n: 1, names: "C", competitor: "Rival" } });
    // Déclaré par un concurrent, mais moins que vos honoraires : pas d'alerte.
    i.portfolio.experts[2] = expert("C", "nouveau", 250_000, 0, [{ competitor: "Rival", cents: 100_000 }]);
    expect(keys(i)).not.toContain("experts-partages");
  });
  it("experts dormants : les plus importants à relancer d'abord, urgence selon la fidélisation", () => {
    const i = base();
    i.portfolio.experts.push(expert("G", "dormant", 0, 50_000), expert("H", "dormant", 0, 400_000));
    i.portfolio.loyalty.dormant = 2;
    const a = advise(i).find((x) => x.key === "dormants")!;
    expect(a).toMatchObject({ level: 2, vars: { n: 2, kept: 60, names: "H, G", previous: 2025 } });
    i.portfolio.loyalty = { nouveau: 2, fidele: 1, dormant: 2 };
    expect(advise(i).find((x) => x.key === "dormants")).toMatchObject({ level: 1, tone: "danger" });
  });
  it("panel concentré et panel sans renouvellement, à partir de cinq experts", () => {
    const i = base();
    i.portfolio.experts = [expert("A", "fidele", 900_000), expert("B", "fidele", 600_000), expert("C", "fidele", 300_000), expert("D", "fidele", 100_000), expert("E", "fidele", 100_000)];
    i.portfolio = { ...i.portfolio, active: 5, total: 2_000_000, loyalty: { nouveau: 0, fidele: 5, dormant: 0 } };
    expect(keys(i)).toEqual(["concentration", "sans-nouveaux"]);
    expect(advise(i)[0].vars).toMatchObject({ share: 90, names: "A, B, C" });
    // Quatre experts : trop peu pour parler de concentration.
    i.portfolio.active = 4;
    expect(keys(i)).toEqual([]);
  });
  it("produits : à décrire, à rattacher, déclinés, sans expert, et celui qui recrute", () => {
    const i = base();
    i.products = { count: 0, coverage: null, unassigned: 0, rows: [] };
    expect(keys(i)).toEqual(["sans-produits"]);
    i.products = { count: 2, coverage: 0.4, unassigned: 3, rows: [
      { name: "Axis", archived: false, recruited: 3, experts: 5, previousExperts: 2, accepted: 5, declined: 0 },
      { name: "Nova", archived: false, recruited: 0, experts: 0, previousExperts: 3, accepted: 1, declined: 4 },
      { name: "Ancien", archived: true, recruited: 0, experts: 0, previousExperts: 2, accepted: 0, declined: 5 },
    ] };
    expect(keys(i)).toEqual(["produits-a-rattacher", "produit-decline:nova", "produit-sans-expert:nova", "produit-qui-recrute"]);
    expect(advise(i).find((a) => a.key === "produit-qui-recrute")).toMatchObject({ tone: "ok", vars: { product: "Axis", n: 3 } });
    expect(advise(i).find((a) => a.key === "produit-decline:nova")!.vars).toMatchObject({ accepted: 1, answered: 5, rate: 20 });
    // Trois réponses seulement : pas assez pour conclure.
    i.products.rows[1] = { ...i.products.rows[1], accepted: 0, declined: 3, previousExperts: 0 };
    expect(keys(i)).toEqual(["produits-a-rattacher", "produit-qui-recrute"]);
  });
  it("concurrents : hausse notable, veille à nourrir", () => {
    const i = base();
    i.competitors[0].year.cents = 1_300_000;
    expect(advise(i)[0]).toMatchObject({ key: "concurrent-hausse:rival", vars: { rise: 37, purpose: "Formation" } });
    i.competitors[0].year.lines = 2;
    expect(keys(i)).toEqual([]);
    i.competitors = [];
    expect(keys(i)).toEqual(["sans-concurrents"]);
    const j = base();
    j.lastImportAt = null;
    expect(keys(j)).toEqual(["sans-import"]);
    j.lastImportAt = new Date(j.now!.getTime() - (ADVICE_RULES.importAge + 1) * 86400e3);
    expect(keys(j)).toEqual(["import-ancien"]);
  });
  it("classe par priorité, et chaque texte a sa traduction", () => {
    const i = base();
    i.portfolio.experts.push(expert("G", "dormant", 0, 50_000));
    i.portfolio.loyalty.dormant = 1;
    i.portfolio.experts[0] = expert("A", "fidele", 300_000, 200_000, [{ competitor: "Rival", cents: 900_000 }]);
    i.competitors = [];
    const list = advise(i);
    expect(list.map((a) => a.level)).toEqual([...list.map((a) => a.level)].sort());
    const all = [base(), i].flatMap(advise);
    for (const a of all) for (const text of [a.title, a.detail]) expect(EN[text], text).toBeTruthy();
  });
  it("propose le produit que le titre nomme", () => {
    const p = (id: string, name: string, range: string | null = null, archived = false) => ({ id, name, range, archivedAt: archived ? new Date() : null });
    const products = [p("1", "Axis"), p("2", "Axis Pro"), p("3", "Nova", "Gamme Ortho"), p("4", "Ancien", null, true)];
    expect(suggestProduct("Board implantologie — AXIS PRO 2027", products)?.id).toBe("2");
    expect(suggestProduct("Symposium Axis", products)?.id).toBe("1");
    expect(suggestProduct("Webinaire Axisse", products)).toBeNull();
    expect(suggestProduct("Formation Ancien", products)).toBeNull();
    // La gamme ne suffit pas : trop générale pour rattacher sans se tromper.
    expect(suggestProduct("Atelier gamme ortho", products)).toBeNull();
  });
});
