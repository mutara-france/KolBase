import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCsv, readTable, readXlsx, TabularError } from "@/lib/tabular";
import { amountCents, cellDate, detectColumns, linkKind, loyalty, matchCompetitor, normName, parseAliases, parseLink, personKey } from "@/lib/intelligence";

describe("lecture des fichiers déposés (CSV, Excel)", () => {
  it("CSV : séparateur deviné, guillemets, retours à la ligne dans un champ, BOM", () => {
    const rows = parseCsv('﻿Entreprise;Montant;Adresse\r\n"DEMO; SAS";"1 200,50";"12 rue A\nBât. ""B"""\r\n\r\nAutre;10;\r\n');
    expect(rows).toEqual([["Entreprise", "Montant", "Adresse"], ["DEMO; SAS", "1 200,50", '12 rue A\nBât. "B"'], ["Autre", "10", ""]]);
    expect(parseCsv("a,b\n1,2")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseCsv("a\tb\n1\t2\n")).toEqual([["a", "b"], ["1", "2"]]);
  });
  it("Excel : première feuille, textes partagés, nombres, dates en numéro de série, lignes vides ignorées", () => {
    const rows = readXlsx(readFileSync("tests/fixtures/transparence-demo.xlsx"));
    expect(rows).toHaveLength(5);
    expect(rows[0][0]).toBe("Entreprise");
    expect(rows[1].slice(0, 2)).toEqual(["DEMO IMPLANTS SAS", "Convention"]);
    expect(cellDate(rows[1][2])?.toISOString().slice(0, 10)).toBe("2026-03-14");
    expect(rows[1][3]).toBe("1500");
    // Caractères échappés dans le XML, cellule vide au milieu de la ligne.
    expect(rows[2][4]).toBe("MARTIN & Fils <test>");
    expect(rows[2][6] ?? "").toBe("");
    expect(rows[4][8] ?? "").toBe("");
  });
  it("format reconnu au contenu ; fichier illisible refusé", () => {
    expect(readTable(readFileSync("tests/fixtures/transparence-demo.xlsx"))[0][1]).toBe("Déclaration");
    expect(readTable(new TextEncoder().encode("a;b\n1;2"))).toEqual([["a", "b"], ["1", "2"]]);
    // CSV enregistré par Excel en Windows-1252.
    expect(readTable(Uint8Array.from([0x45, 0x6e, 0x74, 0x3b, 0xe9, 0x0a, 0x31, 0x3b, 0x32]))[0]).toEqual(["Ent", "é"]);
    expect(() => readTable(Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]))).toThrow(TabularError);
    expect(() => readTable(Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0]))).toThrow(TabularError);
  });
});

describe("KolBase Intelligence : déclarations publiques", () => {
  it("reconnaît les colonnes par mots-clés, quels que soient les libellés de l'export", () => {
    const site = detectColumns(["Entreprise", "Déclaration", "Date de signature / versement", "Montant des conventions / avantages / rémunération", "Identité / Nom", "Prénom", "N° identifiant", "Profession", "Objet convention / nature avantage"]);
    expect(site.missing).toEqual([]);
    expect(site.columns).toMatchObject({ company: 0, kind: 1, date: 2, amount: 3, lastName: 4, firstName: 5, beneficiaryId: 6, category: 7, purpose: 8 });
    const tech = detectColumns(["identifiant_unique", "entreprise_identifiant", "denomination_sociale", "lien_interet", "date", "montant_ttc", "benef_denomination_sociale", "benef_nom", "benef_prenom", "benef_identifiant_valeur", "benef_categorie_libelle", "motif_lien_interet"]);
    expect(tech.missing).toEqual([]);
    expect(tech.columns).toMatchObject({ ref: 0, company: 2, kind: 3, date: 4, amount: 5, lastName: 7, firstName: 8, beneficiaryId: 9, category: 10, purpose: 11 });
    expect(detectColumns(["Nom", "Ville"]).missing).toEqual(["company", "kind", "amount"]);
  });
  it("lit montants, dates et types de lien", () => {
    expect(amountCents("1 234,56")).toBe(123456);
    expect(amountCents("150 €")).toBe(15000);
    expect(amountCents("")).toBeNull();
    expect(amountCents("-5")).toBeNull();
    expect(amountCents("abc")).toBeNull();
    expect(cellDate("14/03/2026")?.toISOString().slice(0, 10)).toBe("2026-03-14");
    expect(cellDate("2026-03-14T00:00:00+01:00")?.toISOString().slice(0, 10)).toBe("2026-03-14");
    expect(cellDate("46095")?.toISOString().slice(0, 10)).toBe("2026-03-14");
    expect(cellDate("31/02/2026")).toBeNull();
    expect(cellDate("bientôt")).toBeNull();
    expect(linkKind("Rémunération")).toBe("remuneration");
    expect(linkKind("CONVENTION")).toBe("convention");
    expect(linkKind("Avantages")).toBe("avantage");
    expect(linkKind("autre")).toBeNull();
  });
  it("transforme une ligne en lien déclaré, avec une empreinte stable", () => {
    const { columns } = detectColumns(["Entreprise", "Déclaration", "Date", "Montant", "Nom", "Prénom", "N° identifiant", "Profession", "Objet"]);
    const row = ["DEMO IMPLANTS SAS", "Convention", "14/03/2026", "1 500,00", "DURAND", "Claire", "100 000 000 01", "Chirurgien-dentiste", "Formation"];
    const link = parseLink(row, columns)!;
    expect(link).toMatchObject({ company: "DEMO IMPLANTS SAS", kind: "convention", amountCents: 150000, beneficiaryId: "10000000001", beneficiaryName: "DURAND Claire", category: "Chirurgien-dentiste", purpose: "Formation" });
    expect(parseLink([...row], columns)!.sourceKey).toBe(link.sourceKey);
    expect(parseLink(row.with(3, "1 600,00"), columns)!.sourceKey).not.toBe(link.sourceKey);
    expect(parseLink(row.with(1, "?"), columns)).toBeNull();
    expect(parseLink(row.with(0, ""), columns)).toBeNull();
    expect(parseLink(["DEMO", "Avantage", "", "12"], columns)).toMatchObject({ date: null, beneficiaryId: null, beneficiaryName: null });
    // Référence de déclaration présente : elle fait l'empreinte, même si le montant est corrigé ensuite.
    const withRef = detectColumns(["Identifiant unique", "Entreprise", "Déclaration", "Montant"]).columns;
    expect(parseLink(["D-1", "DEMO", "Avantage", "12"], withRef)!.sourceKey).toBe(parseLink(["D-1", "DEMO", "Avantage", "15"], withRef)!.sourceKey);
  });
  it("rattache une déclaration à un concurrent suivi, en mots entiers", () => {
    const competitors = [{ name: "Demo Implants", aliases: ["Démo Biomatériaux"] }, { name: "Ortho", aliases: [] }];
    expect(matchCompetitor("DEMO IMPLANTS S.A.S.", competitors)?.name).toBe("Demo Implants");
    expect(matchCompetitor("Groupe Demo Biomateriaux France", competitors)?.name).toBe("Demo Implants");
    expect(matchCompetitor("Orthonova", competitors)).toBeNull();
    expect(matchCompetitor("Ortho SAS", competitors)?.name).toBe("Ortho");
    expect(parseAliases("Marque A, Marque A ; ab\nFiliale B")).toEqual(["Marque A", "Filiale B"]);
    expect(normName("  Éclat-Dentaire (S.A.) ")).toBe("eclat dentaire s a");
    expect(personKey("DURAND Claire")).toBe(personKey("Claire Durand"));
  });
  it("place chaque expert dans le portefeuille de l'année", () => {
    expect(loyalty([2026], 2026)).toBe("nouveau");
    expect(loyalty([2025, 2026], 2026)).toBe("fidele");
    expect(loyalty([2023, 2026], 2026)).toBe("revenu");
    expect(loyalty([2024, 2025], 2026)).toBe("dormant");
    expect(loyalty([2023], 2026)).toBeNull();
  });
});
