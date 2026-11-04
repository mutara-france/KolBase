import { describe, expect, it } from "vitest";
import { canCancelRfq, rfqConflict, rfqView } from "@/lib/suppliers";
import { awaitingExpert, expertLinkState, expertNotices, pipelineLabel, PROPOSAL_ORIGIN } from "@/lib/projects";

describe("confidentialité des devis : agence consultée sur l'événement qu'elle pilote", () => {
  const rfq = {
    id: "r1",
    suppliers: [{ supplierId: "agence" }, { supplierId: "traiteur" }],
    quotes: [{ supplierId: "traiteur", amountCents: 100 }, { supplierId: "agence", amountCents: 200 }],
    messages: [{ supplierId: "traiteur", body: "question" }, { supplierId: "agence", body: "ma question" }],
  };
  it("conflit dès que l'organisation de l'utilisateur figure parmi les prestataires consultés", () => {
    expect(rfqConflict(["agence", "traiteur"], ["agence"])).toBe(true);
    expect(rfqConflict(["traiteur"], ["agence"])).toBe(false);
    expect(rfqConflict(["traiteur"], [])).toBe(false);
  });
  it("en conflit : seulement son devis, ses échanges et sa ligne de prestataire", () => {
    const v = rfqView(rfq, ["agence"]);
    expect(v.conflicted).toBe(true);
    expect(v.quotes.map((q) => q.supplierId)).toEqual(["agence"]);
    expect(v.messages.map((m) => m.body)).toEqual(["ma question"]);
    expect(v.suppliers.map((s) => s.supplierId)).toEqual(["agence"]);
  });
  it("sans conflit : la demande entière", () => {
    const v = rfqView(rfq, ["autre"]);
    expect(v.conflicted).toBe(false);
    expect(v.quotes).toHaveLength(2);
    expect(v.messages).toHaveLength(2);
  });
  it("annuler : organisateurs ou auteur de la demande, jamais en conflit d'intérêts", () => {
    expect(canCancelRfq({ organizer: true, author: false, conflicted: false })).toBe(true);
    expect(canCancelRfq({ organizer: false, author: true, conflicted: false })).toBe(true);
    expect(canCancelRfq({ organizer: false, author: false, conflicted: false })).toBe(false);
    expect(canCancelRfq({ organizer: true, author: true, conflicted: true })).toBe(false);
  });
});

describe("sollicitation vue par l'expert", () => {
  const link = (status: string, desiredFeeCents: number | null = null, respondedAt: Date | null = null) => ({ status, desiredFeeCents, respondedAt });
  const project = (status: string, abandonNote: string | null = null, origin: string | null = "Sollicitation directe") => ({ status, abandonNote, origin });
  it("restée sans réponse après la soumission : « Recrutement clos », pas « Décliné / abandonné »", () => {
    expect(expertLinkState(link("ATT_EXPERTS"), project("EN_VALID"))).toBe("clos");
    expect(expertLinkState(link("ATT_EXPERTS"), project("ATT_EXPERTS"))).toBe("attente");
    expect(expertLinkState(link("ATT_EXPERTS", 180000, new Date()), project("ACCORD"))).toBe("contre");
  });
  it("abandon par l'organisation (motif) distinct du déclin de l'expert", () => {
    expect(expertLinkState(link("DECLINE", null, new Date()), project("DECLINE", "Budget gelé"))).toBe("abandonne");
    expect(expertLinkState(link("DECLINE", null, new Date()), project("DECLINE"))).toBe("decline");
    expect(expertLinkState(link("DECLINE"), project("DECLINE"))).toBe("abandonne");
    expect(expertLinkState(link("DECLINE", null, new Date()), project("ACCORD"))).toBe("decline");
    expect(expertLinkState(link("DECLINE", null, new Date()), project("DECLINE", null, PROPOSAL_ORIGIN))).toBe("refuse");
    expect(expertLinkState(link("SIGNATURE", null, new Date()), project("SIGNATURE"))).toBe("engage");
  });
  it("à traiter (menu, accueil, liste) : réponse attendue et recrutement ouvert, pas une contre-proposition", () => {
    expect(awaitingExpert(link("ATT_EXPERTS"), "ATT_EXPERTS")).toBe(true);
    expect(awaitingExpert(link("ATT_EXPERTS"), "ACCORD")).toBe(true);
    expect(awaitingExpert(link("ATT_EXPERTS"), "EN_VALID")).toBe(false);
    expect(awaitingExpert(link("ATT_EXPERTS"), "DECLINE")).toBe(false);
    expect(awaitingExpert(link("ATT_EXPERTS", 180000), "ATT_EXPERTS")).toBe(false);
  });
  it("frise de l'expert : « Sollicitation reçue » sur l'étape franchie", () => {
    expect(pipelineLabel("ATT_EXPERTS", "expert")).toBe("Sollicitation reçue");
    expect(pipelineLabel("ATT_EXPERTS")).toBe("En attente des experts");
    expect(pipelineLabel("SIGNATURE", "expert")).toBe("En signature");
  });
});

describe("étapes du dossier annoncées à l'expert", () => {
  it("abandon à tous, retour en accord et signé aux engagés, recrutement clos aux sollicités", () => {
    expect(expertNotices("abandon", true)).toEqual([{ notice: "abandon", who: "tous" }]);
    expect(expertNotices("back_to_accord", true)).toEqual([{ notice: "retour_accord", who: "engages" }]);
    expect(expertNotices("signed", true)).toEqual([{ notice: "signe", who: "engages" }]);
    expect(expertNotices("submit", true)).toEqual([{ notice: "recrutement_clos", who: "sollicites" }]);
    expect(expertNotices("validate", true)).toEqual([]);
  });
  it("passage en signature : seulement quand la convention se dépose à la main", () => {
    expect(expertNotices("declaration", false)).toEqual([{ notice: "signature", who: "engages" }]);
    expect(expertNotices("ordre_ok", false)).toEqual([{ notice: "signature", who: "engages" }]);
    expect(expertNotices("declaration", true)).toEqual([]);
  });
});
