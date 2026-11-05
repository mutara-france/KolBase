import { describe, expect, it } from "vitest";
import { hasMemberRole, memberRoles } from "@/lib/org-roles";
import { hashPassword, needsRehash, verifyPassword } from "@/lib/password";
import { matchesType } from "@/lib/storage";
import { inline } from "@/lib/article-format";

const user = (totp: boolean, require2fa: boolean) => ({
  totpEnabledAt: totp ? new Date() : null,
  memberships: [
    { organizationId: "o1", role: "PROJETS" as const, organization: { require2fa } },
    { organizationId: "o2", role: "ADMIN" as const, organization: { require2fa: false } },
  ],
});

describe("contrôle d'accès hors de requireMembership", () => {
  it("donne les rôles du membre", () => {
    expect(memberRoles(user(false, false), "o1")).toEqual(["PROJETS"]);
    expect(hasMemberRole(user(false, false), "o1", ["PROJETS", "ADMIN"])).toBe(true);
    expect(hasMemberRole(user(false, false), "o1", ["CONFORMITE"])).toBe(false);
    expect(hasMemberRole(user(false, false), "autre")).toBe(false);
  });
  it("refuse tout tant que la double authentification exigée n'est pas activée", () => {
    expect(memberRoles(user(false, true), "o1")).toEqual([]);
    expect(hasMemberRole(user(false, true), "o1")).toBe(false);
    expect(hasMemberRole(user(true, true), "o1", ["PROJETS"])).toBe(true);
    // L'exigence d'une organisation ne touche pas les autres.
    expect(hasMemberRole(user(false, true), "o2", ["ADMIN"])).toBe(true);
  });
});

describe("mots de passe", () => {
  it("écrit les paramètres dans le hash et le vérifie", async () => {
    const h = await hashPassword("motdepasse-1");
    expect(h).toMatch(/^scrypt\$16384\$8\$5\$/);
    expect(await verifyPassword("motdepasse-1", h)).toBe(true);
    expect(await verifyPassword("motdepasse-2", h)).toBe(false);
    expect(needsRehash(h)).toBe(false);
  });
  it("vérifie l'ancien format et demande son recalcul", async () => {
    const { scryptSync, randomBytes } = await import("node:crypto");
    const salt = randomBytes(16);
    const legacy = `scrypt$${salt.toString("base64")}$${scryptSync("ancien-mdp-1", salt, 64).toString("base64")}`;
    expect(await verifyPassword("ancien-mdp-1", legacy)).toBe(true);
    expect(needsRehash(legacy)).toBe(true);
  });
  it("refuse sans erreur un compte sans mot de passe ou un hash altéré", async () => {
    expect(await verifyPassword("x", null)).toBe(false);
    expect(await verifyPassword("x", "scrypt$1048576$8$1$c2Fs$aGFzaA==")).toBe(false);
  });
});

describe("fichiers déposés", () => {
  it("contrôle les premiers octets selon le format déclaré", () => {
    const b = (...n: number[]) => new Uint8Array(n);
    expect(matchesType("application/pdf", new TextEncoder().encode("%PDF-1.7"))).toBe(true);
    expect(matchesType("application/pdf", new TextEncoder().encode("MZ\x90\x00"))).toBe(false);
    expect(matchesType("image/png", b(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe(true);
    expect(matchesType("image/jpeg", b(0xff, 0xd8, 0xff, 0xe0))).toBe(true);
    expect(matchesType("application/vnd.openxmlformats-officedocument.wordprocessingml.document", b(0x50, 0x4b, 0x03, 0x04))).toBe(true);
    expect(matchesType("application/vnd.openxmlformats-officedocument.wordprocessingml.document", b(0x25, 0x50))).toBe(false);
    expect(matchesType("text/html", new TextEncoder().encode("<html>"))).toBe(false);
  });
});

describe("liens des actualités", () => {
  it("refuse les adresses relatives au protocole", () => {
    expect(inline("[x](//exemple.com)")).toEqual([{ text: "[x](//exemple.com)" }]);
    expect(inline("[x](/\\exemple.com)")).toEqual([{ text: "[x](/\\exemple.com)" }]);
    expect(inline("[aide](/aide)")).toEqual([{ text: "aide", href: "/aide" }]);
  });
});
