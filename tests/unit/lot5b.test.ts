import { describe, expect, it } from "vitest";
import { authLink, organisationOrigin, originOf } from "@/lib/safe-redirect";

describe("entrée : page d'origine et profil gardés", () => {
  it("l'en-tête public transmet la page courante, sauf l'accueil et les pages d'authentification", () => {
    expect(originOf("/evenements/abc")).toBe("/evenements/abc");
    expect(originOf("/")).toBe("");
    expect(originOf("/connexion")).toBe("");
    expect(originOf("/inscription")).toBe("");
    expect(originOf("/mot-de-passe-oublie")).toBe("");
    expect(originOf("/mot-de-passe/abc")).toBe("");
    expect(originOf("/confirmer-email/abc")).toBe("");
    expect(originOf("//evil.example")).toBe("");
  });
  it("liens entre pages d'authentification : profil puis page d'origine", () => {
    expect(authLink("/connexion", "")).toBe("/connexion");
    expect(authLink("/connexion", "/evenements")).toBe("/connexion?next=%2Fevenements");
    expect(authLink("/inscription", "/invitation/abc", "organisation")).toBe("/inscription?profil=organisation&next=%2Finvitation%2Fabc");
    expect(authLink("/inscription", null, "organisation")).toBe("/inscription?profil=organisation");
  });
  it("profil « organisation » déduit d'une invitation ou d'une création d'organisation", () => {
    expect(organisationOrigin("/invitation/abc")).toBe(true);
    expect(organisationOrigin("/organisations/nouvelle")).toBe(true);
    expect(organisationOrigin("/evenements")).toBe(false);
    expect(organisationOrigin(undefined)).toBe(false);
  });
});
