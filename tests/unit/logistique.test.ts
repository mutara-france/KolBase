import { describe, expect, it } from "vitest";
import { parseInviteList } from "@/lib/invite-list";
import { hasBooking, nights, readTravel } from "@/lib/travel";
import { budgetRows } from "@/lib/event-budget";

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

describe("Invitations : liste collée depuis un tableur", () => {
  it("e-mail ; prénom ; nom, « Prénom Nom <e-mail> », doublons et lignes illisibles", () => {
    const r = parseInviteList("claire.dupont@exemple.fr;Claire;Dupont\nJean Martin <Jean.Martin@Exemple.fr>\n\nCLAIRE.DUPONT@exemple.fr\npas une adresse\nnadia@exemple.fr\tNadia");
    expect(r.people).toEqual([
      { email: "claire.dupont@exemple.fr", firstName: "Claire", lastName: "Dupont" },
      { email: "jean.martin@exemple.fr", firstName: "Jean", lastName: "Martin" },
      { email: "nadia@exemple.fr", firstName: "Nadia", lastName: null },
    ]);
    expect(r.rejected).toEqual(["pas une adresse"]);
  });
});

describe("Voyage et hébergement", () => {
  it("réservations lues, départ après l'arrivée, chambre connue", () => {
    const t = readTravel(form({ hotel: "Hôtel Rive Gauche", checkIn: "2026-12-14", checkOut: "2026-12-16", roomType: "single", outbound: "TGV 6203" }));
    expect("error" in t).toBe(false);
    if (!("error" in t)) {
      expect(nights(t)).toBe(2);
      expect(t.roomType).toBe("single");
      expect(hasBooking(t)).toBe(true);
    }
    expect(readTravel(form({ checkIn: "2026-12-16", checkOut: "2026-12-16" }))).toEqual({ error: "Le départ de l'hôtel suit l'arrivée d'au moins une nuit." });
    expect((readTravel(form({ roomType: "suite" })) as { roomType: string | null }).roomType).toBeNull();
    expect(hasBooking({ hotel: null, checkIn: null, outbound: null })).toBe(false);
  });
});

describe("Budget de l'événement", () => {
  it("prévu par poste face aux devis retenus ; un engagement sans ligne apparaît aussi", () => {
    const b = budgetRows(
      [{ id: "l1", category: "restauration", label: "Cocktail", plannedCents: 300000 }, { id: "l2", category: "salle", label: "", plannedCents: 150000 }],
      [{ category: "restauration", ttcCents: 320000 }, { category: "transport", ttcCents: 80000 }],
    );
    expect(b.rows.map((r) => [r.category, r.planned, r.engaged])).toEqual([["salle", 150000, 0], ["restauration", 300000, 320000], ["transport", 0, 80000]]);
    expect([b.planned, b.engaged]).toEqual([450000, 400000]);
  });
});
