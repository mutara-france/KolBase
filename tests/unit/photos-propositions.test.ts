import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { processPortrait } from "@/lib/photos";
import { expertPhotoSrc, photoPath } from "@/lib/expert-photo";
import { DEFAULT_KOL_VISIBILITY, kolVisibility } from "@/lib/visibility";
import { expertLinkState, expertNotices, PROPOSAL_ORIGIN, PROPOSAL_WITHDRAWN, proposalAnswer, proposalText } from "@/lib/projects";
import { ENGAGING, resumeAction } from "@/lib/billing-plans";

/** Image de test : dégradé, avec position GPS et appareil dans les métadonnées EXIF. */
async function photoWithGps(width: number, height: number, orientation?: number) {
  return new Uint8Array(
    await sharp({ create: { width, height, channels: 3, background: { r: 120, g: 80, b: 200 } } })
      .jpeg()
      .withExif({ IFD0: { Make: "Téléphone", Model: "Modèle secret" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "48/1 51/1 0/1", GPSLongitudeRef: "E", GPSLongitude: "2/1 21/1 0/1" } })
      .withMetadata(orientation ? { orientation } : {})
      .toBuffer(),
  );
}

describe("photo des praticiens", () => {
  it("recadre au carré, en deux tailles, sans aucune métadonnée", async () => {
    const input = await photoWithGps(1200, 900);
    expect((await sharp(input).metadata()).exif).toBeDefined();
    const out = await processPortrait(input);
    if ("error" in out) throw new Error(out.error);
    const [full, thumb] = await Promise.all([sharp(out.data).metadata(), sharp(out.thumb).metadata()]);
    expect([full.format, full.width, full.height]).toEqual(["jpeg", 800, 800]);
    expect([thumb.format, thumb.width, thumb.height]).toEqual(["webp", 192, 192]);
    expect(full.exif).toBeUndefined();
    expect(thumb.exif).toBeUndefined();
    expect(Buffer.from(out.data).includes("secret")).toBe(false);
  });

  it("refuse une image trop petite, un faux fichier et un SVG", async () => {
    expect(await processPortrait(await photoWithGps(150, 400))).toEqual({ error: "Photo trop petite : {min} × {min} pixels au minimum." });
    expect(await processPortrait(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toHaveProperty("error");
    // En-tête JPEG valide, contenu illisible.
    expect(await processPortrait(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]))).toHaveProperty("error");
  });

  it("photo en hauteur : le carré garde le haut de l'image (le visage d'un portrait)", async () => {
    // 900 × 1200 : bande rouge sur les 200 premiers pixels (la tête), bleu dessous.
    const input = await sharp({ create: { width: 900, height: 1200, channels: 3, background: { r: 0, g: 0, b: 255 } } })
      .composite([{ input: { create: { width: 900, height: 200, channels: 3, background: { r: 255, g: 0, b: 0 } } }, top: 0, left: 0 }])
      .png()
      .toBuffer();
    const out = await processPortrait(new Uint8Array(input));
    if ("error" in out) throw new Error(out.error);
    const { data, info } = await sharp(out.data).raw().toBuffer({ resolveWithObject: true });
    const at = (x: number, y: number) => [...data.subarray((y * info.width + x) * 3, (y * info.width + x) * 3 + 3)];
    expect(at(400, 20)[0]).toBeGreaterThan(200); // haut : rouge conservé
    expect(at(400, 780)[2]).toBeGreaterThan(200); // bas : bleu
  });

  it("une photo couchée (orientation EXIF) est jugée sur ses côtés redressés", async () => {
    // 900 × 150 stockée couchée (orientation 6) : redressée, 150 de large, donc trop petite.
    expect(await processPortrait(await photoWithGps(900, 150, 6))).toHaveProperty("error");
  });

  it("visibilité : publique par défaut, masquée ou réservée aux organisations sur réglage", () => {
    expect(DEFAULT_KOL_VISIBILITY.photo).toBe("public");
    const at = new Date("2026-11-04T10:00:00Z");
    const p = (photo?: string) => ({ id: "p1", photoUpdatedAt: at, visibility: photo ? { photo } : {} });
    expect(expertPhotoSrc(p(), "public")).toBe(`/experts/p1/photo?v=${at.getTime()}`);
    expect(expertPhotoSrc(p("industriels"), "public")).toBeNull();
    expect(expertPhotoSrc(p("industriels"), "connecte")).toBeNull();
    expect(expertPhotoSrc(p("industriels"), "membre")).not.toBeNull();
    expect(expertPhotoSrc(p("masque"), "membre")).toBeNull();
    expect(expertPhotoSrc(p("masque"), "proprietaire")).not.toBeNull();
    expect(expertPhotoSrc({ id: "p1", photoUpdatedAt: null, visibility: {} }, "proprietaire")).toBeNull();
    expect(kolVisibility({ photo: "n'importe quoi" }).photo).toBe("public");
    expect(photoPath("p1", at, "grande")).toBe(`/experts/p1/photo?v=${at.getTime()}&taille=grande`);
  });
});

describe("projets proposés par les experts", () => {
  const link = (over: Partial<{ status: string; responseNote: string | null }> = {}) => ({ status: "ACCORD", desiredFeeCents: null, respondedAt: new Date(), responseNote: null, ...over });
  const project = (status: string, abandonNote: string | null = null) => ({ status, abandonNote, origin: PROPOSAL_ORIGIN });

  it("réponse de chaque organisation : en attente, retirée, déclinée, acceptée, abandonnée ensuite", () => {
    expect(proposalAnswer(project("ATT_IND"), link())).toBe("attente");
    expect(proposalAnswer(project("DECLINE"), link({ status: "DECLINE", responseNote: PROPOSAL_WITHDRAWN }))).toBe("retiree");
    expect(proposalAnswer(project("DECLINE"), link({ status: "DECLINE" }))).toBe("declinee");
    expect(proposalAnswer(project("ACCORD"), link())).toBe("acceptee");
    expect(proposalAnswer(project("SIGNE"), link({ status: "SIGNE" }))).toBe("acceptee");
    expect(proposalAnswer(project("DECLINE", "Budget gelé"), link({ status: "DECLINE" }))).toBe("abandonnee");
  });

  it("état vu par l'expert : retirée, refusée, abandonnée après acceptation", () => {
    expect(expertLinkState(link({ status: "DECLINE", responseNote: PROPOSAL_WITHDRAWN }), project("DECLINE"))).toBe("retire");
    expect(expertLinkState(link({ status: "DECLINE" }), project("DECLINE"))).toBe("refuse");
    expect(expertLinkState(link({ status: "DECLINE" }), project("DECLINE", "Budget gelé"))).toBe("abandonne");
    expect(expertLinkState(link(), project("ATT_IND"))).toBe("engage");
  });

  it("texte reçu par l'organisation : objectif, puis public et calendrier s'ils sont précisés", () => {
    expect(proposalText({ description: "Objectif." })).toBe("Objectif.");
    expect(proposalText({ description: "Objectif.", audience: "Omnipraticiens", schedule: "Printemps" })).toBe("Objectif.\n\nPublic et format : Omnipraticiens\n\nCalendrier envisagé : Printemps");
  });

  it("l'expert est prévenu de la réponse ; accepter exige l'abonnement, avec retour à la proposition", () => {
    expect(expertNotices("accept_proposal", false)).toEqual([{ notice: "proposition_acceptee", who: "engages" }]);
    expect(expertNotices("decline_proposal", true)).toEqual([{ notice: "proposition_declinee", who: "engages" }]);
    expect(ENGAGING.proposition).toBe("accepter le projet proposé par un expert");
    expect(resumeAction("o1", "proposition", "prj1")?.href).toBe("/organisations/o1/dossiers/prj1");
  });
});
