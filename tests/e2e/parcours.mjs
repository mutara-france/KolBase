// Parcours de bout en bout sur les données de démo (droits, visibilité, connexion).
// Prérequis : base migrée et chargée (npm run db:seed avec DEMO_PASSWORD), application lancée.
// Usage : BASE=http://localhost:3000 DEMO_PASSWORD=… DATABASE_URL=… npm run test:e2e
import { chromium } from "playwright";
import pg from "pg";
import { createHmac } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { mails, signatureRequests, startFakes } from "./faux-services.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const PW = process.env.DEMO_PASSWORD;
if (!PW || !process.env.DATABASE_URL) throw new Error("DEMO_PASSWORD et DATABASE_URL sont nécessaires.");

// Cas de test : une praticienne a masqué ses coordonnées et son activité.
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
await client.query(`UPDATE "PractitionerProfile" SET visibility = '{"contact":"masque","historique":"masque"}' WHERE id = 'demo-p-durand'`);
await client.end();
const stopFakes = startFakes();
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? " — " + detail : ""}`); };

const browser = await chromium.launch();

async function session() {
  const ctx = await browser.newContext({ locale: "fr-FR" });
  return { ctx, page: await ctx.newPage() };
}
async function login(page, email, password = PW, next = "") {
  await page.goto(`${BASE}/connexion${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await Promise.all([page.waitForLoadState("networkidle"), page.click('button:has-text("Se connecter")')]);
  await page.waitForTimeout(800);
}
const text = (page) => page.locator("main").innerText();
/** Attend un e-mail (envoyé après la réponse du serveur) correspondant au destinataire et au sujet. */
async function waitMail(to, subject, timeout = 8000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const m = mails.find((x) => x.to === to && (typeof subject === "string" ? x.subject.includes(subject) : subject.test(x.subject)));
    if (m) return m;
    await new Promise((r) => setTimeout(r, 200));
  }
  return null;
}
const linkIn = (mail) => mail?.text.match(/https?:\/\/\S+/g)?.find((u) => !u.endsWith("/compte")) ?? null;

// ── 3. Visibilité : liste publique ──────────────────────────────────────────
{
  const { ctx, page } = await session();
  await page.goto(`${BASE}/experts`);
  const card = page.locator('a.kol-card[href="/experts/demo-p-durand"]');
  const t = await card.innerText();
  check("Liste publique : ville masquée absente de la carte", !t.includes("Lyon") && !t.includes("Hospices"), t.replace(/\s+/g, " ").slice(0, 120));
  check("Liste publique : nombre de collaborations masqué", !/collaboration|Nouveau sur KolBase/.test(t));
  const other = await page.locator('a.kol-card[href="/experts/demo-p-martin"]').innerText();
  check("Liste publique : ville visible pour un profil public", other.includes("Paris"));
  await page.goto(`${BASE}/experts?ville=Lyon`);
  check("Recherche publique par ville : profil masqué exclu", (await page.locator('a.kol-card[href="/experts/demo-p-durand"]').count()) === 0);
  await page.goto(`${BASE}/experts/demo-p-martin`);
  const anon = await text(page);
  check("Fiche expert anonyme : tarif réservé aux organisations", anon.includes("Tarif indicatif : réservé aux organisations inscrites") && !anon.includes("Tarif journalier indicatif"));
  await ctx.close();
}

// ── 3. Visibilité : praticien connecté sans organisation ───────────────────
{
  const { ctx, page } = await session();
  await login(page, "ines.lambert@demo.kolbase.local");
  await page.goto(`${BASE}/experts/demo-p-martin`);
  const t = await text(page);
  check("Praticien connecté (sans organisation) : tarif non visible", !t.includes("Tarif journalier indicatif") && t.includes("réservé aux organisations inscrites"));
  check("Praticien connecté : pas de lien « Se connecter » dans les mentions", !/réservé aux organisations inscrites\.\s*Se connecter/.test(t));
  await ctx.close();
}

// ── 3. Visibilité : membre d'organisation ──────────────────────────────────
{
  const { ctx, page } = await session();
  await login(page, "claire.morel@demo.kolbase.local");
  await page.goto(`${BASE}/experts/demo-p-martin`);
  check("Membre d'organisation : tarif visible", (await text(page)).includes("Tarif journalier indicatif"));
  await page.goto(`${BASE}/experts/demo-p-durand`);
  const d = await text(page);
  check("Membre d'organisation : coordonnées masquées restent masquées", !d.includes("Hospices"));
  await page.goto(`${BASE}/annuaire?ville=Lyon`);
  check("Annuaire : recherche par ville masquée n'expose pas le profil", (await page.locator('a[href="/experts/demo-p-durand"]').count()) === 0);
  await page.goto(`${BASE}/annuaire?q=Hospices`);
  check("Annuaire : recherche sur l'établissement masqué n'expose pas le profil", (await page.locator('a[href="/experts/demo-p-durand"]').count()) === 0);
  await page.goto(`${BASE}/annuaire?q=Implantologie`);
  check("Annuaire : le profil reste trouvable par ses champs visibles", (await page.locator('a[href="/experts/demo-p-durand"]').count()) === 1);
  await page.goto(`${BASE}/organisations/demo-org-dentalys/dossiers/nouveau`);
  const html = await page.content();
  check("Nouveau dossier : la ville masquée n'est pas envoyée au navigateur", !/Durand[^<]{0,80}Lyon/.test(html));
  await ctx.close();
}

// ── 2. Admin d'une organisation prestataire ────────────────────────────────
{
  const { ctx, page } = await session();
  await login(page, "karim.benali@demo.kolbase.local");
  await page.goto(`${BASE}/organisations/demo-org-mediane/membres`);
  const options = await page.locator('select[name="role"] option').allInnerTexts();
  check("Prestataire : rôles d'invitation limités", JSON.stringify(options) === JSON.stringify(["Administrateur", "Membre de l'équipe"]), options.join(", "));
  check("Prestataire : rôle par défaut non administrateur", (await page.locator('select[name="role"]').inputValue()) === "PRESTATAIRE");
  await page.fill('form:has(h2:has-text("Inviter un membre")) input[name="email"]', "nouvelle.recrue@exemple.fr");
  await page.click('button:has-text("Générer le lien")');
  await page.waitForSelector(".copy input", { timeout: 10000 }).catch(() => {});
  const link = await page.locator(".copy input").inputValue().catch(() => "");
  check("Prestataire : l'admin peut générer une invitation", link.includes("/invitation/"), link);
  const invitationMail = await waitMail("nouvelle.recrue@exemple.fr", "vous invite à rejoindre Agence Médiane");
  check("Invitation envoyée par e-mail avec le lien", linkIn(invitationMail) === link, linkIn(invitationMail) ?? "aucun e-mail");
  await page.goto(`${BASE}/organisations/demo-org-mediane/membres?onglet=organisation`);
  await page.fill('form:has(h2:has-text("Fiche de l")) input[name="sector"]', "Logistique événementielle et congrès");
  await page.click('form:has(h2:has-text("Fiche de l")) button:has-text("Enregistrer")');
  await page.waitForTimeout(1500);
  check("Prestataire : l'admin peut modifier la fiche", (await text(page)).includes("Organisation mise à jour."), page.url());
  check("Prestataire : pas de formulaire de page publique (géré sur la page devis)", (await page.locator('h2:has-text("Page publique")').count()) === 0);
  // L'invité accepte : il devient membre de l'équipe.
  const { ctx: c2, page: p2 } = await session();
  await login(p2, "ines.lambert@demo.kolbase.local");
  await p2.goto(link);
  check("Invitation : rôle affiché « Membre de l'équipe »", (await text(p2)).includes("Membre de l'équipe"));
  check("Invitation nominative : refusée à un autre compte", (await text(p2)).includes("Cette invitation est destinée à nouvelle.recrue@exemple.fr") && (await p2.locator('button:has-text("Accepter l\'invitation")').count()) === 0);
  await c2.close();
  await ctx.close();
}

// ── 2. Non-régression : un client garde ses espaces, un prestataire n'y accède pas ──
{
  const { ctx, page } = await session();
  await login(page, "karim.benali@demo.kolbase.local");
  await page.goto(`${BASE}/organisations/demo-org-mediane/dossiers`);
  check("Prestataire : toujours redirigé hors des dossiers", page.url().endsWith("/organisations/demo-org-mediane"), page.url());
  await ctx.close();
}

// ── 4. Redirection ouverte ─────────────────────────────────────────────────
{
  const { ctx, page } = await session();
  await login(page, "claire.morel@demo.kolbase.local", PW, "/\\evil.example");
  check("Connexion avec next=/\\evil.example : reste sur KolBase", page.url().startsWith(BASE + "/") && !page.url().includes("evil"), page.url());
  await ctx.close();
  const s2 = await session();
  await login(s2.page, "julien.faure@demo.kolbase.local", PW, "/annuaire?q=implant");
  check("Connexion avec next interne : redirection conservée", s2.page.url() === `${BASE}/annuaire?q=implant`, s2.page.url());
  await s2.ctx.close();
}

// ── Dossiers : les honoraires d'une candidature retenue sont proposés à l'expert ─────────
{
  const { ctx, page } = await session();
  await login(page, "anne.chevalier@demo.kolbase.local");
  await page.goto(`${BASE}/organisations/demo-org-academie/opportunites/demo-call-tp-cfao`);
  await page.click('button:has-text("Retenir…")');
  await page.fill('input[name="units"]', "2");
  await page.fill('input[name="fee"]', "4000");
  await Promise.all([page.waitForURL(/\/dossiers\//), page.click('button:has-text("Proposer ces honoraires")')]);
  const dossier = await text(page);
  check("Candidature retenue : dossier en attente de l'expert", dossier.includes("En attente des experts") && dossier.includes("Réponse attendue"));
  check("Candidature retenue : pas de convention avant accord", (await page.locator('a:has-text("Convention (PDF)")').count()) === 0);
  const feeMail = await waitMail("olivier.girard@demo.kolbase.local", "vous propose des honoraires");
  check("E-mail à l'expert : proposition d'honoraires", !!feeMail && /4\s000\s€/.test(feeMail.text), feeMail?.subject ?? "aucun e-mail");
  await ctx.close();
}
{
  const { ctx, page } = await session();
  await login(page, "olivier.girard@demo.kolbase.local");
  await page.goto(`${BASE}/opportunites/demo-call-tp-cfao`);
  check("Expert : la candidature indique une proposition à accepter", (await text(page)).includes("vous propose des honoraires"));
  await page.goto(`${BASE}/sollicitations`);
  await Promise.all([page.waitForURL(/\/sollicitations\/[^/]+$/), page.click('a:has-text("Formateur TP CFAO")')]);
  const t = await text(page);
  check("Expert : honoraires proposés visibles avant de répondre", /4\s000\s€/.test(t) && t.includes("Votre réponse"), t.match(/Honoraires proposés[^\n]*\n?[^\n]*/)?.[0]);
  await page.click('button:has-text("Donner mon accord de principe")');
  await page.waitForTimeout(1200);
  await page.reload();
  check("Expert : après accord, la convention devient disponible", (await page.locator('a:has-text("Projet de convention")').count()) === 1);
  check("E-mail à l'organisation : accord de principe", !!(await waitMail("anne.chevalier@demo.kolbase.local", "a donné son accord de principe")));
  // Message de l'expert → e-mail à l'organisation ; puis l'expert coupe les notifications.
  await page.fill('textarea[name="body"]', "Bonjour, je confirme mes disponibilités.");
  await page.click('button:has-text("Envoyer")');
  check("E-mail à l'organisation : nouveau message de l'expert", !!(await waitMail("anne.chevalier@demo.kolbase.local", "Nouveau message de Dr Olivier Girard")));
  const dossierUrl = page.url();
  await page.goto(`${BASE}/compte`);
  await page.uncheck('form:has(h2:has-text("Notifications")) input[name="email"]');
  await page.click('form:has(h2:has-text("Notifications")) button:has-text("Enregistrer")');
  await page.waitForTimeout(1000);
  check("Préférence : notifications par e-mail coupées", (await text(page)).includes("Vous ne recevrez plus de notifications"));
  await ctx.close();
}

// L'organisation écrit à l'expert, qui a coupé ses notifications : pas d'e-mail.
{
  const { ctx, page } = await session();
  await login(page, "anne.chevalier@demo.kolbase.local");
  await page.goto(`${BASE}/organisations/demo-org-academie/dossiers`);
  await Promise.all([page.waitForURL(/\/dossiers\/[^/]+$/), page.click('a:has-text("Formateur TP CFAO")')]);
  await page.fill('textarea[name="body"]', "Merci, nous vous envoyons la convention.");
  await page.click('button:has-text("Envoyer")');
  check("Notifications coupées : pas d'e-mail à l'expert", !(await waitMail("olivier.girard@demo.kolbase.local", "Nouveau message de Académie", 4000)));
  await ctx.close();
}

// ── Documents des dossiers : convention signée exigée, accès contrôlé ───────
{
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n");
  const { ctx, page } = await session();
  await login(page, "anne.chevalier@demo.kolbase.local");
  const dossier = `${BASE}/organisations/demo-org-academie/dossiers/demo-prj-formation`;
  await page.goto(dossier);
  let t = await text(page);
  check("Signature : « Convention signée » attend la convention de l'expert", (await page.locator('button:has-text("Convention signée")').count()) === 0 && t.includes("Déposez la convention signée de Dr Mathieu Roux"));
  const upload = 'form:has(input[name="file"])';
  await page.selectOption(`${upload} select[name="kind"]`, "CONVENTION_SIGNEE");
  await page.setInputFiles(`${upload} input[name="file"]`, { name: "faux.pdf", mimeType: "application/pdf", buffer: Buffer.from("pas un pdf") });
  await page.click(`${upload} button:has-text("Déposer")`);
  await page.waitForTimeout(1200);
  check("Dépôt : faux PDF refusé", (await text(page)).includes("n'est pas un PDF valide"));
  await page.selectOption(`${upload} select[name="kind"]`, "CONVENTION_SIGNEE");
  await page.setInputFiles(`${upload} input[name="file"]`, { name: "convention-roux-signée.pdf", mimeType: "application/pdf", buffer: pdf });
  await page.click(`${upload} button:has-text("Déposer")`);
  await page.waitForTimeout(1200);
  check("Dépôt : convention signée sans expert refusée", (await text(page)).includes("Indiquez l'expert signataire"));
  await page.selectOption(`${upload} select[name="kind"]`, "CONVENTION_SIGNEE");
  const roux = await page.locator(`${upload} select[name="linkId"] option`, { hasText: "Roux" }).getAttribute("value");
  await page.selectOption(`${upload} select[name="linkId"]`, roux);
  await page.setInputFiles(`${upload} input[name="file"]`, { name: "convention-roux-signée.pdf", mimeType: "application/pdf", buffer: pdf });
  await page.click(`${upload} button:has-text("Déposer")`);
  await page.waitForTimeout(1500);
  await page.reload();
  t = await text(page);
  check("Dépôt : convention signée enregistrée", t.includes("convention-roux-signée.pdf") && t.includes("Convention signée · Dr Mathieu Roux"));
  const href = await page.locator('a:has-text("convention-roux-signée.pdf")').getAttribute("href");
  const dl = await page.request.get(`${BASE}${href}`);
  check("Téléchargement : fichier identique, en pièce jointe", dl.ok() && Buffer.compare(await dl.body(), pdf) === 0 && (dl.headers()["content-disposition"] ?? "").startsWith("attachment"));
  check("Signature : « Convention signée » disponible une fois la convention déposée", (await page.locator('button:has-text("Convention signée")').count()) === 1);

  const other = await session();
  await login(other.page, "julien.faure@demo.kolbase.local");
  const forbidden = await other.page.request.get(`${BASE}${href}`);
  check("Téléchargement : refusé à une autre organisation", forbidden.status() === 404, String(forbidden.status()));
  await other.ctx.close();

  const expert = await session();
  await login(expert.page, "mathieu.roux@demo.kolbase.local");
  await expert.page.goto(`${BASE}/sollicitations`);
  await Promise.all([expert.page.waitForURL(/\/sollicitations\/[^/]+$/), expert.page.click('a:has-text("Formation DPC endodontie")')]);
  check("Expert : voit sa convention signée", (await text(expert.page)).includes("convention-roux-signée.pdf"));
  const own = await expert.page.request.get(`${BASE}${href}`);
  check("Expert : peut la télécharger", own.ok());
  await expert.page.setInputFiles('form:has(input[name="file"]) input[name="file"]', { name: "programme-tp.pdf", mimeType: "application/pdf", buffer: pdf });
  await expert.page.click('form:has(input[name="file"]) button:has-text("Déposer")');
  await expert.page.waitForTimeout(1500);
  check("Expert : dépôt d'une pièce", (await text(expert.page)).includes("Document déposé"));
  await expert.ctx.close();

  await page.reload();
  check("Organisation : voit la pièce déposée par l'expert", (await text(page)).includes("programme-tp.pdf"));
  await page.click('button:has-text("Convention signée")');
  await page.waitForTimeout(1500);
  await page.reload();
  const signed = await page.locator('li:has-text("convention-roux-signée.pdf")').innerText();
  check("Dossier signé : la convention signée ne peut plus être retirée", !signed.includes("Retirer") && (await text(page)).includes("Signé"));
  await ctx.close();
}

// ── Signature électronique (faux Yousign) : envoi, refus, nouvel envoi, webhook signé ─────
{
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  await db.query(`insert into "Project" (id, "organizationId", title, "typeId", status, "updatedAt") values ('e2e-prj-esign', 'demo-org-academie', 'Formation signée électroniquement', 'dpc', 'SIGNATURE', now()) on conflict do nothing`);
  await db.query(`insert into "ProjectExpert" (id, "projectId", "practitionerId", status, "feeCents", days) values ('e2e-link-esign', 'e2e-prj-esign', 'demo-p-roux', 'SIGNATURE', 150000, 1) on conflict do nothing`);
  const { ctx, page } = await session();
  await login(page, "anne.chevalier@demo.kolbase.local");
  const dossier = `${BASE}/organisations/demo-org-academie/dossiers/e2e-prj-esign`;
  await page.goto(dossier);
  const send = page.locator('button:has-text("signature électronique")');
  check("Signature électronique : envoi proposé (YOUSIGN_* et faux Yousign du port 3995)", (await send.count()) === 1);
  if ((await send.count()) === 1) {
    await send.click();
    await page.waitForSelector('.pill:has-text("En cours de signature")', { timeout: 20000 }).catch(() => {});
    check("Signature électronique : convention envoyée", (await text(page)).includes("Yousign a écrit à chaque signataire"));
    const first = [...signatureRequests.values()].find((r) => r.body.external_id === "e2e-link-esign");
    const pages = first?.pdf ? (await PDFDocument.load(first.pdf)).getPageCount() : 0;
    const [org, exp] = first?.signers ?? [];
    check("Yousign : demande activée avec la convention et deux signataires",
      first?.status === "ongoing" && pages > 0 && org?.info.email === "anne.chevalier@demo.kolbase.local" && exp?.info.email === "mathieu.roux@demo.kolbase.local" && org.signature_level === "electronic_signature");
    check("Yousign : un champ de signature par signataire, côte à côte sur la dernière page",
      org?.fields?.[0]?.page === pages && exp?.fields?.[0]?.page === pages && org.fields[0].x < exp.fields[0].x && org.fields[0].y === exp.fields[0].y, JSON.stringify([org?.fields, exp?.fields, pages]));

    // Refus constaté par « Mettre à jour le statut » (sans webhook), puis nouvel envoi.
    first.status = "declined";
    first.decline_information = { reason: "Honoraires à revoir", signer_id: exp?.id };
    await page.reload();
    await page.click('button:has-text("Mettre à jour le statut")');
    await page.waitForTimeout(1500);
    await page.reload();
    let t = await text(page);
    check("Mise à jour du statut : refus et motif affichés", t.includes("Signature refusée") && t.includes("Honoraires à revoir"));
    await page.click('button:has-text("Envoyer de nouveau en signature électronique")');
    await page.waitForSelector('.pill:has-text("En cours de signature")', { timeout: 20000 }).catch(() => {});
    const second = [...signatureRequests.values()].filter((r) => r.body.external_id === "e2e-link-esign").at(-1);
    check("Nouvel envoi : nouvelle demande Yousign", !!second && second.id !== first.id && second.status === "ongoing");

    const expert = await session();
    await login(expert.page, "mathieu.roux@demo.kolbase.local");
    await expert.page.goto(`${BASE}/sollicitations/e2e-link-esign`);
    check("Expert : convention en attente de sa signature", (await text(expert.page)).includes("Convention en attente de votre signature"));

    // Webhook : signature HMAC exigée, identifiants inconnus ignorés, traitement idempotent.
    const hook = (body, sig) => fetch(`${BASE}/api/signature/webhook`, { method: "POST", headers: { "Content-Type": "application/json", "X-Yousign-Signature-256": sig }, body });
    const hmac = (b) => `sha256=${createHmac("sha256", "test").update(b).digest("hex")}`;
    const event = (id) => JSON.stringify({ event_id: `evt-${id}`, event_name: "signature_request.done", event_time: String(Math.floor(Date.now() / 1000)), sandbox: false, data: { signature_request: { id, status: "done", completed_at: new Date().toISOString() } } });
    check("Webhook : signature invalide refusée", (await hook(event(second.id), "sha256=00")).status === 401);
    const signed = (b) => hook(b, hmac(b));
    const unknown = await signed(event("inconnu"));
    check("Webhook : demande inconnue ignorée (200)", unknown.status === 200 && (await unknown.json()).ignored === true);
    check("Webhook : ancienne demande remplacée ignorée", (await (await signed(event(first.id))).json()).ignored === true);
    second.status = "done";
    second.completed_at = new Date().toISOString();
    const done = event(second.id);
    const [r1, r2] = [await signed(done), await signed(done)];
    check("Webhook : signature achevée acceptée (et rejouée sans erreur)", r1.status === 200 && r2.status === 200);
    for (let i = 0; i < 20 && !(await text(page)).includes("Signée électroniquement"); i++) { await page.waitForTimeout(500); await page.reload(); }
    t = await text(page);
    check("Dossier : convention signée électroniquement", t.includes("Signée électroniquement") && t.includes("Signée par les deux parties"));
    check("Documents : convention signée rangée une seule fois", (await page.locator('li:has-text("convention-signee-")').count()) === 1, String(await page.locator('li:has-text("convention-signee-")').count()));
    check("Signature électronique : « Convention signée » devient possible", (await page.locator('button:has-text("Convention signée")').count()) === 1);
    const dl = await page.request.get(`${BASE}/signatures/e2e-link-esign`);
    const pdf = await dl.body();
    check("Téléchargement de la convention signée (organisation)", dl.ok() && pdf.subarray(0, 5).toString() === "%PDF-" && pdf.includes("faux Yousign"), String(dl.status()));
    await expert.page.reload();
    check("Expert : convention signée affichée", (await text(expert.page)).includes("Convention signée électroniquement par les deux parties"));
    check("Expert : téléchargement de sa convention signée", (await expert.page.request.get(`${BASE}/signatures/e2e-link-esign`)).ok());
    await expert.ctx.close();
    const other = await session();
    await login(other.page, "julien.faure@demo.kolbase.local");
    check("Convention signée : refusée à une autre organisation", (await other.page.request.get(`${BASE}/signatures/e2e-link-esign`)).status() === 404);
    await other.ctx.close();
  }
  await db.query(`delete from "Project" where id = 'e2e-prj-esign'`);
  await db.end();
  await ctx.close();
}

// ── Conformité : au-delà des seuils, pas de déclaration simple ─────────────
{
  const { ctx, page } = await session();
  await login(page, "sophie.bernard@demo.kolbase.local");
  await page.goto(`${BASE}/organisations/demo-org-dentalys/dossiers/demo-prj-symposium`);
  await page.click('button:has-text("Valider")');
  await page.waitForTimeout(1200);
  await ctx.close();
  const s2 = await session();
  await login(s2.page, "julien.faure@demo.kolbase.local");
  await s2.page.goto(`${BASE}/organisations/demo-org-dentalys/dossiers/demo-prj-symposium`);
  const t = await text(s2.page);
  check("Dossier à 3 000 € validé : régime d'autorisation", t.includes("Autorisation") && t.includes("Demander l'autorisation à l'Ordre"));
  check("Dossier à 3 000 € : déclaration simple non proposée", !t.includes("Déclaration simple"));
  await s2.ctx.close();
}

// ── Praticiens exerçant hors de France ─────────────────────────────────────
{
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  // Une praticienne passe en exercice en Belgique : identifiant INAMI au lieu du RPPS.
  const ines = await session();
  await login(ines.page, "ines.lambert@demo.kolbase.local");
  await ines.page.goto(`${BASE}/compte`);
  const infos = 'form:has(h2:has-text("Informations personnelles"))';
  await ines.page.selectOption(`${infos} select[name="country"]`, "BE");
  check("Belgique : le RPPS laisse place au numéro INAMI", (await ines.page.locator(`${infos} input[name="licenseNumber"]`).count()) === 1 && (await ines.page.locator(`${infos} input[name="rpps"]`).count()) === 0);
  await ines.page.fill(`${infos} input[name="licenseNumber"]`, "1234");
  await ines.page.click(`${infos} button:has-text("Enregistrer")`);
  await ines.page.waitForTimeout(1000);
  check("INAMI mal formé refusé", (await text(ines.page)).includes("Numéro INAMI invalide"));
  await ines.page.selectOption(`${infos} select[name="country"]`, "BE");
  await ines.page.fill(`${infos} input[name="licenseNumber"]`, "3 12345 67 890");
  await ines.page.click(`${infos} button:has-text("Enregistrer")`);
  await ines.page.waitForTimeout(1200);
  const row = (await db.query(`SELECT country, "licenseNumber", rpps FROM "PractitionerProfile" WHERE id = 'demo-p-lambert'`)).rows[0];
  check("INAMI enregistré, pays d'exercice Belgique", row.country === "BE" && row.licenseNumber === "31234567890" && row.rpps === null, JSON.stringify(row));
  await ines.page.click('button:has-text("Me référencer comme expert")');
  await ines.page.waitForTimeout(1200);
  check("Praticienne belge référencée avec son INAMI", (await text(ines.page)).includes("Vous êtes référencé comme expert"));
  const admin = await session();
  await login(admin.page, "anne.chevalier@demo.kolbase.local");
  await admin.page.goto(`${BASE}/admin?onglet=praticiens`);
  const card = admin.page.locator('section.card:has-text("Inès Lambert")');
  check("Admin : INAMI et pays affichés, lien vers l'INAMI", (await card.innerText()).includes("Numéro INAMI") && (await card.innerText()).includes("Belgique") && (await card.locator('a[href*="inami.fgov.be"]').count()) === 1);
  await card.locator('button:has-text("Valider")').click();
  await admin.page.waitForTimeout(1200);
  await ines.page.goto(`${BASE}/experts?q=Belgique`);
  check("Fiche publique : pays d'exercice et identité vérifiée", (await ines.page.locator('a.kol-card:has-text("Inès Lambert")').innerText()).includes("Belgique"));
  await ines.ctx.close();
  await admin.ctx.close();

  // Dossier dont l'unique expert exerce en Belgique : ni déclaration ni autorisation EPS.
  await db.query(`INSERT INTO "Project" (id, "organizationId", title, "typeId", status, "updatedAt") VALUES ('e2e-prj-be', 'demo-org-dentalys', 'Conférence à Bruxelles', 'pleniere', 'VALIDE', now())`);
  await db.query(`INSERT INTO "ProjectExpert" (id, "projectId", "practitionerId", status, "feeCents", days) VALUES ('e2e-prj-be-x0', 'e2e-prj-be', 'demo-p-janssens', 'VALIDE', 300000, 1)`);
  const claire = await session();
  await login(claire.page, "claire.morel@demo.kolbase.local");
  await claire.page.goto(`${BASE}/organisations/demo-org-dentalys/dossiers/e2e-prj-be`);
  let t = await text(claire.page);
  check("Dossier hors France : régime « Hors France », obligations belges rappelées", t.includes("Hors France") && t.includes("betransparent.be") && t.includes("Mdeon"));
  check("Dossier hors France : pas de démarche auprès de l'Ordre", !t.includes("Demander l'autorisation à l'Ordre") && !t.includes("Déclaration simple"));
  await claire.page.click('button:has-text("Hors France")');
  await claire.page.waitForTimeout(1200);
  const st = (await db.query(`SELECT status FROM "Project" WHERE id = 'e2e-prj-be'`)).rows[0].status;
  check("Dossier hors France : passage direct à la signature", st === "SIGNATURE", st);
  const pdf = await claire.ctx.request.get(`${BASE}/organisations/demo-org-dentalys/dossiers/e2e-prj-be/convention/e2e-prj-be-x0`);
  check("Convention d'une experte belge générée", pdf.status() === 200 && pdf.headers()["content-type"] === "application/pdf");
  await claire.ctx.close();
  // Retour à l'état de départ pour la suite des parcours.
  await db.query(`UPDATE "PractitionerProfile" SET country = 'FR', "licenseNumber" = NULL, listed = false, "listedAt" = NULL, "rppsVerified" = false, "rppsCheckedAt" = NULL WHERE id = 'demo-p-lambert'`);
  await db.end();
}

// ── Mandats d'agence ───────────────────────────────────────────────────────
{
  const agent = await session();
  await login(agent.page, "karim.benali@demo.kolbase.local");
  await agent.page.goto(`${BASE}/organisations/demo-org-dentalys/evenements`);
  check("Agence mandatée : voit l'événement confié", (await text(agent.page)).includes("Soirée"));
  const { ctx, page } = await session();
  await login(page, "claire.morel@demo.kolbase.local");
  await page.goto(`${BASE}/organisations/demo-org-dentalys/prestataires?onglet=agences`);
  check("Mandats : agence existante listée", (await text(page)).includes("Agence Médiane Événements"));
  const belleville = await page.locator('select[name="agencyId"] option', { hasText: "Traiteur Belleville" }).getAttribute("value");
  await page.selectOption('select[name="agencyId"]', belleville);
  await page.click('button:has-text("Mandater")');
  await page.waitForTimeout(1200);
  check("Mandats : nouvelle agence mandatée", (await text(page)).includes("Traiteur Belleville est mandatée"));
  // Le mandat suffit : l'équipe de l'agence accède à l'espace du client, sans invitation.
  const lud = await session();
  await login(lud.page, "ludovic.perrin@demo.kolbase.local");
  const r = await lud.page.goto(`${BASE}/organisations/demo-org-dentalys/evenements`);
  check("Mandat : accès de l'équipe de l'agence sans invitation", r?.status() === 200 && (await text(lud.page)).includes("Événements confiés"), String(r?.status()));
  await lud.ctx.close();
  await page.goto(`${BASE}/organisations/demo-org-dentalys/prestataires?onglet=agences`);
  await page.locator('section.card:has-text("Agence Médiane") button:has-text("Mettre fin au mandat")').click();
  await page.waitForTimeout(1200);
  await agent.page.goto(`${BASE}/organisations/demo-org-dentalys/evenements`);
  check("Fin de mandat : l'agence ne voit plus l'événement", !(await text(agent.page)).includes("Soirée"));
  await ctx.close();
  await agent.ctx.close();
}

// ── Vérification des organisations (SIREN + validation par un administrateur KolBase) ─────
async function submitNewOrg(page, siren) {
  await page.goto(`${BASE}/organisations/nouvelle`);
  await page.fill('input[name="name"]', "Implants Express");
  await page.selectOption('select[name="kind"]', "INDUSTRIEL");
  await page.fill('input[name="siren"]', siren);
  await page.click('button:has-text("Créer l\'organisation")');
  await page.waitForTimeout(1500);
}
{
  const { ctx, page } = await session();
  await login(page, "ines.lambert@demo.kolbase.local");
  await submitNewOrg(page, "");
  check("Nouvelle organisation : SIREN obligatoire pour un industriel", (await text(page)).includes("Indiquez le SIREN"));
  await submitNewOrg(page, "542051181");
  check("Nouvelle organisation : clé du SIREN contrôlée", (await text(page)).includes("SIREN invalide"));
  await submitNewOrg(page, "732 829 320");
  check("Nouvelle organisation : entreprise fermée refusée", (await text(page)).includes("est fermée"));
  await submitNewOrg(page, "542 051 180");
  check("E-mail aux administrateurs KolBase : organisation à valider", !!(await waitMail("anne.chevalier@demo.kolbase.local", "Organisation à valider : Implants Express")));
  check("Nouvelle organisation : créée, en attente de validation", /\/organisations\/[^/]+$/.test(page.url()) && (await text(page)).includes("en attente de validation"), page.url());
  const orgUrl = page.url();
  await page.goto(`${BASE}/annuaire`);
  check("Organisation non validée : pas d'annuaire", page.url().endsWith("/experts"), page.url());
  await page.goto(`${BASE}/experts/demo-p-martin`);
  check("Organisation non validée : tarif des experts masqué", !(await text(page)).includes("Tarif journalier indicatif"));
  const notAdmin = await page.goto(`${BASE}/admin`);
  check("Administration : inaccessible sans droit", notAdmin?.status() === 404, String(notAdmin?.status()));

  const admin = await session();
  await login(admin.page, "anne.chevalier@demo.kolbase.local");
  await admin.page.goto(`${BASE}/admin`);
  const card = admin.page.locator('section.card:has-text("Implants Express")').first();
  check("Administration : SIREN contrôlé dans le répertoire", (await card.innerText()).includes("IMPLANTS EXPRESS SAS — active"));
  await card.locator('button:has-text("Valider")').click();
  await admin.page.waitForTimeout(1200);

  await page.goto(`${BASE}/annuaire`);
  check("Organisation validée : annuaire accessible", page.url().endsWith("/annuaire"), page.url());
  await page.goto(`${BASE}/experts/demo-p-martin`);
  check("Organisation validée : tarif des experts visible", (await text(page)).includes("Tarif journalier indicatif"));
  await page.goto(`${orgUrl}/membres?onglet=organisation`);
  await page.fill('form:has(h2:has-text("Fiche de l")) input[name="name"]', "Straumann France");
  await page.click('form:has(h2:has-text("Fiche de l")) button:has-text("Enregistrer")');
  await page.waitForTimeout(1500);
  check("Organisation renommée : nouvelle validation demandée", (await text(page)).includes("KolBase doit la valider à nouveau"));

  // ── Praticiens : RPPS et professions éligibles
  const hugo = await session();
  await login(hugo.page, "hugo.robert@demo.kolbase.local");
  await hugo.page.goto(`${BASE}/compte`);
  await hugo.page.click('button:has-text("Me référencer comme expert")');
  await hugo.page.waitForTimeout(1200);
  check("Référencement sans RPPS refusé", (await text(hugo.page)).includes("Renseignez d'abord votre numéro RPPS"));
  const infos = 'form:has(h2:has-text("Informations personnelles"))';
  await hugo.page.fill(`${infos} input[name="rpps"]`, "10101010105");
  await hugo.page.click(`${infos} button:has-text("Enregistrer")`);
  await hugo.page.waitForTimeout(1200);
  await hugo.page.reload();
  check("RPPS saisi : en cours de vérification", (await text(hugo.page)).includes("En cours de vérification par KolBase"));
  await hugo.page.click('button:has-text("Me référencer comme expert")');
  await hugo.page.waitForTimeout(1200);
  check("Référencement avec RPPS accepté", (await text(hugo.page)).includes("Vous êtes référencé comme expert"));

  await admin.page.goto(`${BASE}/admin?onglet=praticiens`);
  await admin.page.locator('section.card:has-text("Hugo Robert") button:has-text("Valider")').click();
  await admin.page.waitForTimeout(1200);
  await hugo.page.goto(`${BASE}/compte`);
  check("RPPS validé par l'administrateur", (await text(hugo.page)).includes("Vérifié par KolBase"));
  await hugo.page.goto(`${BASE}/experts`);
  check("Badge « Identité vérifiée » sur la fiche publique", (await hugo.page.locator('a.kol-card:has-text("Hugo Robert")').innerText()).includes("Identité vérifiée"));

  const manon = await session();
  await login(manon.page, "manon.dubois@demo.kolbase.local");
  await manon.page.goto(`${BASE}/compte`);
  const m = await text(manon.page);
  check("Assistante dentaire : pas de référencement d'expert", m.includes("réservé aux chirurgiens-dentistes") && !m.includes("Me référencer comme expert"));
  check("Assistante dentaire : pas de titre « Dr »", !(await manon.page.locator(".session-chip").innerText()).includes("Dr "));
  for (const s of [ctx, admin.ctx, hugo.ctx, manon.ctx]) await s.close();
}

// ── ORCID : iD prouvé par connexion, puis import ───────────────────────────
{
  const { ctx, page } = await session();
  await login(page, "helene.durand@demo.kolbase.local");
  await page.goto(`${BASE}/compte`);
  await Promise.all([page.waitForURL(/\/compte\?orcid=/), page.click('a:has-text("Connecter mon compte ORCID")')]);
  check("ORCID : compte connecté et iD vérifié", (await text(page)).includes("Compte ORCID connecté"), page.url());
  await page.click('button:has-text("Importer depuis ORCID")');
  await page.waitForTimeout(1500);
  check("ORCID : publications importées", (await text(page)).includes("1 publication importée"));
  await ctx.close();
}

// ── Compte : confirmation d'adresse et mot de passe oublié ─────────────────
{
  const { ctx, page } = await session();
  await page.goto(`${BASE}/inscription`);
  await page.fill('input[name="firstName"]', "Camille");
  await page.fill('input[name="lastName"]', "Nouvel");
  await page.fill('input[name="email"]', "camille.nouvel@exemple.fr");
  await page.fill('input[name="password"]', "premier-mot-de-passe-1");
  await page.check('input[name="cgu"]');
  await Promise.all([page.waitForURL(/tableau-de-bord|organisations\/nouvelle|compte/), page.click('button:has-text("Créer")')]);
  const verify = await waitMail("camille.nouvel@exemple.fr", "Confirmez votre adresse");
  check("Inscription : e-mail de confirmation envoyé", !!linkIn(verify), verify?.subject ?? "aucun e-mail");
  await page.goto(`${BASE}/compte`);
  check("Adresse non confirmée : rappel dans Mon compte", (await text(page)).includes("Confirmez votre adresse"));
  await page.goto(linkIn(verify));
  check("Lien de confirmation : adresse confirmée", (await text(page)).includes("Adresse e-mail confirmée") && !(await text(page)).includes("Renvoyer le lien"));
  await page.goto(linkIn(verify));
  check("Lien de confirmation : usage unique", (await text(page)).includes("n'est plus valable"));
  await ctx.close();

  const anon = await session();
  await anon.page.goto(`${BASE}/connexion`);
  check("Connexion : lien « Mot de passe oublié »", (await anon.page.locator('a[href="/mot-de-passe-oublie"]').count()) === 1);
  await anon.page.goto(`${BASE}/mot-de-passe-oublie`);
  await anon.page.fill('input[name="email"]', "camille.nouvel@exemple.fr");
  await anon.page.click('button:has-text("Recevoir le lien")');
  await anon.page.waitForTimeout(800);
  check("Mot de passe oublié : réponse neutre", (await text(anon.page)).includes("Si un compte existe avec cette adresse"));
  await anon.page.goto(`${BASE}/mot-de-passe-oublie`);
  await anon.page.fill('input[name="email"]', "inconnu@exemple.fr");
  await anon.page.click('button:has-text("Recevoir le lien")');
  await anon.page.waitForTimeout(800);
  check("Mot de passe oublié : même réponse pour une adresse inconnue", (await text(anon.page)).includes("Si un compte existe avec cette adresse") && !(await waitMail("inconnu@exemple.fr", "", 1500)));
  const resetMail = await waitMail("camille.nouvel@exemple.fr", "Réinitialiser votre mot de passe");
  await anon.page.goto(linkIn(resetMail));
  await anon.page.fill('input[name="password"]', "nouveau-mot-de-passe-2");
  await anon.page.fill('input[name="confirm"]', "nouveau-mot-de-passe-2");
  await Promise.all([anon.page.waitForURL(/tableau-de-bord|organisations\/nouvelle|compte/), anon.page.click('button:has-text("Enregistrer et me connecter")')]);
  check("Réinitialisation : connecté avec le nouveau mot de passe", !anon.page.url().includes("/mot-de-passe"), anon.page.url());
  await anon.page.goto(linkIn(resetMail));
  check("Réinitialisation : lien à usage unique", (await text(anon.page)).includes("Lien expiré"));
  await anon.ctx.close();

  const again = await session();
  await login(again.page, "camille.nouvel@exemple.fr", "premier-mot-de-passe-1");
  check("Ancien mot de passe refusé", (await text(again.page)).includes("E-mail ou mot de passe incorrect"));
  await login(again.page, "camille.nouvel@exemple.fr", "nouveau-mot-de-passe-2");
  check("Nouveau mot de passe accepté", !again.page.url().includes("/connexion"), again.page.url());

  // ── RGPD : export et suppression du compte
  const exp = await again.page.request.get(`${BASE}/compte/export`);
  const data = await exp.json().catch(() => null);
  check("Export : données du compte au format JSON", exp.ok() && data?.compte?.email === "camille.nouvel@exemple.fr" && !JSON.stringify(data).includes("passwordHash"));
  await again.page.goto(`${BASE}/compte`);
  const del = 'form:has(button:has-text("Supprimer définitivement"))';
  await again.page.click('summary:has-text("Supprimer mon compte")');
  await again.page.fill(`${del} input[name="password"]`, "mauvais-mot-de-passe-9");
  await again.page.check(`${del} input[name="confirm"]`);
  await again.page.click(`${del} button`);
  await again.page.waitForTimeout(1000);
  check("Suppression : mot de passe exigé", (await text(again.page)).includes("Mot de passe incorrect"));
  // Le formulaire est réinitialisé après l'envoi (React 19) : on recoche la confirmation.
  await again.page.fill(`${del} input[name="password"]`, "nouveau-mot-de-passe-2");
  await again.page.check(`${del} input[name="confirm"]`);
  await Promise.all([again.page.waitForURL(/compte=supprime/), again.page.click(`${del} button`)]);
  check("Suppression : compte supprimé et déconnecté", (await again.page.locator("main").innerText()).includes("Votre compte a été supprimé"));
  await login(again.page, "camille.nouvel@exemple.fr", "nouveau-mot-de-passe-2");
  check("Suppression : connexion impossible", (await text(again.page)).includes("E-mail ou mot de passe incorrect"));
  await again.ctx.close();
}
{
  const { ctx, page } = await session();
  await login(page, "claire.morel@demo.kolbase.local");
  await page.goto(`${BASE}/compte`);
  const del = 'form:has(button:has-text("Supprimer définitivement"))';
  await page.click('summary:has-text("Supprimer mon compte")');
  await page.fill(`${del} input[name="password"]`, PW);
  await page.check(`${del} input[name="confirm"]`);
  await page.click(`${del} button`);
  await page.waitForTimeout(1000);
  check("Suppression : bloquée pour le seul administrateur d'une organisation", (await text(page)).includes("seul administrateur de Dentalys Implants"));
  await ctx.close();

  async function deleteAs(email) {
    const m = await session();
    await login(m.page, email);
    await m.page.goto(`${BASE}/compte`);
    await m.page.click('summary:has-text("Supprimer mon compte")');
    const announced = await text(m.page);
    await m.page.fill(`${del} input[name="password"]`, PW);
    await m.page.check(`${del} input[name="confirm"]`);
    await Promise.all([m.page.waitForURL(/compte=supprime/), m.page.click(`${del} button`)]);
    await m.ctx.close();
    return announced;
  }
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const userRow = async (id) => (await db.query(`SELECT u."firstName", u.email, u."passwordHash", (SELECT count(*) FROM "ProjectExpert" pe JOIN "PractitionerProfile" p ON p.id = pe."practitionerId" WHERE p."userId" = u.id) AS links, (SELECT count(*) FROM "Registration" r WHERE r."userId" = u.id) AS regs FROM "User" u WHERE u.id = $1`, [id])).rows[0];

  // Conventions signées : nom conservé pour les registres, le reste effacé.
  check("Suppression : conservation annoncée (conventions)", (await deleteAs("linh.nguyen@demo.kolbase.local")).includes("restent attachés à vos"));
  const linh = await userRow("demo-u-nguyen");
  check("Anonymisation : nom conservé pour les conventions, adresse et mot de passe effacés", linh?.firstName === "Linh" && linh.email.endsWith("@kolbase.invalid") && linh.passwordHash === null && Number(linh.links) > 0, JSON.stringify(linh));
  const pub = await (await browser.newContext({ locale: "fr-FR" })).newPage();
  const fiche = await pub.goto(`${BASE}/experts/demo-p-nguyen`);
  check("Anonymisation : fiche expert retirée", fiche?.status() === 404, String(fiche?.status()));

  // Uniquement des inscriptions à venir : annulées, et le nom est effacé.
  check("Suppression : effacement complet annoncé (inscriptions à venir)", (await deleteAs("manon.dubois@demo.kolbase.local")).includes("votre nom est également effacé"));
  const manon = await userRow("demo-u-dubois");
  check("Anonymisation : nom effacé, inscriptions à venir annulées", manon?.firstName === "Compte" && Number(manon.regs) === 0, JSON.stringify(manon));
  await db.end();
}

// ── Finitions : capacité des événements, pages d'erreur, référencement, en-têtes ─────
{
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  await db.query(`UPDATE "Event" SET capacity = 1 WHERE id = 'demo-ev-live-surgery'`);
  const a = await session();
  const b = await session();
  await login(a.page, "emma.simon@demo.kolbase.local");
  await login(b.page, "sarah.mercier@demo.kolbase.local");
  await Promise.all([a.page.goto(`${BASE}/evenements/demo-ev-live-surgery`), b.page.goto(`${BASE}/evenements/demo-ev-live-surgery`)]);
  await Promise.all([a.page.click('button:has-text("M\'inscrire")'), b.page.click('button:has-text("M\'inscrire")')]);
  await Promise.all([a.page.waitForTimeout(2000), b.page.waitForTimeout(2000)]);
  const { rows } = await db.query(`SELECT count(*)::int AS n FROM "Registration" WHERE "eventId" = 'demo-ev-live-surgery'`);
  const msgs = [await text(a.page), await text(b.page)];
  check("Capacité : deux inscriptions simultanées pour la dernière place, une seule acceptée", rows[0].n === 1 && msgs.some((m) => m.includes("complet")), `${rows[0].n} inscription(s)`);
  await db.end();
  await a.ctx.close();
  await b.ctx.close();

  const { ctx, page } = await session();
  const missing = await page.goto(`${BASE}/experts/inexistant`);
  check("Page 404 : statut et message", missing?.status() === 404 && (await page.locator("main").innerText()).includes("Page introuvable"));
  const home = await page.goto(`${BASE}/`);
  const h = home?.headers() ?? {};
  check("En-têtes de sécurité", h["x-frame-options"] === "DENY" && (h["content-security-policy"] ?? "").includes("frame-ancestors 'none'") && h["x-content-type-options"] === "nosniff", JSON.stringify({ xfo: h["x-frame-options"] }));
  await page.goto(`${BASE}/experts/demo-p-martin`);
  check("Fiche expert : titre de page descriptif", (await page.title()).startsWith("Dr Antoine Martin — Chirurgie orale"), await page.title());
  const robots = await (await page.request.get(`${BASE}/robots.txt`)).text();
  check("robots.txt : espaces privés exclus", robots.includes("Disallow: /admin") && robots.includes("Disallow: /organisations") && robots.includes("sitemap.xml"));
  const sitemap = await (await page.request.get(`${BASE}/sitemap.xml`)).text();
  check("Plan du site : experts référencés et événements publiés", sitemap.includes("/experts/demo-p-martin") && sitemap.includes("/evenements/demo-ev-tp-endo") && !sitemap.includes("demo-p-lambert"));
  await ctx.close();
}

// ── Lancement : état de la configuration et textes légaux ──────────────────
{
  const { ctx, page } = await session();
  await login(page, "anne.chevalier@demo.kolbase.local");
  await page.goto(`${BASE}/admin?onglet=lancement`);
  const t = await text(page);
  check("Administration : état du lancement", t.includes("Avant l'ouverture au public") && t.includes("Envoi d'e-mails") && t.includes("À compléter : hébergeur des documents"));
  await page.goto(`${BASE}/mentions-legales`);
  check("Mentions légales : éditeur complet", (await page.locator("main").innerText()).includes("MUTARA, société par actions simplifiée (SAS) au capital de 100 €"));
  await ctx.close();
}

// ── 3 bis. Logo d'organisation et exports protégés ─────────────────────────
{
  const { ctx, page } = await session();
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  await login(page, "claire.morel@demo.kolbase.local");
  await page.goto(`${BASE}/organisations/demo-org-dentalys/membres?onglet=organisation`);
  // PNG 1×1 valide, puis un « logo » SVG déguisé en PNG (refusé sur son contenu).
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  await page.setInputFiles('input[name="logo"]', { name: "faux.png", mimeType: "image/png", buffer: Buffer.from("<svg onload=alert(1)>") });
  await page.click('button:has-text("Ajouter le logo")');
  await page.waitForTimeout(800);
  check("Logo : SVG déguisé refusé", (await text(page)).includes("Format non reconnu"));
  await page.setInputFiles('input[name="logo"]', { name: "logo.png", mimeType: "image/png", buffer: png });
  await page.click('button:has-text("Ajouter le logo")');
  await page.waitForTimeout(800);
  check("Logo : enregistré", (await text(page)).includes("Logo enregistré"));
  const anon = await browser.newContext({ locale: "fr-FR" });
  const r = await anon.request.get(`${BASE}/logos/demo-org-dentalys`);
  check("Logo : public pour une organisation validée", r.status() === 200 && r.headers()["content-type"] === "image/png", String(r.status()));
  const pub = await anon.newPage();
  await pub.goto(`${BASE}/structures/demo-org-dentalys`);
  check("Logo : affiché sur la fiche publique", (await pub.locator('main img[src^="/logos/demo-org-dentalys"]').count()) > 0);
  await anon.close();
  // Export CSV : une formule saisie comme nom est neutralisée.
  await db.query(`update "User" set "lastName"='=HYPERLINK("http://x")' where id='demo-u-lambert'`);
  const csv = await (await ctx.request.get(`${BASE}/organisations/demo-org-dentalys/hospitalites/export`)).text();
  check("Export CSV : formule neutralisée", csv.includes(`"'=HYPERLINK(""http://x"")"`) && !/;=HYPERLINK/.test(csv));
  await db.query(`update "User" set "lastName"='Lambert' where id='demo-u-lambert'`);
  // Convention PDF : nom en alphabet étendu conservé (police Unicode embarquée).
  await db.query(`update "User" set "firstName"='Łukasz', "lastName"='Żółć' where id='demo-u-durand'`);
  const pdf = await ctx.request.get(`${BASE}/organisations/demo-org-dentalys/dossiers/demo-prj-board/convention/demo-prj-board-x1`);
  const body = await pdf.body();
  check("Convention PDF : générée avec un nom non latin", pdf.status() === 200 && pdf.headers()["content-type"] === "application/pdf" && body.subarray(0, 5).toString() === "%PDF-" && body.length < 200_000, `${pdf.status()} ${body.length} o`);
  await db.query(`update "User" set "firstName"='Hélène', "lastName"='Durand' where id='demo-u-durand'`);
  await db.end();
  await ctx.close();
}

// ── Interface en anglais ───────────────────────────────────────────────────
{
  // Navigateur réglé en anglais : interface en anglais dès la première visite.
  const ctx = await browser.newContext({ locale: "en-US" });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`);
  check("Navigateur en anglais : page en anglais", (await page.getAttribute("html", "lang")) === "en" && (await page.locator("header").innerText()).includes("Sign in"));
  check("Pied de page : mention de la version française faisant foi", (await page.locator("footer").innerText()).includes("binding in their French version"));
  await page.goto(`${BASE}/experts`);
  check("Experts : libellés traduits (glossaire)", (await page.locator("main").innerText()).includes("Implantology"));
  // Le sélecteur repasse en français, et le choix est retenu.
  await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.locator('footer .locale-switch button:has-text("FR")').click()]);
  await page.waitForTimeout(800);
  await page.goto(`${BASE}/`);
  check("Sélecteur de langue : retour au français mémorisé", (await page.getAttribute("html", "lang")) === "fr" && (await page.locator("header").innerText()).includes("Se connecter"));
  await ctx.close();

  // Praticienne : langue choisie dans son compte, appliquée à l'interface.
  const camille = await session();
  await login(camille.page, "camille.petit@demo.kolbase.local");
  await camille.page.goto(`${BASE}/compte`);
  const infos = 'form:has(select[name="locale"])';
  await camille.page.selectOption(`${infos} select[name="locale"]`, "en");
  await camille.page.click(`${infos} button.btn`);
  await camille.page.waitForTimeout(1200);
  await camille.page.goto(`${BASE}/tableau-de-bord`);
  check("Compte réglé en anglais : interface en anglais", (await camille.page.getAttribute("html", "lang")) === "en");
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  check("Langue enregistrée dans le compte (e-mails)", (await db.query(`SELECT locale FROM "User" WHERE id = 'demo-u-petit'`)).rows[0].locale === "en");
  await db.query(`UPDATE "User" SET locale = 'fr' WHERE id = 'demo-u-petit'`);
  await db.end();
  await camille.ctx.close();

  // Convention : traduction anglaise de courtoisie.
  const claire = await session();
  await login(claire.page, "claire.morel@demo.kolbase.local");
  const pdf = await claire.ctx.request.get(`${BASE}/organisations/demo-org-dentalys/dossiers/demo-prj-board/convention/demo-prj-board-x1?lang=en`);
  check("Convention : version anglaise disponible", pdf.status() === 200 && (pdf.headers()["content-disposition"] ?? "").includes("-en.pdf"));
  await claire.ctx.close();
}

// ── Audit : confidentialité, recrutement clos, seuils réglementaires, suspension, suivis ─────
{
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const now = new Date();
  // Dossier confidentiel d'OrthoNova avec la même experte, dans le même domaine que le comité Dentalys.
  await db.query(`INSERT INTO "Project" (id, "organizationId", title, "typeId", "therapeuticArea", status, "updatedAt") VALUES ('audit-prj-ortho', 'demo-org-orthonova', 'Projet secret aligneurs', 'board', 'Implantologie', 'ACCORD', $1)`, [now]);
  await db.query(`INSERT INTO "ProjectExpert" (id, "projectId", "practitionerId", status, "feeCents") VALUES ('audit-pe-ortho', 'audit-prj-ortho', 'demo-p-durand', 'ACCORD', 100000)`);
  // Dossier Dentalys déjà signé, avec un expert resté sans réponse.
  await db.query(`INSERT INTO "Project" (id, "organizationId", title, "typeId", status, "updatedAt") VALUES ('audit-prj-signe', 'demo-org-dentalys', 'Dossier déjà signé', 'board', 'SIGNE', $1)`, [now]);
  await db.query(`INSERT INTO "ProjectExpert" (id, "projectId", "practitionerId", status, "feeCents") VALUES ('audit-pe-late', 'audit-prj-signe', 'demo-p-blanc', 'ATT_EXPERTS', 150000)`);

  const claire = await session();
  await login(claire.page, "claire.morel@demo.kolbase.local");
  await claire.page.goto(`${BASE}/organisations/demo-org-dentalys/dossiers/demo-prj-board`);
  let t = await text(claire.page);
  check("Conflits : signal anonyme, sans nom ni titre d'un autre dossier", t.includes("Collaboration en cours avec une autre organisation") && !t.includes("Projet secret aligneurs") && !t.includes("OrthoNova"));
  await claire.ctx.close();

  const blanc = await session();
  await login(blanc.page, "nicolas.blanc@demo.kolbase.local");
  await blanc.page.goto(`${BASE}/sollicitations/audit-pe-late`);
  t = await text(blanc.page);
  check("Recrutement clos : plus d'acceptation après la signature du dossier", t.includes("Le recrutement de ce dossier est clos") && (await blanc.page.locator('button:has-text("Accepter")').count()) === 0);
  await blanc.ctx.close();

  // Seuils : la conformité ne peut pas relever un seuil réglementaire (contrôle serveur, au-delà du champ du navigateur).
  const sophie = await session();
  await login(sophie.page, "sophie.bernard@demo.kolbase.local");
  await sophie.page.goto(`${BASE}/organisations/demo-org-dentalys/conformite?onglet=parametres`);
  await sophie.page.evaluate(() => document.querySelectorAll("input[max]").forEach((i) => i.removeAttribute("max")));
  await sophie.page.fill('input[name="remunerationHourlyMax"]', "1000");
  await sophie.page.click('form:has(input[name="remunerationHourlyMax"]) button.btn');
  await sophie.page.waitForTimeout(800);
  t = await text(sophie.page);
  const saved = (await db.query(`SELECT "complianceSettings" AS s FROM "Organization" WHERE id = 'demo-org-dentalys'`)).rows[0].s;
  check("Seuils réglementaires : impossible de relever le taux horaire", t.includes("au maximum (seuil réglementaire") && (saved?.remunerationHourlyMax ?? 200) <= 200, JSON.stringify(saved));
  await sophie.ctx.close();

  // Organisation suspendue : ses événements ne sont plus accessibles par lien direct.
  await db.query(`UPDATE "Organization" SET verification = 'PENDING' WHERE id = 'demo-org-cdra'`);
  const anon = await browser.newContext();
  const ev = await anon.request.get(`${BASE}/evenements/demo-ev-journee-cdra`);
  check("Organisation suspendue : événement inaccessible", ev.status() === 404, String(ev.status()));
  await anon.close();
  await db.query(`UPDATE "Organization" SET verification = 'VERIFIED' WHERE id = 'demo-org-cdra'`);

  // Suivis : une publication réservée aux organisations n'apparaît pas pour un simple compte praticien.
  await db.query(`UPDATE "PractitionerProfile" SET visibility = visibility || '{"publications":"industriels"}' WHERE id = 'demo-p-durand'`);
  await db.query(`INSERT INTO "Publication" (id, "practitionerId", title) VALUES ('audit-pub', 'demo-p-durand', 'Publication réservée aux organisations')`);
  await db.query(`INSERT INTO "Follow" (id, "userId", "practitionerId") VALUES ('audit-follow', 'demo-u-robert', 'demo-p-durand') ON CONFLICT DO NOTHING`);
  const hugo = await session();
  await login(hugo.page, "hugo.robert@demo.kolbase.local");
  await hugo.page.goto(`${BASE}/suivis`);
  check("Suivis : publication réservée masquée à un compte sans organisation", !(await text(hugo.page)).includes("Publication réservée aux organisations"));
  await hugo.ctx.close();

  await db.query(`DELETE FROM "Follow" WHERE id = 'audit-follow'`);
  await db.query(`DELETE FROM "Publication" WHERE id = 'audit-pub'`);
  await db.query(`UPDATE "PractitionerProfile" SET visibility = visibility - 'publications' WHERE id = 'demo-p-durand'`);
  await db.query(`DELETE FROM "ProjectExpert" WHERE id IN ('audit-pe-ortho', 'audit-pe-late')`);
  await db.query(`DELETE FROM "Project" WHERE id IN ('audit-prj-ortho', 'audit-prj-signe')`);
  await db.end();
}

// ── Organisations publiques rangées par famille ────────────────────────────
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/structures`);
  const heads = await page.locator("main h2").allInnerTexts();
  check("Organisations : une section par famille", JSON.stringify(heads) === JSON.stringify(["Industriels", "Sociétés savantes et associations", "Organismes de formation", "Prestataires"]), heads.join(" / "));
  await page.goto(`${BASE}/structures?type=prestataires`);
  const t = await text(page);
  check("Organisations : filtre « Prestataires » (catégories et zone, sans industriels)", t.includes("Traiteur Belleville") && t.includes("Restauration et traiteur") && !t.includes("Dentalys Implants"));
  await ctx.close();
}

// ── Rôles simplifiés et contrôle à quatre yeux ─────────────────────────────
{
  const { ctx, page } = await session();
  await login(page, "claire.morel@demo.kolbase.local");
  await page.goto(`${BASE}/organisations/demo-org-dentalys/membres`);
  const t = await text(page);
  check("Rôles : trois rôles internes décrits, agences par mandat", ["Administrateur", "Projets", "Conformité", "Agences mandatées (", "Gérer les mandats"].every((r) => t.includes(r)) && !t.includes("Éducation"));
  check("Rôles : plus de rôle « Agence mandatée » à l'invitation", !(await page.locator('select[name="role"] option').allInnerTexts()).includes("Agence mandatée"));
  const julien = page.locator('li.member-row:has-text("Julien Faure")');
  await julien.locator('label:has-text("Conformité")').click();
  await page.waitForTimeout(1500);
  check("Rôles : cumul Projets + Conformité enregistré aussitôt", (await julien.innerText()).includes("Rôles enregistrés."));
  // Décocher le dernier rôle ne retire pas la personne.
  const nadia = page.locator('li.member-row:has-text("Nadia Haddad")');
  await nadia.locator('label:has-text("Conformité")').click();
  await page.waitForTimeout(1500);
  check("Rôles : aucun rôle refusé, case rétablie", (await nadia.innerText()).includes("Gardez au moins un rôle") && (await nadia.locator('input[value="CONFORMITE"]').isChecked()));
  await page.reload();
  // Julien a monté et soumis le symposium : il ne peut pas le valider, d'autres personnes habilitées existent.
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const before = (await db.query(`select status from "Project" where id='demo-prj-symposium'`)).rows[0].status;
  await db.query(`update "Project" set status='EN_VALID' where id='demo-prj-symposium'`);
  const j = await session();
  await login(j.page, "julien.faure@demo.kolbase.local");
  await j.page.goto(`${BASE}/organisations/demo-org-dentalys/dossiers/demo-prj-symposium`);
  const jt = await text(j.page);
  check("Quatre yeux : l'auteur du dossier ne peut pas le valider", (await j.page.locator('button:has-text("Valider")').count()) === 0 && jt.includes("Contrôle à quatre yeux"));
  check("Quatre yeux : il peut encore le bloquer avec un motif", (await j.page.locator('button:has-text("Bloquer")').count()) === 1);
  await j.ctx.close();
  await db.query(`update "Project" set status=$1 where id='demo-prj-symposium'`, [before]);
  const row = page.locator('li.member-row:has-text("Julien Faure")');
  await row.locator('label:has-text("Conformité")').click();
  await page.waitForTimeout(1500);
  const roles = (await db.query(`select role from "Membership" where "userId"='demo-u-julien' and "organizationId"='demo-org-dentalys' order by role`)).rows.map((r) => r.role);
  check("Rôles : retour au seul rôle Projets", JSON.stringify(roles) === JSON.stringify(["PROJETS"]), roles.join(","));
  await db.end();
  await ctx.close();
}

// ── Prestataires : devis détaillé, révision, PDF, logistique de l'événement ─
{
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n");
  const sup = await session();
  await login(sup.page, "karim.benali@demo.kolbase.local");
  await sup.page.goto(`${BASE}/organisations/demo-org-mediane/devis`);
  const form = sup.page.locator('section.card:has-text("Live surgery") form:has(input[name="line_label"])');
  await form.locator('input[name="line_label"]').nth(0).fill("Captation 2 caméras et régie");
  await form.locator('input[name="line_unit"]').nth(0).fill("2400");
  await form.locator('button:has-text("Ajouter une ligne")').click();
  await form.locator('input[name="line_label"]').nth(1).fill("Retransmission en salle");
  await form.locator('input[name="line_qty"]').nth(1).fill("2");
  await form.locator('input[name="line_unit"]').nth(1).fill("450,50");
  await form.locator('input[name="validUntil"]').fill(new Date(Date.now() + 20 * 864e5).toISOString().slice(0, 10));
  await form.locator('input[name="conditions"]').fill("Acompte de 30 % à la commande.");
  check("Devis détaillé : totaux HT et TTC calculés", /3\s301,00/.test(await form.innerText()) && /3\s961,20/.test(await form.innerText()));
  await form.locator('input[name="file"]').setInputFiles({ name: "devis-mediane.pdf", mimeType: "application/pdf", buffer: pdf });
  await form.locator('button:has-text("Envoyer le devis")').click();
  await sup.page.waitForTimeout(1500);
  await sup.page.reload();
  check("Devis détaillé : envoyé", (await sup.page.locator('section.card:has-text("Live surgery") button:has-text("Réviser mon devis")').count()) === 1);
  // Révision : la version 2 remplace la première.
  await sup.page.locator('section.card:has-text("Live surgery") button:has-text("Réviser mon devis")').click();
  const rev = sup.page.locator('section.card:has-text("Live surgery") form:has(input[name="line_label"])');
  await rev.locator('input[name="line_unit"]').nth(0).fill("2200");
  await rev.locator('button:has-text("Envoyer la version 2")').click();
  await sup.page.waitForTimeout(1500);
  check("E-mail au demandeur : devis révisé", !!(await waitMail("julien.faure@demo.kolbase.local", "Devis révisé")) || !!(await waitMail("claire.morel@demo.kolbase.local", "Devis révisé", 2000)));

  const { ctx, page } = await session();
  await login(page, "claire.morel@demo.kolbase.local");
  await page.goto(`${BASE}/organisations/demo-org-dentalys/prestataires`);
  const card = page.locator('section.card:has-text("Live surgery")');
  const ct = await card.innerText();
  check("Comparaison : TTC, version et validité affichés", /3\s721,20/.test(ct) && ct.includes("Version 2") && ct.includes("valable jusqu"), ct.slice(0, 300));
  check("Comparaison : coût par participant", ct.includes("par participant"));
  await card.locator('summary:has-text("Détail de l")').click();
  check("Comparaison : lignes et conditions détaillées", (await card.innerText()).includes("Retransmission en salle") && (await card.innerText()).includes("Acompte de 30 %"));
  const href = await card.locator('a:has-text("Devis signé (PDF)")').getAttribute("href");
  const dl = await page.request.get(`${BASE}${href}`);
  check("Devis PDF : téléchargeable par le demandeur", dl.ok() && Buffer.compare(await dl.body(), pdf) === 0);
  const other = await session();
  await login(other.page, "anne.chevalier@demo.kolbase.local");
  check("Devis PDF : refusé à une autre organisation", (await other.page.request.get(`${BASE}${href}`)).status() === 404);
  await other.ctx.close();
  // Fiche de l'événement : la logistique et les besoins restants.
  await page.goto(`${BASE}/organisations/demo-org-dentalys/evenements/demo-ev-live-surgery`);
  const ev = await text(page);
  check("Événement : carte « Logistique et prestataires »", ev.includes("Logistique et prestataires") && ev.includes("Audiovisuel et captation") && /3\s721,20/.test(ev));
  await Promise.all([page.waitForURL(/onglet=nouvelle/), page.click('a.chip:has-text("Restauration et traiteur")')]);
  check("Demande de devis préremplie : événement et catégorie", (await page.locator('select[name="eventId"]').inputValue()) === "demo-ev-live-surgery" && (await page.locator('button.chip.active').innerText()).includes("Restauration"));
  // Dossier : l'événement rattaché et sa logistique.
  await page.goto(`${BASE}/organisations/demo-org-dentalys/dossiers/demo-prj-board`);
  const d = await text(page);
  check("Dossier : événement rattaché et demandes de devis visibles", d.includes("Événement et logistique") && d.includes("Réunion du board implantologie") && d.includes("Salle et lieu de réception"));
  await page.goto(`${BASE}/organisations/demo-org-dentalys/evenements/nouveau?dossier=demo-prj-symposium`);
  check("Nouvel événement depuis un dossier : rattachement annoncé", (await text(page)).includes("rattaché au dossier « Symposium ADF") && (await page.locator('input[name="projectId"]').count()) === 1);
  await ctx.close();
  await sup.ctx.close();
}

// ── Parcours cohérent : questions, décision, coûts reportés, réunion interne ─
{
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const { ctx, page } = await session();
  await login(page, "claire.morel@demo.kolbase.local");
  await page.goto(`${BASE}/organisations/demo-org-dentalys`);
  let t = await text(page);
  check("Accueil : question d'un prestataire à traiter", t.includes("Question de Traiteur Belleville"));
  check("Accueil : une réunion interne n'est pas un brouillon à publier", !t.includes("Brouillon à publier : Réunion du board"));
  // Réponse à la question du traiteur, dans le fil privé de la demande.
  await page.goto(`${BASE}/organisations/demo-org-dentalys/prestataires`);
  const rfq = page.locator("section#rfq-demo-rfq-cocktail");
  const thread = rfq.locator('details.rfq-thread:has-text("Traiteur Belleville")');
  check("Demande : fil ouvert sur la question en attente", (await thread.getAttribute("open")) !== null && (await thread.innerText()).includes("options végétariennes"));
  await thread.locator('textarea[name="body"]').fill("Oui : 10 couverts végétariens, dont 3 sans gluten.");
  await thread.locator('button:has-text("Envoyer")').click();
  check("E-mail au prestataire : message du demandeur", !!(await waitMail("ludovic.perrin@demo.kolbase.local", "Message de Dentalys Implants")));
  // Offre expirée : non retenable.
  await db.query(`update "Quote" set "validUntil" = now() - interval '1 day' where "rfqId"='demo-rfq-cocktail' and "supplierId"='demo-sup-tablesdusud'`);
  await page.reload();
  const sud = page.locator('section#rfq-demo-rfq-cocktail .quote:has-text("Les Tables du Sud")');
  check("Devis expiré : non retenable", (await sud.locator('button:has-text("Retenir")').count()) === 0 && (await sud.innerText()).includes("Offre expirée"));
  await page.locator('section#rfq-demo-rfq-cocktail .quote:has-text("Traiteur Belleville") button:has-text("Retenir")').click();
  await page.waitForTimeout(1200);
  check("E-mail au prestataire retenu", !!(await waitMail("ludovic.perrin@demo.kolbase.local", "Votre devis est retenu")));
  // Le prestataire retenu voit la décision et le fil reste ouvert.
  const sup = await session();
  await login(sup.page, "ludovic.perrin@demo.kolbase.local");
  await sup.page.goto(`${BASE}/organisations/demo-sup-belleville/devis`);
  const st = await text(sup.page);
  check("Prestataire : décision et échanges visibles", st.includes("a retenu votre devis") && st.includes("10 couverts végétariens"));
  await sup.ctx.close();
  // Le coût réel du devis retenu est reporté dans la valeur déclarée de l'hospitalité.
  await page.goto(`${BASE}/organisations/demo-org-dentalys/evenements/demo-ev-soiree-implanto`);
  const apply = page.locator("form.apply-benefit");
  check("Événement : report du coût réel proposé", (await apply.count()) === 1);
  const cocktail = await apply.locator('select[name="benefitId"] option', { hasText: "Cocktail" }).getAttribute("value");
  await apply.locator('select[name="benefitId"]').selectOption(cocktail);
  await apply.locator('input[name="value"]').fill("47,30");
  await apply.locator('button:has-text("Mettre à jour")').click();
  await page.waitForTimeout(1200);
  t = await text(page);
  check("Événement : valeur déclarée mise à jour", /Cocktail dînatoire\s*47,30\s€ TTC par personne/.test(t), t.match(/Cocktail dînatoire[^\n]*/)?.[0]);
  const v = await db.query(`select rb."valueCents" from "RegistrationBenefit" rb join "Registration" r on r.id = rb."registrationId" join "EventBenefit" b on b.id = rb."benefitId" where r."eventId"='demo-ev-soiree-implanto' and b."catalogId"='cocktail' and r.declared = false`);
  check("Inscriptions non déclarées : valeur alignée", v.rows.length > 0 && v.rows.every((r) => r.valueCents === 4730), JSON.stringify(v.rows));
  // Réunion interne rattachée au dossier : devis retenu → budget du dossier.
  await page.goto(`${BASE}/organisations/demo-org-dentalys/evenements/demo-ev-board`);
  t = await text(page);
  check("Réunion interne : ni publication ni inscriptions", t.includes("Réunion interne") && (await page.locator('button:has-text("Publier dans l\'agenda")').count()) === 0 && t.includes("Participants"));
  await page.goto(`${BASE}/organisations/demo-org-dentalys/prestataires`);
  await page.locator('section#rfq-demo-rfq-board-salle .quote:has-text("Espace Confluence") button:has-text("Retenir")').click();
  await page.waitForTimeout(1200);
  await page.goto(`${BASE}/organisations/demo-org-dentalys/dossiers/demo-prj-board`);
  t = await text(page);
  check("Dossier : devis retenu compté dans le budget", t.includes("Prestataires (devis retenus)") && t.includes("Salle et lieu de réception : Espace Confluence"));
  await page.goto(`${BASE}/organisations/demo-org-dentalys/dossiers/demo-prj-redaction`);
  check("Dossier de rédaction : pas de carte logistique", !(await text(page)).includes("Événement et logistique"));
  // Listes : qui doit agir, montants, réunion interne.
  await page.goto(`${BASE}/organisations/demo-org-dentalys/dossiers`);
  t = await text(page);
  check("Liste des dossiers : prochaine action et montants", t.includes("À faire : Conformité") || t.includes("À faire : Projets"));
  await page.goto(`${BASE}/organisations/demo-org-dentalys/evenements`);
  t = await text(page);
  check("Liste des événements : réunion interne et logistique", t.includes("Réunion interne") && t.includes("À venir"));
  await db.end();
  await ctx.close();
}

// ── Simplification : conformité sur un niveau, formulaire de devis, agences ─
{
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const m = await db.query(`select count(*)::int n from "Membership" m join "Organization" o on o.id = m."organizationId" where o.kind <> 'PRESTATAIRE' and m.role = 'PRESTATAIRE'`);
  check("Agences : plus aucun rattachement individuel « Agence mandatée »", m.rows[0].n === 0, String(m.rows[0].n));
  await db.end();
  const { ctx, page } = await session();
  await login(page, "sophie.bernard@demo.kolbase.local");
  await page.goto(`${BASE}/organisations/demo-org-dentalys/conformite`);
  const tabs = await page.locator("nav.section-nav").innerText();
  check("Conformité : un seul niveau d'onglets, relecture comprise", tabs.includes("Supports à relire") && tabs.includes("Transparence Santé") && (await page.locator("main nav.tabs").count()) === 0, tabs.replace(/\n/g, " | "));
  await page.click('nav.section-nav a:has-text("Supports à relire")');
  await page.waitForURL(/\/relecture/);
  check("Relecture : rangée dans la conformité", (await page.locator("nav.section-nav a[aria-current=page]").innerText()).includes("Supports à relire"));
  await ctx.close();
  const sup = await session();
  await login(sup.page, "karim.benali@demo.kolbase.local");
  await sup.page.goto(`${BASE}/organisations/demo-org-mediane/devis?onglet=toutes`);
  const f = sup.page.locator('section.card:has-text("Live surgery") form:has(input[name="line_label"])');
  if ((await f.count()) === 0) await sup.page.locator('section.card:has-text("Live surgery") button:has-text("Réviser mon devis")').click();
  check("Devis : exemple adapté à la catégorie, une seule façon de chiffrer", (await f.locator('input[name="line_label"]').first().getAttribute("placeholder")) === "Captation 2 caméras et régie" && (await f.locator('input[name="amount"]').count()) === 0);
  await sup.ctx.close();
}

// ── 4. Limitation des tentatives ───────────────────────────────────────────
{
  const { ctx, page } = await session();
  let last = "";
  for (let i = 1; i <= 5; i++) {
    await login(page, "helene.durand@demo.kolbase.local", "mauvais-mot-de-passe-1");
    last = await text(page);
  }
  check("5 échecs : message d'erreur classique", last.includes("E-mail ou mot de passe incorrect."));
  await login(page, "helene.durand@demo.kolbase.local", PW);
  const t = await text(page);
  check("6e tentative (même correcte) : bloquée", t.includes("Trop de tentatives") && page.url().includes("/connexion"), t.match(/Trop de tentatives[^.]*\./)?.[0] ?? page.url());
  await login(page, "camille.petit@demo.kolbase.local", PW);
  check("Un autre compte peut toujours se connecter", page.url().includes("/tableau-de-bord"), page.url());
  await ctx.close();
}

await browser.close();
stopFakes();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} vérifications OK`);
process.exit(failed.length ? 1 : 0);
