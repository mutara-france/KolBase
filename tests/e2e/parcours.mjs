// Parcours de bout en bout sur les données de démo (droits, visibilité, connexion).
// Prérequis : base migrée et chargée (npm run db:seed avec DEMO_PASSWORD), application lancée.
// Usage : BASE=http://localhost:3000 DEMO_PASSWORD=… DATABASE_URL=… npm run test:e2e
import { chromium } from "playwright";
import pg from "pg";
import { createHmac } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { aiRequests, mails, signatureRequests, startFakes, stripeState, stripeWebhook } from "./faux-services.mjs";

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

// ── Agences : confier un événement en une seule action ─────────────────────
{
  const agent = await session();
  await login(agent.page, "karim.benali@demo.kolbase.local");
  await agent.page.goto(`${BASE}/organisations/demo-org-dentalys/evenements`);
  check("Agence mandatée : voit l'événement confié", (await text(agent.page)).includes("Soirée"));
  const { ctx, page } = await session();
  await login(page, "claire.morel@demo.kolbase.local");
  await page.goto(`${BASE}/organisations/demo-org-dentalys/prestataires?onglet=agences`);
  check("Agences : agence mandatée listée, sans formulaire séparé", (await text(page)).includes("Agence Médiane Événements") && (await page.locator('button:has-text("Mandater")').count()) === 0);
  await page.locator('section.card:has-text("Agence Médiane") button:has-text("Mettre fin au mandat")').click();
  await page.waitForTimeout(1200);
  await agent.page.goto(`${BASE}/organisations/demo-org-dentalys/evenements`);
  check("Fin de mandat : l'agence n'a plus accès", !(await text(agent.page)).includes("Soirée"));
  // Confier un événement à une agence non mandatée : le mandat est créé au passage, l'agence est prévenue.
  await page.goto(`${BASE}/organisations/demo-org-dentalys/evenements/demo-ev-live-surgery`);
  const opt = page.locator('select[name="agencyId"] option', { hasText: "Agence Médiane" });
  check("Événement : agence proposée avec « nouveau mandat »", (await opt.innerText()).includes("nouveau mandat"));
  await page.selectOption('select[name="agencyId"]', await opt.getAttribute("value"));
  await page.click('button:has-text("Confier l\'événement")');
  await page.waitForTimeout(1500);
  check("Événement confié en une action", (await text(page)).includes("Confié à Agence Médiane Événements"));
  check("E-mail à l'agence : événement confié", !!(await waitMail("karim.benali@demo.kolbase.local", "vous confie « Live surgery")));
  await agent.page.goto(`${BASE}/organisations/demo-org-dentalys/evenements`);
  const at = await text(agent.page);
  check("Agence : accès au seul événement confié, sans invitation", at.includes("Live surgery") && !at.includes("Soirée"));
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
  await page.check('input[name="newsletter"]');
  await page.check('input[name="cgu"]');
  await Promise.all([page.waitForURL(/tableau-de-bord|organisations\/nouvelle|compte/), page.click('button:has-text("Créer")')]);
  check("Inscription : lettre d'information non reproposée à l'accueil", !(await text(page)).includes("Recevoir la lettre d'information de KolBase ?"));
  {
    const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    const prefs = (await c.query(`select "notifyPrefs" p from "User" where email = 'camille.nouvel@exemple.fr'`)).rows[0]?.p;
    const consent = (await c.query(`select count(*)::int n from "AuditLog" a join "User" u on u.id = a."actorId" where u.email = 'camille.nouvel@exemple.fr' and a.action = 'user.notify_prefs'`)).rows[0].n;
    await c.end();
    check("Inscription : consentement à la lettre enregistré et tracé", prefs?.newsletter === true && consent === 1, JSON.stringify(prefs));
  }
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
  const ml = (await page.locator("main").innerText()).replace(/\s/g, " ");
  check("Mentions légales : hébergeur, prestataires, signalement", ml.includes("Render Services, Inc.") && ml.includes("Stripe Payments Europe") && ml.includes("Signaler un contenu"));
  await page.goto(`${BASE}/conditions-de-vente`);
  const cgv = (await page.locator("main").innerText()).replace(/\s/g, " ");
  check("Conditions de vente : tarifs et services à jour", cgv.includes("599 € HT par mois") && cgv.includes("5 990 € HT par an") && cgv.includes("249 € HT par mois") && cgv.includes("Pack visibilité") && cgv.includes("40 €"));
  await page.goto(`${BASE}/cgu`);
  check("CGU : sommaire et renvois", (await page.locator(".legal-toc li").count()) >= 15 && (await page.locator('.legal-others a[href="/conditions-de-vente"]').count()) === 1);
  await page.goto(`${BASE}/confidentialite`);
  const pc = await page.locator("main").innerText();
  check("Confidentialité : durées et cookies", pc.includes("kb_src") && pc.includes("13 mois") && pc.includes("10 ans"));
  check("Pied de page : conditions de vente", (await page.locator('footer a[href="/conditions-de-vente"]').count()) === 1);
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

// ── Clarté : données utiles, appels expliqués, inscription, organisations d'aperçu ─
{
  const { ctx, page } = await session();
  await login(page, "claire.morel@demo.kolbase.local");
  await page.goto(`${BASE}/organisations/demo-org-dentalys`);
  check("Accueil : plus de date du jour", (await page.locator(".dash-kicker").count()) === 0);
  await page.goto(`${BASE}/organisations/demo-org-dentalys/opportunites`);
  check("Appels : une seule sorte, rattachable à un événement", (await text(page)).includes("Appels à candidatures") && (await page.locator('select[name="eventId"] option').count()) > 1);
  await ctx.close();
  const anon = await session();
  await anon.page.goto(`${BASE}/evenements/demo-ev-soiree-implanto`);
  check("Événement : inscription réservée aux membres, création de compte proposée", (await text(anon.page)).includes("Inscription réservée aux membres KolBase") && (await anon.page.locator('a:has-text("Créer mon compte et m\'inscrire")').getAttribute("href")).startsWith("/inscription?next="));
  const pub = await anon.page.goto(`${BASE}/structures/straumann`);
  check("Partenaires : fiche publique de Straumann", pub?.status() === 200 && (await text(anon.page)).includes("Straumann Group"), String(pub?.status()));
  const logo = await anon.page.locator('img[src^="/logos/straumann"]').first().getAttribute("src").catch(() => null);
  const logoRes = logo ? await anon.ctx.request.get(`${BASE}${logo}`) : null;
  check("Partenaires : logo affiché", !!logoRes?.ok() && logoRes.headers()["content-type"] === "image/png", logo ?? "aucun logo");
  const old = await anon.page.goto(`${BASE}/structures/apercu-straumann`);
  check("Partenaires : ancienne adresse d'aperçu retirée", old?.status() === 404);
  await anon.page.goto(`${BASE}/structures`);
  const annuaire = await text(anon.page);
  check("Partenaires : présents dans l'annuaire public", annuaire.includes("Straumann Group") && annuaire.includes("Septodont") && annuaire.includes("Mega Dental"));
  await anon.ctx.close();
  const exp = await session();
  await login(exp.page, "olivier.girard@demo.kolbase.local");
  await exp.page.goto(`${BASE}/interventions?onglet=candidatures`);
  const ct = await text(exp.page);
  check("Praticien : toutes les candidatures réunies", ct.includes("Mes candidatures") && ct.includes("Formateur TP CFAO"));
  await exp.ctx.close();
}

// ── Assistant de rédaction (IA) ────────────────────────────────────────────
{
  const { ctx, page } = await session();
  await login(page, "claire.morel@demo.kolbase.local");
  await page.goto(`${BASE}/organisations/demo-org-dentalys/evenements/demo-ev-soiree-implanto`);
  await page.click('button:has-text("Proposer un programme avec l\'IA")');
  await page.waitForFunction(() => document.querySelector('textarea[name="program"]')?.value.startsWith("PROPOSITION IA"), null, { timeout: 15000 }).catch(() => {});
  check("IA : programme proposé dans le champ", (await page.locator('textarea[name="program"]').inputValue()).startsWith("PROPOSITION IA"));
  const req = aiRequests.at(-1);
  const sent = JSON.stringify(req ?? {});
  check("IA : contexte de l'événement transmis, sans adresse e-mail", sent.includes("Soirée implantologie") && !/[\w.-]+@[\w-]+\.[\w.]+/.test(sent));
  await page.click('button:has-text("Enregistrer le programme")');
  await page.waitForTimeout(1200);
  const anon = await session();
  await anon.page.goto(`${BASE}/evenements/demo-ev-soiree-implanto`);
  check("Programme publié sur la page de l'événement", (await text(anon.page)).includes("Accueil des participants"));
  await anon.ctx.close();
  // Demande de devis : besoin rédigé à partir de l'événement et de la catégorie.
  await page.goto(`${BASE}/organisations/demo-org-dentalys/prestataires?onglet=nouvelle&evenement=demo-ev-soiree-implanto&cat=salle`);
  await page.click('button:has-text("Rédiger le besoin avec l\'IA")');
  await page.waitForFunction(() => document.querySelector('textarea[name="needs"]')?.value.startsWith("PROPOSITION IA"), null, { timeout: 15000 }).catch(() => {});
  check("IA : besoin de la demande de devis proposé", (await page.locator('textarea[name="needs"]').inputValue()).startsWith("PROPOSITION IA"));
  check("IA : catégorie demandée transmise", JSON.stringify(aiRequests.at(-1) ?? {}).includes("Salle et lieu de réception"));
  // Appel à experts et nouveau dossier : boutons présents.
  await page.goto(`${BASE}/organisations/demo-org-dentalys/opportunites`);
  check("IA : rédaction d'un appel à experts proposée", (await page.locator('button:has-text("Rédiger l\'appel avec l\'IA")').count()) === 1);
  await ctx.close();
}

// ── Appels à candidatures rattachés à un événement ─────────────────────────
{
  const { ctx, page } = await session();
  await login(page, "claire.morel@demo.kolbase.local");
  // Les anciens appels à intervenants sont devenus des appels rattachés à leur événement.
  await page.goto(`${BASE}/organisations/demo-org-dentalys/evenements/demo-ev-live-surgery`);
  const card = page.locator('section.card:has(h2:has-text("Intervenants"))');
  check("Événement : appel rattaché repris, candidatures visibles", (await card.innerText()).includes("Intervenants : Live surgery") && (await card.innerText()).includes("2 candidatures à examiner"));
  // Lancer un appel depuis la fiche de l'événement : l'événement et le titre sont préremplis.
  await page.goto(`${BASE}/organisations/demo-org-dentalys/evenements/demo-ev-soiree-implanto`);
  await page.click('a:has-text("Lancer un appel")');
  await page.waitForURL(/opportunites\?evenement=demo-ev-soiree-implanto/);
  check("Nouvel appel : événement prérempli", (await page.locator('select[name="eventId"]').inputValue()) === "demo-ev-soiree-implanto" && (await page.locator('input[name="title"]').inputValue()).startsWith("Intervenants : Soirée implantologie"));
  await page.fill('input[name="slots"]', "1");
  await page.fill('textarea[name="description"]', "Présentation de deux cas cliniques complexes en implantologie, 20 minutes, suivie d'échanges avec la salle.");
  await Promise.all([page.waitForURL(/\/opportunites\/[^/?]+$/), page.click('button:has-text("Publier l\'appel")')]);
  const callUrl = page.url();
  const callId = callUrl.split("/").pop();
  check("Appel publié : événement et places affichés", (await text(page)).includes("Soirée implantologie") && (await text(page)).includes("0 / 1"));
  const anon = await session();
  await anon.page.goto(`${BASE}/evenements/demo-ev-soiree-implanto`);
  check("Page de l'événement : appel à candidatures annoncé", (await text(anon.page)).includes("Appel à candidatures") && (await text(anon.page)).includes("Intervenants : Soirée implantologie"));
  await anon.ctx.close();
  // Un expert le trouve parmi les appels liés à un événement et candidate.
  const exp = await session();
  await login(exp.page, "olivier.girard@demo.kolbase.local");
  await exp.page.goto(`${BASE}/opportunites?evenement=avec`);
  check("Praticien : filtre « intervenir à un événement »", (await text(exp.page)).includes("Intervenants : Soirée implantologie") && !(await text(exp.page)).includes("Investigateurs pour étude"));
  await exp.page.goto(`${BASE}/opportunites/${callId}`);
  await exp.page.fill('textarea[name="message"]', "Je peux présenter deux cas de réhabilitation complète guidée, avec leurs suites à trois ans.");
  await exp.page.click('button:has-text("Candidater")');
  await exp.page.waitForTimeout(1200);
  check("E-mail à l'organisation : nouvelle candidature", !!(await waitMail("claire.morel@demo.kolbase.local", "Nouvelle candidature : Intervenants : Soirée")));
  // L'organisation retient : un dossier s'ouvre au nom de l'intervenant, la place est pourvue.
  await page.goto(callUrl);
  await page.click('button:has-text("Retenir…")');
  await page.fill('input[name="fee"]', "1500");
  await Promise.all([page.waitForURL(/\/dossiers\//), page.click('button:has-text("Proposer ces honoraires")')]);
  check("Retenu : dossier ouvert au nom de l'intervenant", (await text(page)).includes("Soirée implantologie — cas cliniques complexes : intervention du Dr Girard"));
  await exp.page.goto(`${BASE}/opportunites/${callId}`);
  check("Appel complet : plus de candidature possible", (await text(exp.page)).includes("Votre candidature a été retenue"));
  await exp.ctx.close();
  await ctx.close();
}

// ── Mes revenus : honoraires, liens d'intérêts, Transparence, paiement ────
{
  const { ctx, page } = await session();
  await login(page, "camille.petit@demo.kolbase.local");
  await page.goto(`${BASE}/revenus`);
  let t = await text(page);
  check("Revenus : honoraires payés et conventions de l'année", t.includes("Webinaire planification numérique") && t.includes("Payé le") && /900\s€/.test(t) && t.includes("Comité scientifique aligneurs"));
  const csv = await (await ctx.request.get(`${BASE}/revenus/export?annee=${new Date().getFullYear()}`)).text();
  check("Revenus : export CSV", csv.includes("Webinaire planification numérique") && csv.includes("Honoraires"));
  await page.goto(`${BASE}/revenus?onglet=liens`);
  t = await text(page);
  check("Liens d'intérêts : KolBase et liens déclarés réunis", t.includes("OrthoNova") && t.includes("Comité scientifique") && t.includes("Laboratoire Alpha Ortho (fictif)"));
  await page.fill('input[name="organization"]', "Société Beta Dental (fictive)");
  await page.fill('input[name="nature"]', "Oratrice lors d'un congrès");
  await page.click('button:has-text("Ajouter le lien")');
  await page.waitForTimeout(1200);
  check("Liens d'intérêts : ajout d'un lien hors KolBase", (await text(page)).includes("Société Beta Dental (fictive)"));
  const pdf = await ctx.request.get(`${BASE}/revenus/liens-interets`);
  const body = await pdf.body();
  check("Liens d'intérêts : diapositive PDF", pdf.ok() && body.subarray(0, 5).toString() === "%PDF-");
  await page.goto(`${BASE}/revenus?onglet=transparence`);
  const item = page.locator('li:has-text("Comité scientifique aligneurs")');
  await item.locator('summary:has-text("Signaler une erreur")').click();
  await item.locator('textarea[name="comment"]').fill("Le nombre de séances indiqué est erroné : trois et non quatre.");
  await item.locator('button:has-text("Envoyer à l\'organisation")').click();
  check("Transparence : signalement envoyé à la conformité", !!(await waitMail("lea.rousseau@demo.kolbase.local", "erreur signalée par Camille Petit")));
  const other = await session();
  const r = await other.page.goto(`${BASE}/revenus/export`);
  check("Revenus : réservés au praticien connecté", r?.url().includes("/connexion") ?? false, r?.url());
  await other.ctx.close();
  // L'organisation indique le paiement : l'expert est prévenu.
  const org = await session();
  await login(org.page, "thomas.garnier@demo.kolbase.local");
  await org.page.goto(`${BASE}/organisations/demo-org-orthonova/dossiers/demo-prj-aligneurs`);
  await org.page.click('button:has-text("Marquer payé")');
  await org.page.waitForTimeout(1200);
  check("Dossier : honoraires marqués payés", (await text(org.page)).includes("Honoraires payés le"));
  check("E-mail à l'expert : honoraires payés", !!(await waitMail("camille.petit@demo.kolbase.local", "Honoraires payés par OrthoNova")));
  await org.ctx.close();
  await ctx.close();
}

// ── Book prestataire : page publique, catalogue, photos, avis vérifiés ────
{
  const anon = await session();
  await anon.page.goto(`${BASE}/structures/demo-sup-belleville`);
  let t = await text(anon.page);
  check("Book public : indicateurs, capacités et tarifs", t.includes("Délai de réponse médian") && t.includes("300 personnes en cocktail") && t.includes("Tarifs indicatifs") && /Cocktail dînatoire 12 pièces[\s\S]*32,00\s€ HT/.test(t));
  check("Book public : avis vérifié et référence", t.includes("Service ponctuel et discret") && t.includes("Références") && t.includes("Restauration"));
  await anon.ctx.close();

  // Le prestataire enrichit son book : prestation au catalogue et photo.
  const sup = await session();
  await login(sup.page, "ludovic.perrin@demo.kolbase.local");
  await sup.page.goto(`${BASE}/organisations/demo-sup-belleville/devis?onglet=fiche`);
  t = await text(sup.page);
  check("Mon book : indicateurs, photos et catalogue", /taux de réponse/i.test(t) && t.includes("Photos (0/8)") && t.includes("Catalogue de forfaits"));
  const offer = sup.page.locator("form.offer-form");
  await offer.locator('input[name="label"]').fill("Mignardises sucrées (3 pièces)");
  await offer.locator('input[name="price"]').fill("4,50");
  await offer.locator('button:has-text("Ajouter au catalogue")').click();
  await sup.page.waitForTimeout(1200);
  check("Mon book : prestation ajoutée au catalogue", (await text(sup.page)).includes("Mignardises sucrées (3 pièces)"));
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
  const photoForm = sup.page.locator("form.photo-form");
  await photoForm.locator('input[name="photo"]').setInputFiles({ name: "salle.png", mimeType: "image/png", buffer: png });
  await photoForm.locator('input[name="caption"]').fill("Buffet en salle Saône");
  await photoForm.locator('button:has-text("Ajouter la photo")').click();
  await sup.page.waitForTimeout(1500);
  const src = await sup.page.locator(".gallery img").first().getAttribute("src");
  check("Mon book : photo ajoutée", !!src && src.startsWith("/photos/"), src ?? "");
  const pub = await session();
  const res = await pub.ctx.request.get(`${BASE}${src}`);
  check("Photo du book : publique pour un prestataire référencé", res.ok() && res.headers()["content-type"] === "image/png");
  await pub.ctx.close();
  // Le catalogue préremplit une ligne de devis (quantité = participants attendus).
  const pgc = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await pgc.connect();
  await pgc.query(`insert into "Rfq" (id, "organizationId", "eventId", category, needs, status, "sentAt", headcount, city) values ('e2e-rfq-book', 'demo-org-dentalys', 'demo-ev-soiree-implanto', 'restauration', 'Pause de l''après-midi, 60 personnes.', 'sent', now(), 60, 'Lyon')`);
  await pgc.query(`insert into "RfqSupplier" ("rfqId", "supplierId") values ('e2e-rfq-book', 'demo-sup-belleville')`);
  await pgc.end();
  await sup.page.goto(`${BASE}/organisations/demo-sup-belleville/devis`);
  const qf = sup.page.locator("section:has-text(\"Pause de l'après-midi\") form.quote-form");
  const pick = qf.locator('select[aria-label="Ajouter depuis mon catalogue"]');
  const optVal = await pick.locator("option", { hasText: "Mignardises sucrées" }).getAttribute("value");
  await pick.selectOption(optVal);
  const lastLabel = qf.locator('input[name="line_label"]').last();
  const qty = await qf.locator('input[name="line_qty"]').last().inputValue();
  check("Devis : ligne préremplie depuis le catalogue", (await lastLabel.inputValue()) === "Mignardises sucrées (3 pièces)" && qty === "60" && (await qf.locator('input[name="line_unit"]').last().inputValue()) === "4,5", qty);
  await sup.ctx.close();

  // L'organisation évalue une prestation passée ; le prestataire est prévenu.
  const { ctx, page } = await session();
  await login(page, "julien.faure@demo.kolbase.local");
  await page.goto(`${BASE}/organisations/demo-org-dentalys/prestataires`);
  check("Avis déjà laissé visible sur la demande", (await page.locator("section#rfq-demo-rfq-passe-cocktail").innerText()).includes("Votre avis"));
  check("Pas d'avis possible avant la prestation", (await page.locator("section#rfq-demo-rfq-board-salle form.review-form").count()) === 0);
  const rv = page.locator("section#rfq-demo-rfq-passe-dejeuner form.review-form");
  await rv.locator('.stars label').nth(3).click();
  await rv.locator('textarea[name="comment"]').fill("Déjeuner servi à l'heure, intervenants ravis.");
  await rv.locator('button:has-text("Publier l\'avis")').click();
  await page.waitForTimeout(1200);
  check("Avis publié", (await page.locator("section#rfq-demo-rfq-passe-dejeuner").innerText()).includes("Votre avis"));
  check("E-mail au prestataire : nouvel avis", !!(await waitMail("ludovic.perrin@demo.kolbase.local", "Nouvel avis de Dentalys Implants : 4/5")));
  await page.goto(`${BASE}/organisations/demo-org-dentalys/prestataires?onglet=annuaire`);
  t = await text(page);
  check("Annuaire : note moyenne et lien vers le book", /Traiteur Belleville[\s\S]{0,40}★ 4,5/.test(t) && (await page.locator('a[href="/structures/demo-sup-belleville"]').count()) > 0);
  await ctx.close();
}

// ── Statistiques de l'organisation ─────────────────────────────────────────
{
  const { ctx, page } = await session();
  await login(page, "claire.morel@demo.kolbase.local");
  check("Statistiques : entrée dans la navigation", (await page.locator('aside a[href="/organisations/demo-org-dentalys/statistiques"]').count()) === 1);
  // Les dossiers clos de la démo sont validés il y a 281 jours (comité consultatif) : on lit cette année-là.
  const y = new Date(Date.now() - 281 * 86400e3).getUTCFullYear();
  await page.goto(`${BASE}/organisations/demo-org-dentalys/statistiques?annee=${y}`);
  let t = await text(page);
  check("Statistiques : budget, types et concentration", t.includes("Budget engagé par trimestre") && t.includes("Comité consultatif") && t.includes("Antoine Martin") && t.includes("Concentration des honoraires"));
  check("Statistiques : délais et conformité", t.includes("Validation par la conformité") && t.includes("Transparence Santé"));
  const band = page.locator(".viz-band").first();
  await band.hover();
  const tip = await page.locator(".viz-tip").innerText().catch(() => "");
  check("Graphique : info-bulle au survol", tip.includes("T1") && tip.includes("Honoraires des experts"), tip.replace(/\s+/g, " "));
  await page.locator(".viz-table summary").first().click();
  check("Graphique : vue tableau", (await page.locator(".viz-table table").first().innerText()).includes("T4"));
  const csv = await (await ctx.request.get(`${BASE}/organisations/demo-org-dentalys/statistiques/export?annee=${y}`)).text();
  check("Statistiques : export CSV", csv.includes("Budget par trimestre") && csv.includes("Honoraires par type") && csv.includes("Comité consultatif"));
  await page.goto(`${BASE}/organisations/demo-org-dentalys/statistiques?annee=${y - 1}`);
  t = await text(page);
  check("Statistiques : année précédente", t.includes("Vincent Moreau") && !t.includes("Formation DPC"));
  await ctx.close();
  // Ni un praticien extérieur, ni un prestataire, ni un visiteur anonyme.
  const ext = await session();
  await login(ext.page, "camille.petit@demo.kolbase.local");
  const r1 = await ext.page.goto(`${BASE}/organisations/demo-org-dentalys/statistiques`);
  check("Statistiques : refusées hors de l'organisation", r1?.status() === 404);
  const r2 = await ext.ctx.request.get(`${BASE}/organisations/demo-org-dentalys/statistiques/export`);
  check("Export des statistiques : refusé hors de l'organisation", r2.status() === 404);
  await ext.ctx.close();
  const sup = await session();
  await login(sup.page, "ludovic.perrin@demo.kolbase.local");
  await sup.page.goto(`${BASE}/organisations/demo-sup-belleville/statistiques`);
  check("Statistiques : sans objet pour un prestataire", !sup.page.url().includes("/statistiques"), sup.page.url());
  await sup.ctx.close();
}

// ── Pointage à l'accueil, badge, émargement et bilan ───────────────────────
{
  const pgc = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await pgc.connect();
  const orig = (await pgc.query(`select "startsAt" from "Event" where id='demo-ev-soiree-implanto'`)).rows[0].startsAt;
  await pgc.query(`update "Event" set "startsAt" = now() + interval '3 hours' where id='demo-ev-soiree-implanto'`);
  // Le participant affiche son badge.
  const part = await session();
  await login(part.page, "ines.lambert@demo.kolbase.local");
  await part.page.goto(`${BASE}/inscriptions`);
  await part.page.locator('a:has-text("Mon badge d\'accueil")').first().click();
  await part.page.waitForURL(/\/badge$/);
  check("Badge : QR code affiché", (await part.page.locator(".badge-qr svg").count()) === 1 && (await text(part.page)).includes("Présentez ce code"));
  const code = (await pgc.query(`select "checkinCode" from "Registration" where "eventId"='demo-ev-soiree-implanto' and "userId"='demo-u-lambert'`)).rows[0].checkinCode;
  check("Badge : code créé", typeof code === "string" && code.length >= 20);
  await part.page.goto(`${BASE}/pointage/${code}`);
  check("Badge scanné par son titulaire : renvoi vers le badge", part.page.url().endsWith("/badge"), part.page.url());
  // Un visiteur anonyme qui scanne doit se connecter ; un autre organisateur ne voit rien.
  const anon = await session();
  await anon.page.goto(`${BASE}/pointage/${code}`);
  check("Scan anonyme : connexion demandée", anon.page.url().includes("/connexion"), anon.page.url());
  await anon.ctx.close();
  const other = await session();
  await login(other.page, "thomas.garnier@demo.kolbase.local");
  const ro = await other.page.goto(`${BASE}/pointage/${code}`);
  check("Scan par une autre organisation : introuvable", ro?.status() === 404);
  await other.ctx.close();
  // L'organisateur scanne le badge et confirme.
  const { ctx, page } = await session();
  await login(page, "julien.faure@demo.kolbase.local");
  await page.goto(`${BASE}/pointage/${code}`);
  let t = await text(page);
  check("Scan : fiche du participant", t.includes("Inès Lambert") && t.includes("Cocktail"));
  await page.click('button:has-text("Confirmer la présence")');
  await page.waitForTimeout(1000);
  check("Scan : présence enregistrée", (await text(page)).includes("Présent ·"));
  // Liste de pointage : recherche et pointage manuel.
  await page.goto(`${BASE}/organisations/demo-org-dentalys/evenements/demo-ev-soiree-implanto/pointage`);
  t = await text(page);
  const inscrits = Number(t.match(/sur (\d+) inscrits?/)?.[1] ?? 0);
  check("Pointage : compteur", /1 présent\s+sur \d+ inscrits/.test(t) && inscrits >= 2, t.match(/\d+ présents? sur \d+ inscrits?/)?.[0]);
  await page.fill('input[type="search"]', "rober");
  check("Pointage : recherche", (await page.locator(".checkin-list li").count()) === 1);
  await page.locator('.checkin-list li:has-text("Hugo Robert") button:has-text("Présent")').click();
  await page.waitForTimeout(1000);
  check("Pointage : pointage manuel", new RegExp(`2 présents\\s+sur ${inscrits} inscrits`).test(await text(page)));
  const db1 = (await pgc.query(`select count(*)::int n from "Registration" where "eventId"='demo-ev-soiree-implanto' and "checkedInAt" is not null and "checkedInById"='demo-u-julien'`)).rows[0].n;
  check("Pointage : enregistré avec son auteur", db1 === 2);
  await page.fill('input[type="search"]', "");
  await page.locator('.checkin-list li:has-text("Hugo Robert") button:has-text("Annuler")').click();
  await page.waitForTimeout(1000);
  check("Pointage : annulation", new RegExp(`1 présent\\s+sur ${inscrits} inscrits`).test(await text(page)));
  const pdf = await ctx.request.get(`${BASE}/organisations/demo-org-dentalys/evenements/demo-ev-soiree-implanto/emargement`);
  const body = await pdf.body();
  const parsed = pdf.ok() ? await PDFDocument.load(body) : null;
  check("Feuille d'émargement : PDF", pdf.ok() && body.subarray(0, 5).toString() === "%PDF-" && parsed?.getPageCount() === 1);
  // Le pointage n'ouvre que la veille.
  await page.goto(`${BASE}/organisations/demo-org-dentalys/evenements/demo-ev-live-surgery/pointage`);
  check("Pointage : fermé avant la veille", (await text(page)).includes("Le pointage ouvrira le") && (await page.locator('.checkin-list button:has-text("Présent")').count()) === 0);
  // Bilan d'un événement passé : présents, coût réel, absents à vérifier.
  await page.goto(`${BASE}/organisations/demo-org-dentalys/evenements/demo-ev-passe`);
  t = await text(page);
  check("Bilan : présents et coût réel", t.includes("Bilan de l'événement") && /2 \/ 3/.test(t) && t.includes("67 % des inscrits"));
  check("Bilan : absente avec hospitalité signalée", t.includes("1 inscrit absent au pointage"));
  await ctx.close();
  const comp = await session();
  await login(comp.page, "sophie.bernard@demo.kolbase.local");
  await comp.page.goto(`${BASE}/organisations/demo-org-dentalys/hospitalites`);
  t = await text(comp.page);
  check("Hospitalités : absente au pointage signalée", /GIRARD Olivier\s*Absent au pointage/.test(t), t.match(/GIRARD[^\n]*/)?.[0]);
  await comp.ctx.close();
  await part.ctx.close();
  await pgc.query(`update "Event" set "startsAt" = $1 where id='demo-ev-soiree-implanto'`, [orig]);
  await pgc.end();
}

// ── Avant et après l'événement : rappel, attestation, questionnaire ──────────
{
  const pgc = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await pgc.connect();
  const orig = (await pgc.query(`select "startsAt", "durationMinutes" from "Event" where id='demo-ev-soiree-implanto'`)).rows[0];
  const taches = (auth = true) => fetch(`${BASE}/api/taches`, { method: "POST", headers: auth ? { Authorization: `Bearer ${process.env.CRON_SECRET ?? "secret-des-taches-de-test"}` } : {} });
  check("Tâches planifiées : secret exigé", (await taches(false)).status === 401);
  // La veille : rappel automatique, une seule fois.
  await pgc.query(`update "Event" set "startsAt" = now() + interval '20 hours', "durationMinutes" = 180 where id='demo-ev-soiree-implanto'`);
  const r1 = await (await taches()).json();
  check("Rappel de la veille : envoyé", r1.reminders >= 3, JSON.stringify(r1));
  const mail = await waitMail("ines.lambert@demo.kolbase.local", "Rappel : « Soirée implantologie");
  check("Rappel : lieu, programme et badge", !!mail && mail.text.includes("Hôtel des Célestins") && /\/inscriptions\/\S+\/badge/.test(mail.text));
  const r2 = await (await taches()).json();
  check("Rappel : pas de second envoi", r2.reminders === 0, JSON.stringify(r2));
  const org = await session();
  await login(org.page, "julien.faure@demo.kolbase.local");
  await org.page.goto(`${BASE}/organisations/demo-org-dentalys/evenements/demo-ev-soiree-implanto`);
  check("Événement : rappel indiqué à l'organisateur", (await text(org.page)).includes("Rappel envoyé le"));
  // Après l'événement : remerciement, attestation pour les présents, questionnaire.
  await pgc.query(`update "Event" set "startsAt" = now() - interval '5 hours' where id='demo-ev-soiree-implanto'`);
  await pgc.query(`update "Registration" set "checkedInAt" = now() - interval '5 hours' where "eventId"='demo-ev-soiree-implanto' and "userId"='demo-u-lambert'`);
  await pgc.query(`update "Registration" set "checkedInAt" = null where "eventId"='demo-ev-soiree-implanto' and "userId"<>'demo-u-lambert'`);
  const r3 = await (await taches()).json();
  check("Après l'événement : envoi aux seuls présents", r3.followUps === 1, JSON.stringify(r3));
  const thanks = await waitMail("ines.lambert@demo.kolbase.local", "Merci pour votre participation");
  check("Remerciement : attestation et questionnaire", !!thanks && thanks.text.includes("attestation") && thanks.text.includes("/evenements/demo-ev-soiree-implanto/avis"));
  check("Remerciement : pas d'envoi aux absents", !mails.some((m) => m.to === "hugo.robert@demo.kolbase.local" && m.subject.includes("Merci pour votre participation")));
  // Le participant : attestation (PDF vérifiable) et avis.
  const part = await session();
  await login(part.page, "ines.lambert@demo.kolbase.local");
  await part.page.goto(`${BASE}/inscriptions`);
  const href = await part.page.locator('.reg-tile:has-text("Soirée implantologie") a:has-text("Mon attestation de présence")').getAttribute("href");
  const pdf = await part.ctx.request.get(`${BASE}${href}`);
  const doc = pdf.ok() ? await PDFDocument.load(await pdf.body()) : null;
  check("Attestation : PDF du participant", doc?.getPageCount() === 1 && (doc?.getTitle() ?? "").includes("Inès Lambert"), doc?.getTitle());
  const code = (await pgc.query(`select "certificateCode" from "Registration" where "eventId"='demo-ev-soiree-implanto' and "userId"='demo-u-lambert'`)).rows[0].certificateCode;
  const anon = await session();
  await anon.page.goto(`${BASE}/attestation/${code}`);
  const vt = await text(anon.page);
  check("Attestation : vérification publique", vt.includes("Attestation authentique") && vt.includes("Inès Lambert") && vt.includes("Soirée implantologie"), `${code} ${vt.replace(/\s+/g, " ").slice(0, 160)}`);
  const bad = await anon.page.goto(`${BASE}/attestation/AAAAAAAAAAAAAAAAAAAA`);
  check("Attestation : code inconnu introuvable", bad?.status() === 404);
  await anon.ctx.close();
  const robertReg = (await pgc.query(`select id from "Registration" where "eventId"='demo-ev-soiree-implanto' and "userId"='demo-u-robert'`)).rows[0].id;
  const rob = await session();
  await login(rob.page, "hugo.robert@demo.kolbase.local");
  const ra = await rob.ctx.request.get(`${BASE}/inscriptions/${robertReg}/attestation`);
  check("Attestation : refusée sans présence enregistrée", ra.status() === 404);
  await rob.ctx.close();
  await part.page.goto(`${BASE}/evenements/demo-ev-soiree-implanto/avis`);
  await part.page.locator(".survey-q").nth(0).locator(".stars label").nth(3).click();
  await part.page.locator(".survey-q").nth(1).locator(".stars label").nth(4).click();
  await part.page.fill('textarea[name="comment"]', "Très bons échanges sur les cas complexes.");
  await part.page.click('button:has-text("Envoyer mon avis")');
  await part.page.waitForTimeout(1000);
  check("Questionnaire : avis enregistré", (await text(part.page)).includes("votre avis est transmis à l'organisateur"));
  await part.page.goto(`${BASE}/evenements/demo-ev-soiree-implanto/avis`);
  check("Questionnaire : une seule réponse", (await part.page.locator("form.survey-form").count()) === 0 && (await pgc.query(`select count(*)::int n from "SurveyResponse" where "eventId"='demo-ev-soiree-implanto'`)).rows[0].n === 1);
  await part.ctx.close();
  // L'organisateur : avis anonymes, attestations, statistiques.
  await org.page.goto(`${BASE}/organisations/demo-org-dentalys/evenements/demo-ev-soiree-implanto`);
  let t = await text(org.page);
  check("Organisateur : avis des participants", t.includes("Avis des participants") && /4,0\s*\/\s*5/.test(t) && t.includes("Très bons échanges") && !/Lambert[^\n]*Très bons/.test(t));
  check("Organisateur : envoi après l'événement indiqué", t.includes("Envoyés le"));
  const all = await org.ctx.request.get(`${BASE}/organisations/demo-org-dentalys/evenements/demo-ev-soiree-implanto/attestations`);
  check("Organisateur : attestations des présents (PDF)", all.ok() && (await PDFDocument.load(await all.body())).getPageCount() === 1);
  await org.page.goto(`${BASE}/organisations/demo-org-dentalys/statistiques`);
  check("Statistiques : satisfaction", /satisfaction/i.test(await text(org.page)) && /4,0 ★/.test(await text(org.page)));
  await org.ctx.close();
  await pgc.query(`update "Event" set "startsAt" = $1, "durationMinutes" = $2 where id='demo-ev-soiree-implanto'`, [orig.startsAt, orig.durationMinutes]);
  await pgc.end();
}

// ── Notes d'honoraires : l'expert les établit, l'organisation les retrouve ──
{
  const { ctx, page } = await session();
  await login(page, "camille.petit@demo.kolbase.local");
  await page.goto(`${BASE}/revenus?onglet=facturation`);
  let t = await text(page);
  check("Notes d'honoraires : note existante et convention à facturer", /NH-\d{4}-001/.test(t) && t.includes("Comité scientifique aligneurs"));
  await page.fill('input[name="siret"]', "12345678901234");
  await page.click('form:has(textarea[name="billingAddress"]) button:has-text("Enregistrer")');
  await page.waitForTimeout(800);
  check("Facturation : SIRET invalide refusé", (await text(page)).includes("Numéro SIRET invalide"));
  await page.goto(`${BASE}/revenus?onglet=facturation`);
  await page.locator('li:has-text("Comité scientifique aligneurs") button:has-text("Établir la note")').click();
  await page.waitForTimeout(1200);
  await page.goto(`${BASE}/revenus?onglet=facturation`);
  const row = await page.locator('tr:has-text("Comité scientifique aligneurs")').innerText().catch(() => "");
  const num = row.match(/NH-\d{4}-\d{3}/)?.[0];
  check("Note d'honoraires établie et numérotée", !!num && !num.endsWith("-001"), num ?? row);
  check("Organisation prévenue de la note", !!(await waitMail("thomas.garnier@demo.kolbase.local", `Note d'honoraires ${num}`)));
  const href = await page.locator(`a:has-text("${num}")`).first().getAttribute("href");
  const own = await ctx.request.get(`${BASE}${href}`);
  const doc = own.ok() ? await PDFDocument.load(await own.body()) : null;
  check("Note d'honoraires : PDF pour l'expert", doc?.getTitle() === `Note d'honoraires ${num}`, doc?.getTitle());
  await ctx.close();
  const org = await session();
  await login(org.page, "thomas.garnier@demo.kolbase.local");
  await org.page.goto(`${BASE}/organisations/demo-org-orthonova/dossiers/demo-prj-aligneurs`);
  check("Dossier : note d'honoraires de l'expert", (await text(org.page)).includes(`Note d'honoraires ${num}`));
  check("Note d'honoraires : PDF pour l'organisation", (await org.ctx.request.get(`${BASE}${href}`)).ok());
  await org.ctx.close();
  const other = await session();
  await login(other.page, "claire.morel@demo.kolbase.local");
  check("Note d'honoraires : refusée à une autre organisation", (await other.ctx.request.get(`${BASE}${href}`)).status() === 404);
  await other.ctx.close();
}

// ── Déclaration Transparence Santé : fichier du semestre ────────────────────
{
  const sem = (d) => `${d.getFullYear()}-S${d.getMonth() < 6 ? 1 : 2}`;
  const signed = sem(new Date(Date.now() - 26 * 86400e3)); // comité scientifique signé il y a 26 jours
  const { ctx, page } = await session();
  await login(page, "lea.rousseau@demo.kolbase.local");
  await page.goto(`${BASE}/organisations/demo-org-orthonova/conformite?onglet=transparence&periode=${signed}`);
  const t = await text(page);
  check("Transparence : préparation de la déclaration", t.includes("Préparer la déclaration") && /Télécharger le fichier \(\d+ lignes?\)/.test(t));
  const csv = await (await ctx.request.get(`${BASE}/organisations/demo-org-orthonova/conformite/declaration?periode=${signed}`)).text();
  const lines = csv.replace(/^﻿/, "").split("\r\n").map((l) => l.split(";"));
  const head = lines[0];
  const col = (name) => head.indexOf(name);
  const conv = lines.find((l) => l[col("Déclaration")] === "Convention" && l[col("Information convention")].includes("Comité scientifique aligneurs"));
  check("Fichier : en-têtes de la plateforme", col("Identifiant unique") >= 0 && col("Convention liée") >= 0 && col("Objet convention / nature avantage") >= 0);
  check("Fichier : convention du comité scientifique", !!conv && conv[col("Objet convention / nature avantage")] === "Contrat d'expert scientifique" && conv[col("Montant des conventions / avantages / rémunération")] === "4500" && conv[col("Identité / Nom")] === "PETIT", conv?.join(" | "));
  const rem = lines.filter((l) => l[col("Déclaration")] === "Rémunération");
  check("Fichier : rémunérations rattachées à leur convention", rem.every((l) => lines.some((c) => c[col("Identifiant unique")] === l[col("Convention liée")])));
  await page.click('button:has-text("Tout marquer publié")');
  await page.waitForTimeout(1000);
  check("Transparence : semestre marqué publié", /Télécharger le fichier \(0 ligne\)/.test(await text(page)));
  await ctx.close();
  const comp = await session();
  await login(comp.page, "sophie.bernard@demo.kolbase.local");
  const passe = sem(new Date(Date.now() - 40 * 86400e3));
  await comp.page.goto(`${BASE}/organisations/demo-org-dentalys/conformite?onglet=transparence&periode=${passe}`);
  check("Transparence : avantages d'absents exclus du fichier", (await text(comp.page)).includes("absents au pointage"));
  await comp.ctx.close();
}

// ── IA : suggestion d'experts et relecture assistée d'un dossier ───────────
{
  const { ctx, page } = await session();
  await login(page, "julien.faure@demo.kolbase.local");
  await page.goto(`${BASE}/organisations/demo-org-dentalys/dossiers/nouveau`);
  await page.fill('input[name="title"]', "Board implants courts et mise en charge immédiate");
  await page.fill('input[name="therapeuticArea"]', "Implantologie");
  await page.click('button:has-text("Suggérer des experts")');
  await page.waitForSelector(".suggest-box", { timeout: 15000 });
  const box = await page.locator(".suggest-box").innerText();
  check("Suggestion d'experts : profils pertinents et explications", box.includes("Vincent Moreau") && box.includes("Spécialité : Implantologie"), box.replace(/\s+/g, " ").slice(0, 200));
  check("Suggestion d'experts : diversité signalée", /Vincent Moreau[\s\S]*?(Déjà \d+ % de vos honoraires|collaborations? avec vous)/.test(box));
  check("Suggestion d'experts : synthèse de l'assistant", box.includes("PROPOSITION IA"));
  await page.locator('.suggest-list li:has-text("Vincent Moreau") button:has-text("Ajouter")').click();
  check("Suggestion d'experts : ajout au dossier", (await page.locator('.fee-row:has-text("Vincent Moreau")').count()) === 1);
  await page.goto(`${BASE}/organisations/demo-org-dentalys/dossiers/demo-prj-symposium`);
  check("Relecture assistée : réservée à la conformité", (await page.locator('button:has-text("Analyser le dossier avec l\'IA")').count()) === 0);
  await ctx.close();
  const comp = await session();
  await login(comp.page, "sophie.bernard@demo.kolbase.local");
  await comp.page.goto(`${BASE}/organisations/demo-org-dentalys/dossiers/demo-prj-symposium`);
  const before = aiRequests.length;
  await comp.page.click('button:has-text("Analyser le dossier avec l\'IA")');
  await comp.page.waitForSelector(".ai-review", { timeout: 15000 });
  check("Relecture assistée : analyse affichée", (await comp.page.locator(".ai-review").innerText()).includes("PROPOSITION IA"));
  const prompt = String(aiRequests.slice(before).at(-1)?.messages?.[0]?.content ?? "");
  check("Relecture assistée : contrôles KolBase transmis", prompt.includes("Points à vérifier") && prompt.includes("Antoine Martin") && prompt.includes("dans la fourchette") && prompt.includes("Régime calculé"));
  await comp.ctx.close();
}

// ── Prise en main, contrat de sous-traitance, purge et lancement ────────────
{
  const { ctx, page } = await session();
  await login(page, "claire.morel@demo.kolbase.local");
  await page.goto(`${BASE}/organisations/demo-org-dentalys`);
  let t = await text(page);
  check("Prise en main : étapes de l'administrateur", t.includes("Prise en main") && t.includes("Accepter le contrat de sous-traitance (RGPD)"));
  await page.goto(`${BASE}/organisations/demo-org-dentalys/membres?onglet=organisation`);
  await page.click('button:has-text("Accepter au nom de Dentalys Implants")');
  await page.waitForTimeout(1000);
  check("Sous-traitance : contrat accepté et tracé", (await text(page)).includes("Accepté le") && (await text(page)).includes("Claire Morel"));
  await page.goto(`${BASE}/organisations/demo-org-dentalys`);
  check("Prise en main : étape cochée", (await page.locator('.onboarding-steps li.done:has-text("contrat de sous-traitance")').count()) === 1 || !(await text(page)).includes("Prise en main"));
  await ctx.close();
  const pub = await session();
  await pub.page.goto(`${BASE}/sous-traitance`);
  t = await text(pub.page);
  check("Sous-traitance : contrat public (article 28)", t.includes("Contrat de sous-traitance") && t.includes("Sous-traitants ultérieurs") && t.includes("MUTARA"));
  await pub.ctx.close();
  const pr = await session();
  await login(pr.page, "julien.faure@demo.kolbase.local");
  await pr.page.goto(`${BASE}/organisations/demo-org-dentalys`);
  check("Prise en main : réservée aux administrateurs", !(await text(pr.page)).includes("Prise en main"));
  await pr.ctx.close();
  // Purge : sessions expirées depuis plus de 30 jours.
  const pgc = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await pgc.connect();
  await pgc.query(`insert into "Session" (id, "tokenHash", "userId", "expiresAt") values ('e2e-old-session', 'e2e-old-hash', 'demo-u-claire', now() - interval '40 days')`);
  const r = await (await fetch(`${BASE}/api/taches`, { method: "POST", headers: { Authorization: `Bearer ${process.env.CRON_SECRET ?? "secret-des-taches-de-test"}` } })).json();
  const left = (await pgc.query(`select count(*)::int n from "Session" where id = 'e2e-old-session'`)).rows[0].n;
  check("Conservation : sessions expirées purgées", left === 0 && r.purged?.sessions >= 1, JSON.stringify(r));
  await pgc.end();
  const adm = await session();
  await login(adm.page, "anne.chevalier@demo.kolbase.local");
  await adm.page.goto(`${BASE}/admin?onglet=lancement`);
  check("Lancement : tâches planifiées vérifiées", /OK\s+Tâches planifiées/.test(await text(adm.page)));
  await adm.ctx.close();
}

// ── Articles de lancement : en brouillon, invisibles du public ─────────────
{
  const anon = await session();
  await anon.page.goto(`${BASE}/actualites`);
  check("Articles de lancement : non publiés", !(await text(anon.page)).includes("La lettre d'information de KolBase : les événements"));
  const r = await anon.page.goto(`${BASE}/actualites/la-lettre-d-information-de-kolbase`);
  check("Article en brouillon : introuvable pour le public", r.status() === 404);
  await anon.ctx.close();
  const adm = await session();
  await login(adm.page, "anne.chevalier@demo.kolbase.local");
  await adm.page.goto(`${BASE}/admin?onglet=actualites`);
  const t = await text(adm.page);
  check("Articles de lancement : brouillons dans l'admin", t.includes("Experts : ce que change le référencement sur KolBase") && t.includes("Organisations : une collaboration conforme"));
  await adm.page.goto(`${BASE}/actualites/organisations-une-collaboration-conforme-de-la-sollicitation-a-la-declaration`);
  const a = await text(adm.page);
  check("Article de lancement : aperçu mis en forme", a.includes("Brouillon") && (await adm.page.locator("article h2").count()) >= 5 && !a.includes("**"));
  await adm.ctx.close();
}

// ── Actualités administrables ───────────────────────────────────────────────
{
  const anon = await session();
  await anon.page.goto(`${BASE}/actualites`);
  check("Actualités : rubrique publique", (await text(anon.page)).includes("Attestations de présence vérifiables"));
  const { ctx, page } = await session();
  await login(page, "anne.chevalier@demo.kolbase.local");
  await page.goto(`${BASE}/admin?onglet=actualites`);
  await page.click('a:has-text("Nouvelle actualité")');
  await page.fill('input[name="title"]', "Nouveau : rubrique Actualités");
  await page.fill('textarea[name="excerpt"]', "KolBase publie ses nouveautés et des repères réglementaires.");
  await page.fill('textarea[name="body"]', "Premier paragraphe avec **du gras**.\n\n## Ce qui change\n\n- un point\n- un autre point\n\nVoir [l'aide](/aide).");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
  await page.locator('input[name="cover"]').setInputFiles({ name: "une.png", mimeType: "image/png", buffer: png });
  await Promise.all([page.waitForURL(/\/admin\/actualites\/[^/?]+\?cree=1/), page.click('button:has-text("Créer le brouillon")')]);
  check("Actualités : brouillon créé", (await text(page)).includes("Brouillon créé"));
  await anon.page.goto(`${BASE}/actualites`);
  check("Actualités : brouillon invisible du public", !(await text(anon.page)).includes("rubrique Actualités"));
  await page.click('button:has-text("Publier")');
  await page.waitForTimeout(1000);
  await anon.page.goto(`${BASE}/actualites/nouveau-rubrique-actualites`);
  const t = await text(anon.page);
  check("Actualités : article publié et mis en forme", t.includes("Nouveau : rubrique Actualités") && (await anon.page.locator(".article-body h2").innerText()) === "Ce qui change" && (await anon.page.locator('.article-body a[href="/aide"]').count()) === 1 && (await anon.page.locator(".article-body li").count()) === 2);
  const cover = await anon.page.locator(".article-cover").getAttribute("src");
  check("Actualités : image publique", !!cover && (await anon.ctx.request.get(`${BASE}${cover}`)).ok());
  await anon.page.goto(`${BASE}/`);
  check("Accueil : dernières actualités", (await text(anon.page)).includes("Les nouvelles de KolBase") && (await text(anon.page)).includes("Nouveau : rubrique Actualités"));
  await page.click('button:has-text("Repasser en brouillon")');
  await page.waitForTimeout(1000);
  const gone = await anon.page.goto(`${BASE}/actualites/nouveau-rubrique-actualites`);
  check("Actualités : dépublication", gone?.status() === 404);
  await ctx.close();
  const other = await session();
  await login(other.page, "claire.morel@demo.kolbase.local");
  const r = await other.page.goto(`${BASE}/admin/actualites/nouveau`);
  check("Actualités : rédaction réservée à l'équipe KolBase", r?.status() === 404);
  await other.ctx.close();
  await anon.ctx.close();
}

// ── Facturation : abonnement organisation (première action engageante) et prestataire ──
{
  const pgc = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await pgc.connect();
  await pgc.query(`delete from "Subscription" where "organizationId" in ('demo-org-cdra', 'demo-sup-belleville')`);
  const { ctx, page } = await session();
  await login(page, "pierre.vidal@demo.kolbase.local");
  const fillDossier = async (title) => {
    await page.goto(`${BASE}/organisations/demo-org-cdra/dossiers/nouveau`);
    await page.fill('input[name="title"]', title);
    await page.locator(".expert-pick label.check input").first().check();
    const fee = page.locator('input[name^="fee_"]').first();
    if (!(await fee.inputValue())) await fee.fill("1500");
    await page.click('button:has-text("Envoyer les sollicitations")');
    await page.waitForTimeout(1500);
  };
  await page.goto(`${BASE}/organisations/demo-org-cdra/dossiers/nouveau`);
  check("Abonnement : bandeau avant la première action engageante", (await text(page)).includes("l'abonnement de l'organisation doit être activé"));
  await fillDossier("Conférence implantologie — facturation");
  check("Abonnement : sollicitation refusée tant qu'il n'est pas activé", (await text(page)).includes("Membres et réglages › Abonnement") && page.url().endsWith("/dossiers/nouveau"));
  await page.goto(`${BASE}/organisations/demo-org-cdra/abonnement`);
  let t = await text(page);
  check("Abonnement : page de l'organisation (tarif, déclencheur)", t.includes("599 € HT par mois") && t.includes("première action qui engage un tiers"));
  check("Abonnement : formule annuelle proposée (deux mois offerts)", t.replace(/\s/g, " ").includes("5 990 € HT par an") && t.includes("2 mois offerts") && t.replace(/\s/g, " ").includes("Soit 499,17 € HT par mois"));
  await page.click('button:has-text("Activer l\'abonnement mensuel")');
  await page.waitForURL(/\/abonnement\?session=cs_/, { timeout: 15000 });
  t = await text(page);
  const session1 = [...stripeState.sessions.values()].at(-1);
  check("Stripe : paiement mensuel 599 € HT, 30 jours offerts, carte et SEPA", session1?.amount === 59900 && session1?.interval === "month" && session1?.trialDays === "30" && session1?.methods.includes("sepa_debit") && session1?.mode === "subscription", JSON.stringify(session1));
  check("Abonnement : mois offert en cours", t.includes("Premier mois offert") && /mois offert jusqu/i.test(t));
  check("Stripe : notification signée acceptée", stripeState.webhooks.at(-1)?.status === 200);
  await fillDossier("Conférence implantologie — abonnement actif");
  check("Abonnement actif : sollicitation envoyée", /\/dossiers\/[^/]+$/.test(page.url()) && !page.url().endsWith("/nouveau"), page.url());
  const sub = [...stripeState.subscriptions.values()].at(-1);
  await stripeWebhook("customer.subscription.updated", { ...sub, status: "past_due" });
  await page.goto(`${BASE}/organisations/demo-org-cdra/abonnement`);
  check("Paiement en échec : signalé, sans blocage", (await text(page)).includes("Paiement en attente"));
  await stripeWebhook("customer.subscription.deleted", { ...sub, status: "canceled" });
  await page.goto(`${BASE}/organisations/demo-org-cdra/abonnement`);
  check("Résiliation : réactivation proposée sans nouveau mois offert", (await text(page)).includes("Résilié") && (await page.locator('button:has-text("Réactiver l\'abonnement")').count()) === 2 && !(await text(page)).includes("jours offerts"));
  await page.goto(`${BASE}/organisations/demo-org-cdra/dossiers`);
  check("Résiliation : dossiers toujours accessibles", (await text(page)).includes("abonnement actif"));
  // Réactivation à l'année : dix mois facturés, sans nouveau mois offert.
  await page.goto(`${BASE}/organisations/demo-org-cdra/abonnement`);
  await page.click('button:has-text("Réactiver l\'abonnement annuel")');
  await page.waitForURL(/\/abonnement\?session=cs_/, { timeout: 15000 });
  const session2 = [...stripeState.sessions.values()].at(-1);
  t = await text(page);
  const interval = (await pgc.query(`select interval from "Subscription" where "organizationId" = 'demo-org-cdra'`)).rows[0]?.interval;
  check("Stripe : formule annuelle 5 990 € HT, sans nouveau mois offert", session2?.amount === 599000 && session2?.interval === "year" && !session2?.trialDays && interval === "year", JSON.stringify({ amount: session2?.amount, interval: session2?.interval, trial: session2?.trialDays, db: interval }));
  check("Abonnement annuel : formule et renouvellement affichés", t.includes("Actif") && t.includes("Annuelle") && t.includes("renouvellement annuel"));
  const forged = await fetch(`${BASE}/api/stripe/webhook`, { method: "POST", headers: { "Stripe-Signature": "t=1,v1=00" }, body: JSON.stringify({ type: "customer.subscription.updated", data: { object: { ...sub, status: "active" } } }) });
  check("Stripe : notification non signée refusée", forged.status === 400);
  await ctx.close();
  // Prestataire : gratuit jusqu'au premier devis retenu, puis abonnement pour répondre à de nouvelles demandes.
  await pgc.query(`insert into "Rfq" (id, "organizationId", category, needs, status, "sentAt", headcount, city) values ('e2e-rfq-billing', 'demo-org-dentalys', 'restauration', 'Plateau-repas pour 12 personnes, réunion de travail.', 'sent', now(), 12, 'Lyon')`);
  await pgc.query(`insert into "RfqSupplier" ("rfqId", "supplierId") values ('e2e-rfq-billing', 'demo-sup-belleville')`);
  const sup = await session();
  await login(sup.page, "ludovic.perrin@demo.kolbase.local");
  await sup.page.goto(`${BASE}/organisations/demo-sup-belleville/devis`);
  const qf = sup.page.locator('section:has-text("Plateau-repas pour 12 personnes") form.quote-form');
  await qf.locator('input[name="line_label"]').first().fill("Plateau-repas");
  await qf.locator('input[name="line_qty"]').first().fill("12");
  await qf.locator('input[name="line_unit"]').first().fill("24");
  await qf.locator('button:has-text("Envoyer le devis")').click();
  await sup.page.waitForTimeout(1200);
  check("Prestataire : après un devis retenu, l'abonnement est demandé", (await qf.innerText().catch(() => "")).includes("répondre à de nouvelles demandes de devis") || (await text(sup.page)).includes("répondre à de nouvelles demandes de devis"));
  await sup.page.goto(`${BASE}/organisations/demo-sup-belleville/abonnement`);
  check("Prestataire : abonnement 249 € HT, référencement gratuit", (await text(sup.page)).includes("249 € HT par mois") && (await text(sup.page)).includes("référencement dans l'annuaire"));
  await sup.ctx.close();
  await pgc.query(`insert into "Rfq" (id, "organizationId", category, needs, status, "sentAt", headcount, city) values ('e2e-rfq-trigger', 'demo-org-dentalys', 'restauration', 'Pause café pour 20 personnes.', 'sent', now(), 20, 'Lyon')`);
  await pgc.query(`insert into "RfqSupplier" ("rfqId", "supplierId") values ('e2e-rfq-trigger', 'demo-sup-tablesdusud')`);
  await pgc.query(`insert into "Quote" (id, "rfqId", "supplierId", "amountCents", status, "updatedAt") values ('e2e-quote-trigger', 'e2e-rfq-trigger', 'demo-sup-tablesdusud', 24000, 'submitted', now())`);
  const org = await session();
  await login(org.page, "julien.faure@demo.kolbase.local");
  await org.page.goto(`${BASE}/organisations/demo-org-dentalys/prestataires`);
  await org.page.locator('section#rfq-e2e-rfq-trigger .quote:has-text("Les Tables du Sud") button:has-text("Retenir")').click();
  await org.page.waitForTimeout(1200);
  const trig = (await pgc.query(`select "triggeredBy" from "Subscription" where "organizationId" = 'demo-sup-tablesdusud'`)).rows[0]?.triggeredBy ?? "";
  check("Prestataire : premier devis retenu, abonnement déclenché", trig.includes("Premier devis retenu par Dentalys"), trig);
  await org.ctx.close();
  // L'équipe KolBase offre l'abonnement (pilote, partenaire).
  const adm = await session();
  await login(adm.page, "anne.chevalier@demo.kolbase.local");
  await adm.page.goto(`${BASE}/admin?onglet=abonnements`);
  check("Admin : formule annuelle comptée pour un douzième", (await text(adm.page)).replace(/\s/g, " ").includes("revenu mensuel hors essais : 499,17 € HT") && (await adm.page.locator('tr:has-text("Collège Dentaire Rhône-Alpes")').innerText()).includes("annuel"));
  const row = adm.page.locator('tr:has-text("Collège Dentaire Rhône-Alpes")');
  await row.locator('input[name="until"]').fill(`${new Date().getFullYear() + 1}-06-30`);
  await row.locator('input[name="note"]').fill("Pilote");
  await row.locator('button:has-text("offrir")').click();
  await adm.page.waitForTimeout(1000);
  check("Admin : gratuité accordée", (await adm.page.locator('tr:has-text("Collège Dentaire Rhône-Alpes")').innerText()).includes("Offert par KolBase"));
  await adm.ctx.close();
  await pgc.end();
}

// ── Lettre d'information : proposée une fois à l'accueil, encart des actualités ──
{
  const no = await session();
  await login(no.page, "emma.simon@demo.kolbase.local");
  await no.page.goto(`${BASE}/tableau-de-bord`);
  check("Accueil : lettre d'information proposée", (await text(no.page)).includes("Recevoir la lettre d'information de KolBase ?"));
  await no.page.click('button:has-text("Non merci")');
  await no.page.waitForTimeout(800);
  await no.page.goto(`${BASE}/tableau-de-bord`);
  check("Accueil : « Non merci » respecté, plus reproposé", !(await text(no.page)).includes("Recevoir la lettre d'information de KolBase ?"));
  await no.ctx.close();
  const yes = await session();
  await login(yes.page, "camille.petit@demo.kolbase.local");
  await yes.page.goto(`${BASE}/tableau-de-bord`);
  await yes.page.click('button:has-text("Oui, je m\'abonne")');
  await yes.page.waitForTimeout(800);
  await yes.page.goto(`${BASE}/actualites`);
  check("Actualités : abonnement confirmé", (await text(yes.page)).includes("Vous êtes abonné à la lettre d'information"));
  await yes.page.goto(`${BASE}/compte`);
  check("Mon compte : case de la lettre cochée", await yes.page.locator('input[name="newsletter"]').isChecked());
  await yes.ctx.close();
  const anon = await session();
  await anon.page.goto(`${BASE}/actualites`);
  const cta = anon.page.locator('.newsletter-cta a:has-text("Créer un compte gratuit")');
  check("Actualités : inscription proposée aux visiteurs", (await cta.count()) === 1 && (await cta.getAttribute("href")) === "/inscription?next=%2Factualites");
  await anon.ctx.close();
}

// ── Services KolBase sur les événements : commande, réalisation, e-mailing, facturation ──
{
  const pgc = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await pgc.connect();
  // Deux praticiens acceptent la lettre d'information depuis « Mon compte ».
  for (const email of ["ines.lambert@demo.kolbase.local", "hugo.robert@demo.kolbase.local"]) {
    const p = await session();
    await login(p.page, email);
    await p.page.goto(`${BASE}/compte`);
    await p.page.locator('input[name="newsletter"]').check();
    await p.page.locator('form:has(input[name="newsletter"]) button:has-text("Enregistrer")').click();
    await p.page.waitForTimeout(800);
    await p.ctx.close();
  }
  const subs = (await pgc.query(`select count(*)::int n from "User" where "notifyPrefs"->>'newsletter' = 'true'`)).rows[0].n;
  check("Lettre d'information : consentement enregistré", subs >= 2, String(subs));
  // L'organisateur commande deux services pour un événement publié.
  const { ctx, page } = await session();
  await login(page, "julien.faure@demo.kolbase.local");
  await page.goto(`${BASE}/organisations/demo-org-dentalys/evenements/demo-ev-soiree-implanto`);
  check("Événement : services KolBase proposés", (await text(page)).includes("Faire connaître l'événement") && (await text(page)).includes("E-mailing dédié aux membres KolBase"));
  const orderIt = async (label) => {
    const li = page.locator(`.service-list li:not(.service-pack):has-text("${label}")`);
    await li.locator('button:has-text("Commander")').click();
    await li.locator('textarea[name="brief"]').fill("Mettre en avant les cas cliniques complexes.");
    await li.locator('button:has-text("Commander —")').click();
    await page.waitForTimeout(1200);
  };
  await orderIt("E-mailing dédié aux membres KolBase");
  check("Commande : transmise à l'équipe KolBase", (await text(page)).includes("Commande transmise") || (await text(page)).includes("Demandée"));
  check("Commande : équipe KolBase prévenue", !!(await waitMail("anne.chevalier@demo.kolbase.local", "Service commandé : E-mailing dédié")));
  await page.goto(`${BASE}/organisations/demo-org-dentalys/evenements/demo-ev-soiree-implanto`);
  await orderIt("À la une de la page d'accueil");
  // L'équipe KolBase : mise à la une, e-mailing.
  const adm = await session();
  await login(adm.page, "anne.chevalier@demo.kolbase.local");
  await adm.page.goto(`${BASE}/admin?onglet=services`);
  check("Admin : commandes à traiter", (await text(adm.page)).includes("Commandes à traiter (2)"));
  const une = adm.page.locator('li.card:has-text("À la une de la page")');
  await une.locator('button:has-text("marquer réalisé")').click();
  await adm.page.waitForTimeout(1000);
  const anon = await session();
  await anon.page.goto(`${BASE}/`);
  const firstCard = await anon.page.locator(".event-card").first().innerText();
  check("Accueil : événement à la une en tête de l'agenda", firstCard.includes("Soirée implantologie") && /à la une/i.test(firstCard), firstCard.replace(/\s+/g, " ").slice(0, 80));
  await anon.ctx.close();
  await adm.page.goto(`${BASE}/admin?onglet=services`);
  check("Admin : service à facturer hors Stripe signalé", (await text(adm.page)).includes("à facturer hors Stripe"));
  await adm.page.locator('li.card:has-text("E-mailing dédié") a:has-text("Préparer l\'e-mailing")').click();
  await adm.page.waitForURL(/\/admin\/services\//);
  await adm.page.click('button:has-text("Proposer un texte avec l\'IA")');
  await adm.page.waitForFunction(() => document.querySelector('textarea[name="body"]')?.value.includes("PROPOSITION IA"), null, { timeout: 15000 });
  await adm.page.click('button:has-text("Envoyer à")');
  await adm.page.waitForTimeout(2000);
  check("E-mailing : envoyé aux membres consentants", /Lettre envoyée à \d+ membre/.test(await text(adm.page)));
  const nl = await waitMail("ines.lambert@demo.kolbase.local", /^Soirée implantologie.* — /);
  check("E-mailing : annonceur identifié et désinscription", !!nl && nl.text.includes("Communication de Dentalys Implants, diffusée par KolBase") && /\/desinscription\/[A-Za-z0-9_-]+/.test(nl.text));
  check("E-mailing : pas d'envoi sans consentement", !mails.some((m) => m.to === "olivier.girard@demo.kolbase.local" && /^Soirée implantologie.* — /.test(m.subject)));
  check("Organisateur prévenu de la réalisation", !!(await waitMail("julien.faure@demo.kolbase.local", "Service KolBase : E-mailing dédié")));
  await page.goto(`${BASE}/organisations/demo-org-dentalys/evenements/demo-ev-soiree-implanto`);
  check("Événement : services réalisés affichés", ((await text(page)).match(/Réalisée/g) ?? []).length >= 2);
  // Désinscription depuis le lien reçu, et en un clic.
  const link = nl.text.match(/https?:\/\/\S+\/desinscription\/[A-Za-z0-9_-]+/)[0].replace(/^https?:\/\/[^/]+/, BASE);
  const un = await session();
  await un.page.goto(link);
  await un.page.click('button:has-text("Me désinscrire")');
  await un.page.waitForTimeout(800);
  check("Désinscription : confirmée sans connexion", (await text(un.page)).includes("C'est fait"));
  await un.ctx.close();
  const token = link.split("/").at(-1);
  const robert = (await pgc.query(`select "unsubscribeToken" from "User" where id = 'demo-u-robert'`)).rows[0].unsubscribeToken;
  const oneClick = await fetch(`${BASE}/api/desinscription/${robert}`, { method: "POST" });
  const still = (await pgc.query(`select count(*)::int n from "User" where "notifyPrefs"->>'newsletter' = 'true' and id in ('demo-u-lambert', 'demo-u-robert')`)).rows[0].n;
  check("Désinscription en un clic (List-Unsubscribe)", oneClick.status === 200 && still === 0 && !!token);
  // Facturation Stripe d'un service pour une organisation abonnée (client Stripe existant).
  const cdra = await session();
  await login(cdra.page, "pierre.vidal@demo.kolbase.local");
  await cdra.page.goto(`${BASE}/organisations/demo-org-cdra/evenements/demo-ev-journee-cdra`);
  const li = cdra.page.locator('.service-list li:not(.service-pack):has-text("réseaux sociaux")');
  await li.locator('button:has-text("Commander")').click();
  await li.locator('button:has-text("Commander —")').click();
  await cdra.page.waitForTimeout(1000);
  await cdra.ctx.close();
  await adm.page.goto(`${BASE}/admin?onglet=services`);
  await adm.page.locator('li.card:has-text("Collège Dentaire") input[name="resultUrl"]').fill("https://www.linkedin.com/posts/kolbase-test");
  await adm.page.locator('li.card:has-text("Collège Dentaire") button:has-text("marquer réalisé")').click();
  await adm.page.waitForTimeout(1200);
  const item = stripeState.invoiceItems.at(-1);
  check("Service facturé sur la prochaine facture Stripe", item?.amount === 29000 && item?.currency === "eur" && item?.description.includes("Publication sur les réseaux sociaux"), JSON.stringify(item));
  await adm.ctx.close();
  await ctx.close();
  await pgc.end();
}

// ── Bilan des services : lien suivi, inscriptions attribuées, bilan envoyé ──
{
  const pgc = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await pgc.connect();
  const ord = (await pgc.query(`select o.id, o."trackCode" from "ServiceOrder" o join "ServiceOffer" f on f.id = o."offerId" where o."eventId" = 'demo-ev-soiree-implanto' and f.kind = 'newsletter' and o.status = 'realisee'`)).rows[0];
  check("E-mailing : lien d'inscription suivi", !!ord?.trackCode && mails.some((m) => m.to === "ines.lambert@demo.kolbase.local" && m.text.includes(`/r/${ord.trackCode}`)));
  const bot = await fetch(`${BASE}/r/${ord.trackCode}`, { redirect: "manual", headers: { "user-agent": "LinkedInBot/1.0 (compatible; Mozilla/5.0)" } });
  const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
  const ctx = await browser.newContext({ locale: "fr-FR", userAgent: UA });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/r/${ord.trackCode}`);
  check("Lien suivi : redirection vers la page de l'événement", page.url().endsWith("/evenements/demo-ev-soiree-implanto"), page.url());
  await page.goto(`${BASE}/r/${ord.trackCode}`);
  const c = (await pgc.query(`select count(*)::int n, count(distinct visitor)::int v from "ServiceClick" where "orderId" = $1`, [ord.id])).rows[0];
  check("Lien suivi : robots exclus, visiteur compté une fois", bot.status === 302 && c.n === 2 && c.v === 1, JSON.stringify(c));
  // Le visiteur se connecte puis s'inscrit : inscription attribuée à l'e-mailing.
  const who = (await pgc.query(`select u.email from "User" u join "PractitionerProfile" p on p."userId" = u.id where u.email like '%@demo.kolbase.local' and u."passwordHash" is not null and not exists (select 1 from "Registration" r where r."userId" = u.id and r."eventId" = 'demo-ev-soiree-implanto') order by u.email limit 1`)).rows[0].email;
  await login(page, who);
  await page.goto(`${BASE}/evenements/demo-ev-soiree-implanto`);
  if (await page.locator('input[name="ackHcp"]').count()) await page.check('input[name="ackHcp"]');
  await page.click('button:has-text("M\'inscrire")');
  await page.waitForTimeout(1200);
  const reg = (await pgc.query(`select r."sourceOrderId" from "Registration" r join "User" u on u.id = r."userId" where u.email = $1 and r."eventId" = 'demo-ev-soiree-implanto'`, [who])).rows[0];
  check("Inscription attribuée au service (cookie du lien suivi)", reg?.sourceOrderId === ord.id, `${who} ${JSON.stringify(reg)}`);
  await ctx.close();
  // L'organisateur voit le bilan sur la fiche de l'événement.
  const org = await session();
  await login(org.page, "julien.faure@demo.kolbase.local");
  await org.page.goto(`${BASE}/organisations/demo-org-dentalys/evenements/demo-ev-soiree-implanto`);
  const orgText = await text(org.page);
  check("Fiche de l'événement : bilan du service", orgText.includes("1 visiteur du lien") && orgText.includes("1 inscription par ce lien") && orgText.includes("100 % des visiteurs inscrits"));
  await org.ctx.close();
  // Mise à la une : lien suivi depuis l'accueil (sans préchargement).
  const anon = await session();
  await anon.page.goto(`${BASE}/`);
  const featuredHref = await anon.page.locator(".event-card").first().locator("a.btn").getAttribute("href");
  check("Accueil : lien suivi sur l'événement à la une", /^\/r\/[A-Za-z0-9_-]+$/.test(featuredHref ?? ""), featuredHref ?? "");
  await anon.ctx.close();
  // Bilan envoyé par les tâches planifiées, une seule fois.
  await pgc.query(`update "ServiceOrder" set "doneAt" = now() - interval '8 days' where id = $1`, [ord.id]);
  const cron = () => fetch(`${BASE}/api/taches`, { method: "POST", headers: { Authorization: `Bearer ${process.env.CRON_SECRET ?? "secret-des-taches-de-test"}` } }).then((r) => r.json());
  const r1 = await cron();
  const report = await waitMail("julien.faure@demo.kolbase.local", "Bilan : E-mailing dédié");
  const r2 = await cron();
  check("Bilan envoyé à l'organisateur", r1.reports >= 1 && !!report && report.text.includes("1 inscription par ce lien") && report.text.includes("destinataire"), report?.text.slice(0, 160));
  check("Bilan : envoyé une seule fois", r2.reports === 0 && mails.filter((m) => m.subject.startsWith("Bilan : E-mailing dédié")).length === 1);
  const adm = await session();
  await login(adm.page, "anne.chevalier@demo.kolbase.local");
  await adm.page.goto(`${BASE}/admin?onglet=services`);
  check("Admin : bilan des services réalisés", ((await adm.page.locator("main").textContent()) ?? "").includes("1 inscription par ce lien · bilan envoyé le"));
  await adm.ctx.close();
  await pgc.end();
}

// ── Services proposés à la publication et pack visibilité ──────────────────
{
  const pgc = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await pgc.connect();
  const { ctx, page } = await session();
  await login(page, "anne.chevalier@demo.kolbase.local");
  const evUrl = `${BASE}/organisations/demo-org-academie/evenements/demo-ev-tp-endo`;
  await page.goto(evUrl);
  check("Fiche publiée : pas de proposition sans publication récente", !(await text(page)).includes("Votre événement est en ligne"));
  await page.click('button:has-text("Retirer de l\'agenda")');
  await page.waitForTimeout(800);
  await Promise.all([page.waitForURL(/\?publie=1/), page.click('button:has-text("Publier dans l\'agenda")')]);
  const t = (await text(page)).replace(/\s/g, " ");
  check("Publication : services proposés aussitôt", t.includes("Votre événement est en ligne dans l'agenda de KolBase") && t.includes("Pack visibilité : 990 € HT au lieu de 1 170 € HT"), t.slice(0, 120));
  const pack = page.locator('.service-list li.service-pack');
  check("Pack : économie affichée", (await pack.innerText()).replace(/\s/g, " ").includes("Économisez 180 €"), (await pack.innerText()).replace(/\s+/g, " "));
  await pack.locator('button:has-text("Commander")').click();
  await pack.locator('textarea[name="brief"]').fill("Cibler les endodontistes.");
  await pack.locator('button:has-text("Commander —")').click();
  await page.waitForTimeout(1200);
  const rows = (await pgc.query(`select label, "priceCents", "packLabel", status from "ServiceOrder" where "eventId" = 'demo-ev-tp-endo' order by "priceCents" desc`)).rows;
  check("Pack : trois services commandés, prix réparti", rows.length === 3 && rows.reduce((n, r) => n + r.priceCents, 0) === 99000 && rows.every((r) => r.packLabel === "Pack visibilité" && r.status === "demandee"), JSON.stringify(rows.map((r) => r.priceCents)));
  check("Pack : équipe KolBase prévenue", !!(await waitMail("anne.chevalier@demo.kolbase.local", "Service commandé : Pack visibilité")));
  await page.goto(evUrl);
  const after = await text(page);
  check("Pack : plus commandable, services listés", after.includes("(Pack visibilité)") && (await page.locator('.service-list li.service-pack button:has-text("Commander")').count()) === 0 && !after.includes("Votre événement est en ligne"));
  // Annuler un service du pack annule le pack entier.
  await page.locator('li.service-order:has-text("Publication sur les réseaux sociaux") button:has-text("Annuler")').click();
  await page.waitForTimeout(1000);
  const st = (await pgc.query(`select distinct status from "ServiceOrder" where "eventId" = 'demo-ev-tp-endo'`)).rows.map((r) => r.status);
  check("Pack : annulation de l'ensemble", st.length === 1 && st[0] === "annulee", st.join(","));
  await ctx.close();
  await pgc.end();
}

// ── Aperçus de partage et données structurées ──────────────────────────────
{
  const html = await (await fetch(`${BASE}/evenements/demo-ev-soiree-implanto`)).text();
  const meta = (p) => html.match(new RegExp(`<meta property="${p}" content="([^"]*)"`))?.[1];
  const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([^<]*)<\/script>/)?.[1] ?? "null");
  check("Événement : aperçu de partage (titre, image, lien)", (meta("og:title") ?? "").startsWith("Soirée implantologie") && /\/evenements\/demo-ev-soiree-implanto\/opengraph-image/.test(meta("og:image") ?? "") && /<link rel="canonical" href="[^"]*\/evenements\/demo-ev-soiree-implanto"/.test(html));
  check("Événement : données structurées schema.org", ld?.["@type"] === "Event" && ld.location?.address?.addressLocality === "Lyon" && ld.organizer?.name === "Dentalys Implants" && ld.offers?.price === 0 && !!ld.startDate);
  const img = await fetch(`${BASE}/evenements/demo-ev-soiree-implanto/opengraph-image`);
  const buf = Buffer.from(await img.arrayBuffer());
  check("Événement : image d'aperçu générée (1200 × 630)", img.status === 200 && img.headers.get("content-type") === "image/png" && buf.readUInt32BE(16) === 1200 && buf.readUInt32BE(20) === 630);
  const art = await (await fetch(`${BASE}/actualites/transparence-sante-preparer-sa-declaration`)).text();
  check("Actualité : aperçu et données structurées", art.includes('<meta property="og:type" content="article"/>') && art.includes('"@type":"NewsArticle"') && (await fetch(`${BASE}/actualites/transparence-sante-preparer-sa-declaration/opengraph-image`)).status === 200);
  const home = await (await fetch(`${BASE}/`)).text();
  check("Accueil : image d'aperçu par défaut et organisation", /<meta property="og:image" content="[^"]*\/opengraph-image/.test(home) && home.includes('"@type":"Organization"'));
  const robots = await (await fetch(`${BASE}/robots.txt`)).text();
  check("Robots : liens suivis et désinscription exclus", robots.includes("Disallow: /r/") && robots.includes("Disallow: /desinscription"));
}

// ── Double authentification : activation, exigence par l'organisation, connexion ──
{
  const pgc = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await pgc.connect();
  const b32 = (s) => { let bits = 0, v = 0; const out = []; for (const c of s.replace(/[^A-Z2-7]/gi, "").toUpperCase()) { v = (v << 5) | "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(c); bits += 5; if (bits >= 8) { out.push((v >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(out); };
  const stepNow = () => Math.floor(Date.now() / 30000);
  const code = (secret, step = stepNow()) => {
    const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(step));
    const h = createHmac("sha1", b32(secret)).update(msg).digest(); const o = h[19] & 15;
    return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, "0");
  };
  const adm = await session();
  await login(adm.page, "thomas.garnier@demo.kolbase.local");
  await adm.page.goto(`${BASE}/organisations/demo-org-orthonova/membres?onglet=organisation`);
  check("Organisation : exigence impossible tant que l'administrateur n'est pas protégé", await adm.page.locator('button:has-text("Exiger la double authentification")').isDisabled());
  await adm.page.goto(`${BASE}/compte`);
  await adm.page.click('button:has-text("Activer la double authentification")');
  await adm.page.waitForSelector(".totp-secret");
  const secret = (await adm.page.locator(".totp-secret").innerText()).replace(/\s/g, "");
  check("Activation : QR code et clé affichés", (await adm.page.locator(".two-factor-qr svg").count()) === 1 && secret.length === 32);
  await adm.page.fill('.two-factor-setup input[name="code"]', code(secret, stepNow() + 5));
  await adm.page.click('button:has-text("Confirmer et activer")');
  await adm.page.waitForTimeout(800);
  check("Activation : code faux refusé", (await text(adm.page)).includes("Code incorrect"));
  await adm.page.fill('.two-factor-setup input[name="code"]', code(secret));
  await adm.page.click('button:has-text("Confirmer et activer")');
  await adm.page.waitForSelector(".recovery-codes li");
  const enrolledStep = stepNow();
  const recovery = await adm.page.locator(".recovery-codes li").allInnerTexts();
  const row = (await pgc.query(`select "totpSecret", "totpEnabledAt", array_length("recoveryCodes", 1) n from "User" where email = 'thomas.garnier@demo.kolbase.local'`)).rows[0];
  check("Activation : dix codes de secours, stockés hachés", recovery.length === 10 && row.n === 10 && !!row.totpEnabledAt && row.totpSecret === secret && !JSON.stringify(row).includes(recovery[0]));
  check("Activation : avis de sécurité envoyé", !!(await waitMail("thomas.garnier@demo.kolbase.local", "Sécurité de votre compte KolBase")));
  await adm.page.goto(`${BASE}/organisations/demo-org-orthonova/membres?onglet=organisation`);
  await adm.page.click('button:has-text("Exiger la double authentification")');
  await adm.page.waitForTimeout(1000);
  const req = (await pgc.query(`select "require2fa" from "Organization" where id = 'demo-org-orthonova'`)).rows[0].require2fa;
  check("Organisation : double authentification exigée", req === true && (await text(adm.page)).includes("Double authentification exigée"));
  await adm.page.goto(`${BASE}/compte`);
  check("Exigée : désactivation non proposée", (await adm.page.locator('summary:has-text("Désactiver la double authentification")').count()) === 0);
  await adm.ctx.close();
  // Un membre sans double authentification est invité à l'activer avant d'accéder à l'espace.
  const lea = await session();
  await login(lea.page, "lea.rousseau@demo.kolbase.local");
  await lea.page.goto(`${BASE}/organisations/demo-org-orthonova`);
  check("Membre sans double authentification : renvoyé vers « Mon compte »", lea.page.url().includes("/compte?securite=demo-org-orthonova") && (await text(lea.page)).includes("OrthoNova exige la double authentification de ses membres"), lea.page.url());
  await lea.ctx.close();
  // Connexion : mot de passe, puis code ; codes de secours à usage unique ; un code ne sert qu'une fois.
  const s1 = await session();
  await login(s1.page, "thomas.garnier@demo.kolbase.local");
  check("Connexion : code demandé après le mot de passe", s1.page.url().includes("/connexion/verification"), s1.page.url());
  await s1.page.goto(`${BASE}/organisations/demo-org-orthonova`);
  check("Connexion : pas de session avant le code", s1.page.url().includes("/connexion"), s1.page.url());
  await login(s1.page, "thomas.garnier@demo.kolbase.local");
  await s1.page.fill('input[name="code"]', code(secret, stepNow() + 5));
  await s1.page.click('button:has-text("Valider")');
  await s1.page.waitForTimeout(800);
  check("Connexion : code faux refusé", (await text(s1.page)).includes("Code incorrect ou déjà utilisé"));
  await s1.page.click('button:has-text("utiliser un code de secours")');
  await s1.page.fill('input[name="code"]', recovery[0].toUpperCase());
  await Promise.all([s1.page.waitForURL(/organisations\/demo-org-orthonova/), s1.page.click('button:has-text("Valider")')]);
  const left = (await pgc.query(`select array_length("recoveryCodes", 1) n from "User" where email = 'thomas.garnier@demo.kolbase.local'`)).rows[0].n;
  check("Connexion par code de secours, consommé", left === 9 && !!(await waitMail("thomas.garnier@demo.kolbase.local", "Sécurité de votre compte KolBase")));
  await s1.ctx.close();
  const s2 = await session();
  await login(s2.page, "thomas.garnier@demo.kolbase.local");
  await s2.page.click('button:has-text("utiliser un code de secours")');
  await s2.page.fill('input[name="code"]', recovery[0]);
  await s2.page.click('button:has-text("Valider")');
  await s2.page.waitForTimeout(800);
  check("Code de secours déjà utilisé : refusé", (await text(s2.page)).includes("Code incorrect ou déjà utilisé"));
  while (stepNow() <= enrolledStep) await new Promise((r) => setTimeout(r, 1000));
  const c = code(secret);
  await s2.page.click('button:has-text("Utiliser le code de l\'application")');
  await s2.page.fill('input[name="code"]', c);
  await Promise.all([s2.page.waitForURL(/organisations\/demo-org-orthonova/), s2.page.click('button:has-text("Valider")')]);
  check("Connexion avec le code de l'application", s2.page.url().includes("/organisations/demo-org-orthonova"));
  await s2.ctx.close();
  const s3 = await session();
  await login(s3.page, "thomas.garnier@demo.kolbase.local");
  await s3.page.fill('input[name="code"]', c);
  await s3.page.click('button:has-text("Valider")');
  await s3.page.waitForTimeout(800);
  check("Même code rejoué : refusé", (await text(s3.page)).includes("Code incorrect ou déjà utilisé") && s3.page.url().includes("/connexion/verification"));
  await s3.ctx.close();
  const s4 = await session();
  await s4.page.goto(`${BASE}/connexion/verification`);
  check("Vérification sans mot de passe : retour à la connexion", s4.page.url().endsWith("/connexion"), s4.page.url());
  await s4.ctx.close();
  // Remise à l'état initial pour les vérifications suivantes.
  await pgc.query(`update "Organization" set "require2fa" = false where id = 'demo-org-orthonova'`);
  await pgc.end();
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
