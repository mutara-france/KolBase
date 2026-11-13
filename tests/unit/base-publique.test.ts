import { describe, expect, it } from "vitest";
import { CsvStream, marketColumns, median, namedBy, parseMarketRow, peersOf, rankOf, shareTable, sourceDownload, type CompanyYear } from "@/lib/market";
import { marketAdvice, MARKET_RULES, toProtect, toRecruit, type Candidate, type ExpertLine, type MarketAdviceInput } from "@/lib/market-advice";
import { FAMILY_LABEL } from "@/lib/intelligence-advice";
import { EN } from "@/lib/i18n/en";

/** En-têtes de l'export officiel (transparence.sante.gouv.fr), tels que publiés. */
const HEAD = "id;token;entreprise_id;lien_interet;identifiant_unique;convention_liee;motif_lien_interet_code;motif_lien_interet;autre_motif;information_evenement;montant;date;date_debut;date_fin;id_beneficiaire;identite;prenom;beneficiaire_categorie_code;beneficiaire_categorie;beneficiaire_type_code;beneficiaire_type;beneficiaire_identifiant;beneficiaire_profession_code;profession_libelle;structure_exercice;pays_code;adresse;code_postal;ville;demande_de_rectification;statut;date_publication;date_transmission;raison_sociale;numero_siren;secteur_activite;mere_id;Ville de l'entreprise;Département de l'entreprise;Région de l'entreprise;entreprise_nom_pays;code_postal_entreprise;ville_sanscedex;dep_code;reg_code;reg_name;dep_name;beneficiaire_nom_prenom_com_name;semestre_annee;pays_libelle;Nom Pays (Bénéficiaire)";
const ROW = "1;jeton;12;convention;99;;FOR;Formation;;NON-RENSEIGNE;;2021-02-17T01:00:00+01:00;2021-02-17;;635;Claire;Durand;PRS;Professionnel de santé;AUTRE;AUTRE;;40;Chirurgien-dentiste;;FR;1 rue Fictive;45000;ORLÉANS CEDEX;False;Publié;2021-09-01T02:00:00+02:00;2021-02-23;IMPLANTS DÉMO S.A.S.;;Dispositifs médicaux;NULL;Lyon;;;FRANCE;69000;ORLÉANS;45;24;Centre-Val de Loire;Loiret;Claire Durand - ORLÉANS;2021-01-01;FRANCE;FRANCE";

describe("base publique : lien et lecture du fichier", () => {
  it("n'accepte que les liens de partage Google Drive et Google Sheets", () => {
    const id = "1uU7ggzXd-P_9E6eGs745QOjVgKzstDhC";
    expect(sourceDownload(`https://drive.google.com/file/d/${id}/view?usp=sharing`)).toBe(`https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`);
    expect(sourceDownload(`https://drive.google.com/open?id=${id}`)).toContain(`id=${id}`);
    expect(sourceDownload(`https://docs.google.com/spreadsheets/d/${id}/edit#gid=42`)).toBe(`https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=42`);
    expect(sourceDownload(`https://drive.google.com/file/d/${id}/view`, "http://localhost:3998")).toBe(`http://localhost:3998/download?id=${id}&export=download&confirm=t`);
    for (const refused of ["", "pas une adresse", `http://drive.google.com/file/d/${id}/view`, "https://exemple.org/fichier.csv", `https://drive.google.com.exemple.org/file/d/${id}/view`, "https://drive.google.com/file/d/../view", "https://docs.google.com/document/d/abc"]) expect(sourceDownload(refused), refused).toBeNull();
  });
  it("lit un CSV par morceaux : séparateur deviné, guillemets, retours à la ligne dans une cellule, BOM", () => {
    const text = '﻿nom;note;ville\r\n"Durand; Claire";"dit ""Clo""\nsur deux lignes";Lyon\r\n\r\nSeul;;\nDernier;x;y';
    const whole = new CsvStream();
    const expected = [["nom", "note", "ville"], ["Durand; Claire", 'dit "Clo"\nsur deux lignes', "Lyon"], ["Seul", "", ""], ["Dernier", "x", "y"]];
    expect([...whole.push(text), ...whole.end()]).toEqual(expected);
    // Découpé caractère par caractère : même résultat (guillemets et retours à la ligne à cheval sur deux morceaux).
    const split = new CsvStream(), rows: string[][] = [];
    for (const ch of text) rows.push(...split.push(ch));
    expect([...rows, ...split.end()]).toEqual(expected);
    const commas = new CsvStream();
    expect([...commas.push("a,b\n1,2"), ...commas.end()]).toEqual([["a", "b"], ["1", "2"]]);
    // Une seule ligne, sans retour à la ligne ; fichier vide ; cellule démesurée tronquée.
    const one = new CsvStream();
    expect([...one.push("a;b"), ...one.end()]).toEqual([["a", "b"]]);
    expect(new CsvStream().end()).toEqual([]);
    const long = new CsvStream();
    expect([...long.push(`a;b\n${"x".repeat(5000)};1\n`), ...long.end()][1][0]).toHaveLength(2000);
  });
  it("reconnaît les colonnes de l'export officiel et dit celles qui manquent", () => {
    const { columns, missing } = marketColumns(HEAD.split(";"));
    expect(missing).toEqual([]);
    expect(columns).toMatchObject({ company: 33, kind: 3, date: 11, lastName: 15, firstName: 16, amount: 10, sector: 35, purpose: 7, rpps: 21, category: 18, city: 42, postal: 27, dept: 43, region: 45 });
    expect(marketColumns(["Nom", "Ville", "montant"]).missing).toEqual(["raison_sociale", "lien_interet", "date"]);
  });
  it("transforme une ligne en lien publié", () => {
    const { columns } = marketColumns(HEAD.split(";"));
    const row = ROW.split(";");
    expect(parseMarketRow(row, columns, 2026)).toEqual({
      companyKey: "implants demo s a s", company: "IMPLANTS DÉMO S.A.S.", sector: "Dispositifs médicaux", kind: "convention", year: 2021, amountCents: 0, purpose: "Formation",
      personKey: "claire durand|45", nameKey: "claire durand", personName: "Claire Durand", rpps: null, category: "Professionnel de santé", city: "ORLÉANS", region: "Centre-Val de Loire",
    });
    // Nom et prénom inversés d'un déclarant à l'autre : même personne. Autre département : un homonyme.
    expect(parseMarketRow(row.with(15, "DURAND").with(16, "Claire"), columns, 2026)!.personKey).toBe("claire durand|45");
    expect(parseMarketRow(row.with(43, "69"), columns, 2026)!.personKey).toBe("claire durand|69");
    // Département absent : celui du code postal (trois chiffres outre-mer).
    expect(parseMarketRow(row.with(43, ""), columns, 2026)!.personKey).toBe("claire durand|45");
    expect(parseMarketRow(row.with(43, "").with(27, "97400"), columns, 2026)!.personKey).toBe("claire durand|974");
    expect(parseMarketRow(row.with(3, "avantage").with(10, "62,50").with(21, "1000 1234567"), columns, 2026)).toMatchObject({ kind: "avantage", amountCents: 6250, rpps: "10001234567" });
    // Sans entreprise, sans type reconnu, sans date, sans bénéficiaire, ou hors des années publiées : ligne écartée.
    for (const bad of [row.with(33, ""), row.with(3, "?"), row.with(11, ""), row.with(15, "").with(16, ""), row.with(11, "2009-01-01"), row.with(11, "2027-01-01")]) expect(parseMarketRow(bad, columns, 2026)).toBeNull();
  });
});

const company = (name: string, cents: number, sector: string | null = "Dispositifs médicaux", lines = 10, people = 5): CompanyYear => ({ key: name.toLowerCase(), name, sector, cents, lines, people });

describe("base publique : comparaison", () => {
  it("reconnaît une entreprise par l'une de ses écritures, en mots entiers", () => {
    expect(namedBy("DENTALYS IMPLANTS S.A.S.", ["Dentalys Implants"])).toBe(true);
    expect(namedBy("Groupe Démo Biomatériaux France", ["Autre", "démo biomateriaux"])).toBe(true);
    expect(namedBy("Orthonova", ["Ortho"])).toBe(false);
    expect(namedBy("AB Dentaire", ["ab"])).toBe(false);
  });
  it("médiane et rang", () => {
    expect(median([])).toBeNull();
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(rankOf(50, [10, 80, 50, 90])).toBe(3);
    expect(rankOf(0, [10])).toBeNull();
  });
  it("organisations équivalentes : même secteur et taille proche, sinon les cinq plus proches", () => {
    const me = { sector: "Dispositifs médicaux", cents: 100_000, lines: 20 };
    const same = [company("A", 60_000), company("B", 90_000), company("C", 120_000), company("D", 150_000), company("E", 200_000), company("Géant", 9_000_000), company("Nain", 1_000)];
    const others = [...same, company("Hors secteur", 100_000, "Cosmétiques"), company("Muette", 0)];
    const r = peersOf(me, others);
    expect(r).toMatchObject({ sector: "Dispositifs médicaux", by: "montants" });
    expect(r.peers.map((p) => p.name)).toEqual(["A", "B", "C", "D", "E"]);
    // Trop peu d'entreprises de taille proche dans le secteur : les cinq de taille la plus proche.
    expect(peersOf({ ...me, cents: 1_000_000 }, others).peers.map((p) => p.name)).toEqual(["E", "D", "C", "Géant", "B"]);
    // Secteur vague ou trop peu fourni : tous secteurs confondus.
    const wide = peersOf({ ...me, sector: "Autres" }, others);
    expect(wide.sector).toBeNull();
    expect(wide.peers.map((p) => p.name)).toContain("Hors secteur");
    expect(peersOf({ ...me, sector: "Cosmétiques" }, others).sector).toBeNull();
    // Sans montant déclaré : taille mesurée en nombre de liens. Sans aucun lien : pas d'équivalente.
    expect(peersOf({ sector: null, cents: 0, lines: 10 }, others)).toMatchObject({ by: "liens" });
    expect(peersOf({ sector: null, cents: 0, lines: 10 }, others).peers).toHaveLength(9);
    expect(peersOf({ sector: null, cents: 0, lines: 0 }, others).peers).toEqual([]);
  });
  it("répartition comparée, en montants ou en nombre de liens", () => {
    const t = shareTable([{ label: "Formation", cents: 700, lines: 2 }, { label: "Hospitalité", cents: 300, lines: 8 }], [{ label: "Orateur", cents: 500, lines: 5 }, { label: "Formation", cents: 500, lines: 5 }, { label: "Poussière", cents: 1, lines: 0 }], [{ label: "Orateur", cents: 900, lines: 9 }, { label: "Formation", cents: 100, lines: 1 }]);
    expect(t.by).toBe("montants");
    expect(t.rows.map((r) => r.label)).toEqual(["Formation", "Orateur", "Hospitalité"]);
    expect(t.rows[0]).toMatchObject({ me: 0.7, market: 0.1 });
    expect(t.rows[0].peers).toBeCloseTo(0.4995, 3);
    const byLines = shareTable([{ label: "Formation", cents: 0, lines: 1 }, { label: "Orateur", cents: 0, lines: 3 }], [], []);
    expect(byLines).toMatchObject({ by: "liens", rows: [{ label: "Orateur", me: 0.75 }, { label: "Formation", me: 0.25 }] });
  });
});

const line = (name: string, cents: number, others: { company: string; cents: number; compared?: boolean }[] = [], othersPrevCents = 0): ExpertLine => ({
  key: name, name, city: "Lyon", cents, lines: 1, othersCents: others.reduce((s, o) => s + o.cents, 0), othersLines: others.length, othersPrevCents,
  others: others.map((o) => ({ company: o.company, cents: o.cents, lines: 1, compared: !!o.compared })),
});
const candidate = (name: string, c: Partial<Candidate> = {}): Candidate => ({ key: name, name, city: null, region: null, companies: 1, compared: 0, cents: 100_000, lines: 1, recent: 1, purpose: "Orateur", ...c });
/** Organisation reconnue, dans la moyenne de ses équivalentes : rien à signaler. */
const base = (): MarketAdviceInput => ({
  year: 2025, found: true,
  me: { cents: 1_000_000, prevCents: 950_000, people: 20, rank: 12, top5Share: 0.4, exclusive: 5 },
  market: { cents: 50_000_000, prevCents: 48_000_000, companies: 40 },
  peers: { count: 6, cents: 1_100_000, people: 22, perExpert: 50_000 },
  purposes: { by: "montants", rows: [{ label: "Formation", me: 0.5, peers: 0.45, market: 0.4 }, { label: "Orateur", me: 0.5, peers: 0.55, market: 0.6 }] },
  regions: { by: "montants", rows: [{ label: "Île-de-France", me: 0.6, peers: 0.5, market: 0.4 }, { label: "Occitanie", me: 0.4, peers: 0.5, market: 0.2 }] },
  protect: [], recruit: [],
});
const keys = (i: MarketAdviceInput) => marketAdvice(i).map((a) => a.key);

describe("base publique : moteur de recommandation", () => {
  it("experts à protéger : une autre entreprise verse plus, ses montants montent, ou une comparée l'engage", () => {
    const list = toProtect([
      line("Exclusif", 500_000),
      line("Dépassé", 100_000, [{ company: "Rival", cents: 300_000 }]),
      line("Courtisé", 400_000, [{ company: "Rival", cents: 130_000 }], 100_000),
      line("Comparé", 400_000, [{ company: "Équivalente", cents: 50_000, compared: true }], 50_000),
      line("Tranquille", 400_000, [{ company: "Lointaine", cents: 50_000 }], 50_000),
    ]);
    expect(list.map((e) => [e.name, e.reason])).toEqual([["Dépassé", "depasse"], ["Courtisé", "hausse"], ["Comparé", "compare"]]);
    // Sans montant de part et d'autre (conventions seules) : comparaison en nombre de liens.
    const bare = { ...line("Conventions", 0, [{ company: "Rival", cents: 0 }, { company: "Autre", cents: 0 }]) };
    expect(toProtect([bare])[0].reason).toBe("depasse");
    expect(MARKET_RULES.courted).toBe(0.3);
  });
  it("experts à recruter : d'abord ceux qu'engagent les organisations comparées", () => {
    const list = toRecruit([candidate("Isolé"), candidate("Multi", { companies: 4 }), candidate("Comparé", { compared: 2, companies: 3 }), candidate("Ancien", { compared: 1, companies: 2, recent: 0 }), candidate("Actif", { lines: 10 })], 4);
    expect(list.map((c) => c.name)).toEqual(["Comparé", "Multi", "Ancien", "Actif"]);
    expect(list[0].score).toBe(3 * 2 + 2 * 3 + 2 + 0.2);
  });
  it("rien à signaler pour une organisation dans la moyenne ; non reconnue, on lui demande son nom", () => {
    expect(marketAdvice(base())).toEqual([]);
    const unknown = { ...base(), found: false, recruit: [candidate("A", { companies: 3 }), candidate("B", { companies: 2 })] };
    expect(keys(unknown)).toEqual(["introuvable", "a-recruter"]);
    expect(marketAdvice(unknown)[1]).toMatchObject({ family: "recruter", vars: { n: 2, names: "A, B" } });
  });
  it("experts : à protéger d'abord, à recruter ensuite", () => {
    const i = base();
    i.protect = toProtect([line("Dépassé", 100_000, [{ company: "Rival", cents: 300_000 }]), line("Comparé", 400_000, [{ company: "Équivalente", cents: 50_000, compared: true }], 50_000)]);
    i.recruit = [candidate("Cible", { compared: 1 }), candidate("Multi", { companies: 3 })];
    const list = marketAdvice(i);
    expect(list.map((a) => a.key)).toEqual(["a-proteger", "a-recruter"]);
    expect(list[0]).toMatchObject({ level: 1, tone: "danger", family: "proteger", vars: { n: 1, names: "Dépassé", company: "Rival" } });
    expect(list[1]).toMatchObject({ family: "recruter", vars: { n: 1, names: "Cible" } });
    // Aucun expert exposé, mais partagés avec une organisation comparée : à surveiller.
    i.protect = toProtect([line("Comparé", 400_000, [{ company: "Équivalente", cents: 50_000, compared: true }], 50_000)]);
    expect(marketAdvice(i)[0]).toMatchObject({ key: "a-surveiller", level: 2 });
  });
  it("budget : place sur le marché, motif, région, concentration, montant moyen", () => {
    const i = base();
    i.me.prevCents = 1_200_000;
    expect(marketAdvice(i)[0]).toMatchObject({ key: "part-recule", level: 1, family: "budget", vars: { mine: "−17", theirs: "+4" } });
    i.me.prevCents = 700_000;
    expect(marketAdvice(i)[0]).toMatchObject({ key: "part-progresse", tone: "ok", family: "force", vars: { mine: "+43" } });
    const j = base();
    j.purposes.rows = [{ label: "Formation", me: 0.8, peers: 0.3, market: 0.4 }, { label: "Orateur", me: 0.2, peers: 0.7, market: 0.6 }];
    j.regions.rows = [{ label: "Île-de-France", me: 0.95, peers: 0.5, market: 0.4 }, { label: "Occitanie", me: 0.05, peers: 0.3, market: 0.2 }, { label: "Corse", me: 0, peers: 0.05, market: 0.1 }];
    j.me = { ...j.me, top5Share: 0.7 };
    expect(keys(j)).toEqual(["motif-sous-investi", "region-absente", "budget-concentre", "motif-sur-investi"]);
    expect(marketAdvice(j)[0].vars).toMatchObject({ label: "Orateur", me: 20, peers: 70 });
    expect(marketAdvice(j)[1].vars).toMatchObject({ label: "Occitanie", me: 5, peers: 30 });
    // Répartition en nombre de liens (aucun montant) : pas de conseil de budget par motif.
    j.purposes.by = "liens";
    expect(keys(j)).toEqual(["region-absente", "budget-concentre"]);
    const k = base();
    k.me = { ...k.me, people: 4 };
    expect(marketAdvice(k)[0]).toMatchObject({ key: "moyenne-haute", vars: { ratio: "5,0" } });
    k.me = { ...k.me, people: 100 };
    expect(marketAdvice(k)[0]).toMatchObject({ key: "moyenne-basse", vars: { ratio: "5,0" } });
  });
  it("points forts : rang et experts exclusifs ; chaque texte a sa traduction", () => {
    const i = base();
    i.me = { ...i.me, rank: 2, exclusive: 12 };
    expect(keys(i)).toEqual(["rang", "exclusifs"]);
    expect(marketAdvice(i)[1].vars).toMatchObject({ share: 60, n: 12, total: 20 });
    const j = base();
    j.me = { ...j.me, prevCents: 1_200_000, top5Share: 0.7, people: 100 };
    j.purposes.rows = [{ label: "Formation", me: 0.8, peers: 0.3, market: 0.4 }, { label: "Orateur", me: 0.2, peers: 0.7, market: 0.6 }];
    j.regions.rows = [{ label: "Occitanie", me: 0.05, peers: 0.3, market: 0.2 }];
    j.protect = toProtect([line("Dépassé", 100_000, [{ company: "Rival", cents: 300_000 }])]);
    j.recruit = [candidate("Cible", { compared: 1 }), candidate("Autre", { compared: 1 })];
    const k = base();
    k.me = { ...k.me, prevCents: 700_000, people: 4 };
    k.protect = toProtect([line("Comparé", 400_000, [{ company: "Équivalente", cents: 50_000, compared: true }], 50_000), line("Autre", 400_000, [{ company: "Équivalente", cents: 50_000, compared: true }], 50_000)]);
    k.recruit = [candidate("Multi", { companies: 3 })];
    const l = { ...base(), found: false, recruit: [candidate("A", { companies: 3 }), candidate("B", { companies: 2 })], protect: toProtect([line("Dépassé", 100_000, [{ company: "Rival", cents: 300_000 }]), line("Aussi", 100_000, [{ company: "Rival", cents: 300_000 }])]) };
    const all = [i, j, k, l].flatMap(marketAdvice);
    expect(new Set(all.map((a) => a.key)).size).toBeGreaterThanOrEqual(13);
    for (const a of all) for (const text of [a.title, a.detail, FAMILY_LABEL[a.family]]) expect(EN[text], text).toBeTruthy();
    expect(all.map((a) => a.level)).toEqual(expect.arrayContaining([1, 2, 3]));
  });
});
