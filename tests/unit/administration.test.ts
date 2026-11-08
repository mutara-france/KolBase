import { describe, expect, it } from "vitest";
import { adminNavItems, bottomBar, itemMatches } from "@/lib/nav";
import { auditLabel, auditTone, entityHref, JOURNAL_DOMAINS } from "@/lib/admin-labels";
import { TRANSITIONS } from "@/lib/projects";
import { orgKindDisplay } from "@/lib/org-roles";

describe("Administration KolBase : navigation", () => {
  const items = adminNavItems({ orgs: 2, identities: 3, services: 0 });

  it("une entrée par page, les décisions en attente en pastille", () => {
    expect(items.map((i) => i.href)).toEqual([
      "/admin", "/admin/organisations", "/admin/comptes", "/admin/identites", "/admin/journal", "/admin/signalements",
      "/admin/services", "/admin/abonnements", "/admin/actualites", "/admin/emails", "/admin/exploitation",
    ]);
    expect(items.find((i) => i.key === "admin-organisations")?.badge).toBe(2);
    expect(items.find((i) => i.key === "admin-identites")?.badge).toBe(3);
  });

  it("barre du bas : cinq rubriques, le reste dans le menu", () => {
    const { bar, overflow } = bottomBar(items);
    expect(bar.map((i) => i.key)).toEqual(["admin-accueil", "admin-organisations", "admin-comptes", "admin-identites", "admin-journal"]);
    expect(overflow).toHaveLength(6);
  });

  it("le tableau de bord n'est actif que sur /admin", () => {
    const home = items[0];
    expect(itemMatches(home, "/admin")).toBe(true);
    expect(itemMatches(home, "/admin/comptes")).toBe(false);
    expect(itemMatches(items[2], "/admin/comptes/u1")).toBe(true);
  });
});

describe("Administration KolBase : journal d'activité", () => {
  it("actions nommées en clair, sinon domaine et code", () => {
    expect(auditLabel("admin.account_disable")).toBe("Compte désactivé par KolBase");
    expect(auditLabel("project.submit")).toBe("Dossier soumis à la conformité");
    expect(auditLabel("rfq.request_update")).toBe("Demande de devis · request update");
    expect(auditLabel("inconnu.truc")).toBe("inconnu · truc");
  });

  it("chaque transition d'un dossier a son libellé", () => {
    for (const key of Object.keys(TRANSITIONS)) expect(auditLabel(`project.${key}`)).not.toMatch(/·/);
  });

  it("sécurité et décisions de KolBase signalées", () => {
    expect(auditTone("user.signin_failed")).toBe("bad");
    expect(auditTone("admin.2fa_reset")).toBe("bad");
    expect(auditTone("platform.org_verify")).toBe("electric");
    expect(auditTone("event.publish")).toBe("");
  });

  it("liens vers la fiche concernée", () => {
    expect(entityHref("User", "u1")).toBe("/admin/comptes/u1");
    expect(entityHref("Organization", "o1")).toBe("/admin/organisations/o1");
    expect(entityHref("ProjectExpert", "x")).toBeNull();
  });

  it("domaines du journal : préfixes d'actions", () => {
    const secu = JOURNAL_DOMAINS.find((d) => d.value === "securite")!;
    expect(secu.prefixes.some((p) => "user.signin_disabled".startsWith(p))).toBe(true);
    expect(secu.prefixes.some((p) => "admin.account_disable".startsWith(p))).toBe(true);
  });
});

describe("Type d'organisation affiché", () => {
  it("un prestataire est présenté par sa catégorie principale", () => {
    expect(orgKindDisplay({ kind: "PRESTATAIRE", supplierCategories: ["restauration", "salle"] })).toBe("Restauration et traiteur");
    expect(orgKindDisplay({ kind: "PRESTATAIRE", supplierCategories: [] })).toBe("Prestataire");
    expect(orgKindDisplay({ kind: "INDUSTRIEL" })).toBe("Industriel");
  });
});
