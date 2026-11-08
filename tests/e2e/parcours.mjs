// Parcours de bout en bout sur les données de démo (droits, visibilité, connexion).
// Prérequis : base migrée et chargée (npm run db:seed avec DEMO_PASSWORD), application lancée.
// Usage : BASE=http://localhost:3000 DEMO_PASSWORD=… DATABASE_URL=… npm run test:e2e
import { chromium } from "playwright";
import { withConsent } from "./consentement.mjs";
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

const browser = withConsent(await chromium.launch(), BASE);

async function session() {
  const ctx = await browser.newContext({ locale: "fr-FR" });
  return { ctx, page: await ctx.newPage() };
}
/** Ouvre un onglet de la fiche affichée (dossier, collaboration du praticien). */
const tab = (page, key) => page.goto(`${page.url().split(/[?#]/)[0]}?onglet=${key}`);
/** Fiche dossier : déplie « Autres actions » (abandonner, revenir en accord de principe). */
const openMore = (page) => page.evaluate(() => document.querySelectorAll("details.more-actions").forEach((d) => { d.open = true; }));

async function login(page, email, password = PW, next = "") {
  await page.goto(`${BASE}/connexion${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button:has-text("Se connecter")');
  // Connexion terminée : page de connexion quittée (accueil, page d'origine, double authentification) ou refus
  // affiché. Attente sur l'événement plutôt qu'un délai fixe : le parcours tient sous le plafond de e2e.sh.
  await Promise.race([
    page.waitForURL((u) => u.pathname !== "/connexion", { timeout: 10000 }),
    page.locator("main .notice.error").waitFor({ timeout: 10000 }),
  ]).catch(() => {});
  // Redirections enchaînées (tableau de bord → espace de l'organisation) : l'adresse doit rester stable 300 ms.
  for (let last = page.url(), stable = 0; stable < 3; ) {
    await page.waitForTimeout(100);
    stable = page.url() === last ? stable + 1 : 0;
    last = page.url();
  }
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
  check("Membre d'organisation : tarif visible", /tarif journalier indicatif/i.test(await text(page)));
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
  check("Prestataire : toujours redirigé hors des dossiers", page.url().endsWith("/organisations/demo-org-mediane?acces=refuse"), page.url());
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
  check("Candidature retenue : dossier en attente de l'expert", dossier.includes("En attente des experts") && /1 réponse attendue/i.test(dossier));
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
  check("Expert : après accord, la convention devient disponible (onglet Documents et convention)", (await page.locator('a:has-text("Voir la convention")').count()) === 1 && (await page.locator('.dossier-tab.disabled:has-text("Documents et convention")').count()) === 0);
  check("E-mail à l'organisation : accord de principe", !!(await waitMail("anne.chevalier@demo.kolbase.local", "a donné son accord de principe")));
  // Message de l'expert → e-mail à l'organisation ; puis l'expert coupe les notifications.
  await tab(page, "messagerie");
  await page.fill('textarea[name="body"]', "Bonjour, je confirme mes disponibilités.");
  await page.click('button:has-text("Envoyer")');
  check("E-mail à l'organisation : nouveau message de l'expert", !!(await waitMail("anne.chevalier@demo.kolbase.local", "Nouveau message de Dr Olivier Girard")));
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
  await tab(page, "messagerie");
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
  check("Signature : « Convention signée » attend la convention de l'expert", (await page.locator('button:has-text("Convention signée")').count()) === 0 && /(Faites signer|Déposez) la convention( signée)? de Dr Mathieu Roux/.test(t));
  await tab(page, "documents");
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
  await page.goto(dossier);
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
  await tab(expert.page, "documents");
  check("Expert : voit sa convention signée", (await text(expert.page)).includes("convention-roux-signée.pdf"));
  const own = await expert.page.request.get(`${BASE}${href}`);
  check("Expert : peut la télécharger", own.ok());
  // En signature, « Convention signée » est présélectionnée (lot 5a) : une pièce se choisit.
  await expert.page.selectOption('form:has(input[name="file"]) select[name="kind"]', "PIECE");
  await expert.page.setInputFiles('form:has(input[name="file"]) input[name="file"]', { name: "programme-tp.pdf", mimeType: "application/pdf", buffer: pdf });
  await expert.page.click('form:has(input[name="file"]) button:has-text("Déposer")');
  await expert.page.waitForTimeout(1500);
  check("Expert : dépôt d'une pièce", (await text(expert.page)).includes("Document déposé"));
  await expert.ctx.close();

  await tab(page, "documents");
  check("Organisation : voit la pièce déposée par l'expert", (await text(page)).includes("programme-tp.pdf"));
  await page.goto(dossier);
  await page.click('button:has-text("Convention signée")');
  await page.waitForTimeout(1500);
  await tab(page, "documents");
  // Liste des pièces (l'historique du dossier nomme aussi le fichier depuis le lot 4).
  const signed = await page.locator('li.flex-between:has-text("convention-roux-signée.pdf")').innerText();
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
  await page.goto(`${dossier}?onglet=documents`);
  const send = page.locator('#conventions button:has-text("signature électronique")');
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
    await expert.page.goto(`${BASE}/sollicitations/e2e-link-esign?onglet=documents`);
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
    await tab(page, "documents");
    check("Documents : convention signée rangée une seule fois", (await page.locator('li:has-text("convention-signee-")').count()) === 1, String(await page.locator('li:has-text("convention-signee-")').count()));
    await page.goto(dossier);
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
  // La décision de la conformité se prend dans son onglet, à côté des supports et des points d'attention.
  await page.goto(`${BASE}/organisations/demo-org-dentalys/dossiers/demo-prj-symposium?onglet=conformite`);
  await page.click('.next-step button:has-text("Valider")');
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
  await claire.page.goto(`${BASE}/organisations/demo-org-dentalys/dossiers/e2e-prj-be?onglet=conformite`);
  const t = await text(claire.page);
  check("Dossier hors France : régime « Hors France », obligations belges rappelées", t.includes("Hors France") && t.includes("betransparent.be") && t.includes("Mdeon"));
  check("Dossier hors France : pas de démarche auprès de l'Ordre", !t.includes("Demander l'autorisation à l'Ordre") && !t.includes("Déclaration simple"));
  // L'étape suivante se franchit depuis la vue d'ensemble (« Prochaine étape »).
  await claire.page.goto(`${BASE}/organisations/demo-org-dentalys/dossiers/e2e-prj-be`);
  await claire.page.click('.next-step button:has-text("Hors France")');
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

// ── Règles : étudiants, Belgique (visa Mdeon, betransparent.be), agents publics, frais d'inscription ──
{
  const pgc = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await pgc.connect();
  const q1 = async (sql, args = []) => (await pgc.query(sql, args)).rows[0];
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n");
  // Rencontres d'un industriel sur deux jours, nuitée offerte, déjeuner au-delà du plafond Mdeon (45 €).
  await pgc.query(`insert into "Event" (id, "organizationId", title, "typeId", "startsAt", "durationMinutes", format, city, venue, capacity, "publishedAt", "updatedAt")
    values ('e2e-r1-ev', 'demo-org-dentalys', 'Rencontres implantaires Règles', 'pleniere', date_trunc('day', now()) + interval '40 days 8 hours', 1980, 'PRESENTIEL', 'Lille', 'Grand Palais (fictif)', 50, now(), now())`);
  await pgc.query(`insert into "EventBenefit" (id, "eventId", "catalogId", label, "valueCents") values ('e2e-r1-b-nuit', 'e2e-r1-ev', 'nuitee', 'Nuitée d''hôtel', 14000), ('e2e-r1-b-dej', 'e2e-r1-ev', 'dejeuner', 'Déjeuner sur place', 5200)`);
  const ev = `${BASE}/evenements/e2e-r1-ev`;

  // Étudiant : l'hospitalité lui est interdite ; il s'inscrit sans.
  const paul = await session();
  await login(paul.page, "paul.laurent@demo.kolbase.local");
  await paul.page.goto(ev);
  let t = await text(paul.page);
  check("Étudiant : prestations visibles mais impossibles à accepter", t.includes("En tant qu'étudiant, vous ne pouvez accepter") && (await paul.page.locator('input[name="accept_e2e-r1-b-nuit"]').isDisabled()));
  await paul.page.evaluate(() => { const c = document.querySelector('input[name="accept_e2e-r1-b-nuit"]'); c.disabled = false; c.checked = true; });
  await paul.page.click('button:has-text("M\'inscrire")');
  await paul.page.waitForTimeout(1200);
  const paulReg = () => q1(`select r.id, (select count(*)::int from "RegistrationBenefit" b where b."registrationId" = r.id) n from "Registration" r join "User" u on u.id = r."userId" where u.email = 'paul.laurent@demo.kolbase.local' and r."eventId" = 'e2e-r1-ev'`);
  check("Étudiant : une prestation forcée est refusée par le serveur", (await text(paul.page)).includes("vous ne pouvez accepter aucune prestation") && !(await paulReg()));
  await paul.page.goto(ev);
  await paul.page.click('button:has-text("M\'inscrire")');
  await paul.page.locator("text=Inscription confirmée").first().waitFor({ timeout: 8000 }).catch(() => {});
  const pr = await paulReg();
  check("Étudiant : inscription possible, sans prestation", !!pr && pr.n === 0);
  await paul.ctx.close();

  // Praticienne exerçant en Belgique : pas de prestation tant que le visa Mdeon n'est pas communiqué.
  const SJ = "sophie.janssens@demo.kolbase.local";
  const sj = await session();
  await login(sj.page, SJ);
  await sj.page.goto(ev);
  t = await text(sj.page);
  check("Belgique : sans visa Mdeon, prestations indisponibles", t.includes("suppose un visa Mdeon") && (await sj.page.locator('input[name="accept_e2e-r1-b-nuit"]').isDisabled()));
  const claire = await session();
  await login(claire.page, "claire.morel@demo.kolbase.local");
  await claire.page.goto(`${BASE}/organisations/demo-org-dentalys/evenements/e2e-r1-ev`);
  t = await text(claire.page);
  check("Organisateur : visa Mdeon requis avec sa date limite, plafond dépassé signalé", t.includes("Visa Mdeon requis") && /au plus tard le \d/.test(t) && t.includes("Déjeuner sur place 52 € > 45 €"), t.slice(t.indexOf("Praticiens exerçant en Belgique"), t.indexOf("Praticiens exerçant en Belgique") + 400));
  await claire.page.fill('input[name="mdeonVisa"]', "V-2026-0042");
  await claire.page.click('button:has-text("Enregistrer le visa")');
  await claire.page.waitForTimeout(1200);
  check("Visa Mdeon enregistré et journalisé", (await q1(`select "mdeonVisa" v from "Event" where id = 'e2e-r1-ev'`)).v === "V-2026-0042" && !!(await q1(`select 1 from "AuditLog" where action = 'event.mdeon_visa' and "entityId" = 'e2e-r1-ev'`)));
  await sj.page.goto(ev);
  await sj.page.check('input[name="accept_e2e-r1-b-nuit"]');
  t = await text(sj.page);
  check("Belgique : information belge (article 10, visa, betransparent.be)", t.includes("article 10 de la loi sur les médicaments") && t.includes("visa Mdeon n° V-2026-0042") && t.includes("betransparent.be"));
  await sj.page.check('input[name="ackHcp"]');
  await sj.page.click('button:has-text("M\'inscrire")');
  const sjMail = await waitMail(SJ, "Inscription confirmée : « Rencontres implantaires Règles");
  check("Belgique : le numéro de visa figure dans l'e-mail de confirmation", !!sjMail && sjMail.text.includes("Visa Mdeon n° V-2026-0042"), sjMail?.text.slice(0, 300));
  await sj.ctx.close();

  // Publication belge : préparation betransparent.be (rôle Conformité).
  const comp = await session();
  await login(comp.page, "sophie.bernard@demo.kolbase.local");
  await comp.page.goto(`${BASE}/organisations/demo-org-dentalys/conformite?onglet=transparence`);
  check("Conformité : préparation betransparent.be proposée", (await text(comp.page)).includes("Belgique : betransparent.be"));
  const year = (await q1(`select extract(year from "startsAt" at time zone 'Europe/Brussels')::int y from "Event" where id = 'e2e-r1-ev'`)).y;
  const csv = await comp.page.request.get(`${BASE}/organisations/demo-org-dentalys/conformite/betransparent?annee=${year}`);
  const body = await csv.text();
  check("betransparent.be : nuitée de la praticienne belge, INAMI et visa", csv.ok() && body.includes("JANSSENS") && body.includes("39990000017") && body.includes("Frais d'hébergement") && body.includes("V-2026-0042"), body.split("\n").slice(0, 2).join(" | "));
  const other = await claire.page.request.get(`${BASE}/organisations/demo-org-dentalys/conformite/betransparent?annee=${year}`);
  check("betransparent.be : réservé au rôle Conformité", !(await other.text()).includes("JANSSENS"));
  // Frais d'inscription : seuil d'autorisation propre, réglable à la baisse.
  await comp.page.goto(`${BASE}/organisations/demo-org-dentalys/conformite?onglet=parametres`);
  t = await text(comp.page);
  check("Paramètres : seuil des frais d'inscription (1 000 €)", t.includes("Frais d'inscription pris en charge") && (await comp.page.locator('input[name="registrationFeeMax"]').inputValue()) === "1000");
  await comp.ctx.close();

  // Expert agent public : l'autorisation de cumul est jointe avant toute démarche auprès de l'Ordre.
  const nb = await session();
  await login(nb.page, "nicolas.blanc@demo.kolbase.local");
  await nb.page.goto(`${BASE}/compte`);
  await nb.page.check('input[name="publicAgent"]');
  await nb.page.click('button:has-text("Enregistrer le profil expert")');
  await nb.page.waitForTimeout(1200);
  check("Expert : statut d'agent public enregistré", (await q1(`select "publicAgent" a from "PractitionerProfile" where id = 'demo-p-blanc'`)).a === true);
  await pgc.query(`insert into "Project" (id, "organizationId", title, "typeId", status, "updatedAt") values ('e2e-r1-prj', 'demo-org-dentalys', 'Conférence implants courts Règles', 'pleniere', 'VALIDE', now())`);
  await pgc.query(`insert into "ProjectExpert" (id, "projectId", "practitionerId", status, "feeCents", days) values ('e2e-r1-prj-x0', 'e2e-r1-prj', 'demo-p-blanc', 'VALIDE', 150000, 1)`);
  const dossierUrl = `${BASE}/organisations/demo-org-dentalys/dossiers/e2e-r1-prj`;
  await claire.page.goto(dossierUrl);
  t = await text(claire.page);
  check("Agent public : ni déclaration ni demande à l'Ordre sans autorisation de cumul", t.includes("Expert agent public : déposez l'autorisation de cumul") && (await claire.page.locator('button:has-text("Déclaration simple")').count()) === 0 && (await claire.page.locator('button:has-text("Demander l\'autorisation à l\'Ordre")').count()) === 0);
  await nb.page.goto(`${BASE}/sollicitations/e2e-r1-prj-x0?onglet=documents`);
  t = await text(nb.page);
  check("Agent public : l'expert est invité à déposer son autorisation", t.includes("Vous exercez comme agent public : déposez"));
  const up = 'form:has(input[name="file"])';
  await nb.page.selectOption(`${up} select[name="kind"]`, "AUTORISATION_CUMUL");
  await nb.page.setInputFiles(`${up} input[name="file"]`, { name: "autorisation-cumul-chu.pdf", mimeType: "application/pdf", buffer: pdf });
  await nb.page.click(`${up} button:has-text("Déposer")`);
  await nb.page.waitForTimeout(1500);
  check("Autorisation de cumul déposée par l'expert", !!(await q1(`select 1 from "Document" where "projectExpertId" = 'e2e-r1-prj-x0' and kind = 'AUTORISATION_CUMUL'`)));
  await claire.page.goto(dossierUrl);
  await claire.page.click('.next-step button:has-text("Déclaration simple")');
  await claire.page.waitForTimeout(1200);
  check("Autorisation jointe : la déclaration simple redevient possible", (await q1(`select status from "Project" where id = 'e2e-r1-prj'`)).status === "SIGNATURE");
  await nb.ctx.close();
  await claire.ctx.close();
  // Retour à l'état de départ pour la suite des parcours.
  await pgc.query(`update "PractitionerProfile" set "publicAgent" = false where id = 'demo-p-blanc'`);
  await pgc.query(`delete from "Registration" where "eventId" = 'e2e-r1-ev'`);
  await pgc.query(`delete from "Event" where id = 'e2e-r1-ev'`);
  await pgc.query(`delete from "Project" where id = 'e2e-r1-prj'`);
  await pgc.end();
}

// ── Inscription complète : besoins, adresse, liste d'attente, message aux inscrits ──
{
  const pgc = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await pgc.connect();
  const q1 = async (sql, args = []) => (await pgc.query(sql, args)).rows[0];
  await pgc.query(`insert into "Event" (id, "organizationId", title, "typeId", "startsAt", "durationMinutes", format, city, "postalCode", venue, address, capacity, "publishedAt", "updatedAt")
    values ('e2e-r2-ev', 'demo-org-dentalys', 'Atelier occlusion Inscription', 'travaux-pratiques', now() + interval '30 days', 180, 'PRESENTIEL', 'Lille', '59777', 'Grand Palais (fictif)', '1 boulevard des Cités Unies', 1, now(), now())`);
  await pgc.query(`insert into "EventBenefit" (id, "eventId", "catalogId", label, "valueCents") values ('e2e-r2-b-cafe', 'e2e-r2-ev', 'cafe', 'Pause café d''accueil', 800)`);
  const ev = `${BASE}/evenements/e2e-r2-ev`;
  const EMMA = "emma.simon@demo.kolbase.local", HUGO = "hugo.robert@demo.kolbase.local";
  const emma = await session();
  await login(emma.page, EMMA);
  await emma.page.goto(ev);
  check("Adresse complète affichée sur la page de l'événement", (await text(emma.page)).includes("1 boulevard des Cités Unies"));
  // Besoins renseignés sans l'accord : refus ; avec l'accord : enregistrés.
  await emma.page.locator("details.needs-fields summary").click();
  await emma.page.selectOption('select[name="diet"]', "vegetarien");
  await emma.page.fill('input[name="allergies"]', "crustacés");
  check("Besoins : la case d'accord apparaît dès qu'un champ est rempli", (await emma.page.locator('input[name="needsConsent"]').count()) === 1);
  await emma.page.check('input[name="needsConsent"]');
  await emma.page.click('button:has-text("M\'inscrire")');
  await emma.page.locator("text=Inscription confirmée").first().waitFor({ timeout: 8000 }).catch(() => {});
  const er = await q1(`select r.diet, r.allergies, r."needsConsentAt" from "Registration" r join "User" u on u.id = r."userId" where u.email = $1 and r."eventId" = 'e2e-r2-ev'`, [EMMA]);
  check("Besoins enregistrés avec la date de l'accord", er?.diet === "vegetarien" && er?.allergies === "crustacés" && !!er?.needsConsentAt, JSON.stringify(er));
  const em = await waitMail(EMMA, "Inscription confirmée : « Atelier occlusion Inscription");
  check("Confirmation : lieu avec l'adresse et le code postal", !!em && em.text.includes("Grand Palais (fictif), 1 boulevard des Cités Unies, 59777 Lille"), em?.text.slice(0, 300));

  // Événement complet : liste d'attente.
  const hugo = await session();
  await login(hugo.page, HUGO);
  await hugo.page.goto(ev);
  await hugo.page.click('button:has-text("Rejoindre la liste d\'attente")');
  await hugo.page.waitForTimeout(1000);
  await hugo.page.goto(ev);
  check("Liste d'attente : rang affiché", (await text(hugo.page)).includes("Vous êtes sur la liste d'attente (rang 1)"));

  // Organisateur : besoins sans les noms, liste d'attente, message aux inscrits.
  const claire = await session();
  await login(claire.page, "claire.morel@demo.kolbase.local");
  await claire.page.goto(`${BASE}/organisations/demo-org-dentalys/evenements/e2e-r2-ev`);
  const t = await text(claire.page);
  check("Organisateur : synthèse des repas et allergies, liste d'attente", t.includes("Synthèse sans les noms") && t.includes("Végétarien : 1") && t.includes("crustacés") && t.includes("Liste d'attente") && t.includes("Hugo Robert"));
  await claire.page.fill('form:has(textarea[name="body"]) input[name="subject"]', "Changement de salle");
  await claire.page.fill('textarea[name="body"]', "L'atelier aura lieu en salle 3, au premier étage.");
  await claire.page.click('button:has-text("Envoyer à l\'inscrit")');
  const msg = await waitMail(EMMA, "Changement de salle");
  check("Message aux inscrits : e-mail reçu, historique gardé", !!msg && msg.text.includes("salle 3") && !!(await q1(`select 1 from "EventMessage" where "eventId" = 'e2e-r2-ev' and recipients = 1`)));
  const csv = await claire.page.request.get(`${BASE}/organisations/demo-org-dentalys/evenements/e2e-r2-ev/export`);
  const body = await csv.text();
  check("Export des inscrits : régime et allergies pour l'organisateur", body.includes("Régime") && body.includes("Végétarien") && body.includes("crustacés"));

  // Place libérée : la liste d'attente est prévenue ; l'inscription la retire de la liste.
  await emma.page.goto(ev);
  await emma.page.click('button:has-text("Annuler mon inscription")');
  await emma.page.click('button:has-text("Confirmer : annuler mon inscription")');
  const offer = await waitMail(HUGO, "Une place s'est libérée : « Atelier occlusion Inscription");
  check("Place libérée : la première personne en attente est prévenue", !!offer && !!(await q1(`select "notifiedAt" from "WaitlistEntry" w join "User" u on u.id = w."userId" where u.email = $1 and w."eventId" = 'e2e-r2-ev'`, [HUGO]))?.notifiedAt);
  await hugo.page.goto(ev);
  await hugo.page.click('button:has-text("M\'inscrire")');
  await hugo.page.locator("text=Inscription confirmée").first().waitFor({ timeout: 8000 }).catch(() => {});
  check("Inscrit depuis la liste d'attente : il la quitte", !!(await q1(`select 1 from "Registration" r join "User" u on u.id = r."userId" where u.email = $1 and r."eventId" = 'e2e-r2-ev'`, [HUGO])) && !(await q1(`select 1 from "WaitlistEntry" where "eventId" = 'e2e-r2-ev'`)));
  await emma.ctx.close();
  await hugo.ctx.close();
  await claire.ctx.close();
  await pgc.query(`delete from "Registration" where "eventId" = 'e2e-r2-ev'`);
  await pgc.query(`delete from "Event" where id = 'e2e-r2-ev'`);
  await pgc.end();
}

// ── Prestataires par métier : capacités, questions de la demande, conditions, nombre définitif ──
{
  const pgc = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await pgc.connect();
  const q1 = async (sql, args = []) => (await pgc.query(sql, args)).rows[0];
  const LUD = "ludovic.perrin@demo.kolbase.local";
  const lud = await session();
  await login(lud.page, LUD);
  await lud.page.goto(`${BASE}/organisations/demo-sup-belleville/page-prestataire`);
  const capCount = (k) => lud.page.locator(`input[name="cap_${k}"]`).count();
  check("Traiteur : capacités de son métier (couverts, cocktail), ni chambres ni places en théâtre", (await capCount("banquet")) === 1 && (await capCount("cocktail")) === 1 && (await capCount("rooms")) === 0 && (await capCount("seats")) === 0);

  // Demande sans événement, depuis l'interface : date de la prestation et questions propres au traiteur.
  const claire = await session();
  await login(claire.page, "claire.morel@demo.kolbase.local");
  await claire.page.goto(`${BASE}/organisations/demo-org-dentalys/prestataires?onglet=nouvelle&cat=restauration&prestataire=demo-sup-belleville`);
  await claire.page.fill('textarea[name="needs"]', "Cocktail de clôture d'une journée de formation, 40 personnes.");
  await claire.page.fill('input[name="serviceStart"]', new Date(Date.now() + 20 * 864e5).toISOString().slice(0, 10));
  await claire.page.selectOption('select[name="d_format"]', "cocktail");
  await claire.page.fill('input[name="d_serviceTime"]', "19:30");
  await claire.page.selectOption('select[name="d_drinks"]', "vins");
  await Promise.all([claire.page.waitForURL(/\/prestataires\/[a-z0-9]+$/, { timeout: 10000 }), claire.page.click('button:has-text("Enregistrer en brouillon")')]);
  const rfqId = claire.page.url().split("/").pop();
  const row = await q1(`select details, "serviceStart" from "Rfq" where id = $1`, [rfqId]);
  check("Demande : questions du traiteur et date de la prestation enregistrées", row?.details?.format === "cocktail" && row.details.serviceTime === "19:30" && row.details.drinks === "vins" && !!row.serviceStart, JSON.stringify(row));
  await pgc.query(`update "Rfq" set status = 'sent', "sentAt" = now() where id = $1`, [rfqId]);
  await lud.page.goto(`${BASE}/organisations/demo-sup-belleville/devis/${rfqId}`);
  const t = await text(lud.page);
  check("Prestataire : la demande dit ce qu'il faut pour chiffrer (date, format, heure, boissons)", t.includes("Dates de la prestation") && t.includes("Cocktail") && t.includes("19:30") && t.includes("Avec vins"));
  await lud.ctx.close();

  // Devis avec acompte et barème d'annulation, comparé puis retenu ; nombre définitif confirmé au traiteur.
  await pgc.query(`insert into "Quote" (id, "rfqId", "supplierId", "amountCents", lines, "vatBp", "depositPct", "cancelFreeDays", "cancelMidPct", "cancelFullDays", "updatedAt") values ('e2e-r3-q', $1, 'demo-sup-belleville', 128000, '[]', 1000, 30, 30, 50, 15, now())`, [rfqId]);
  await claire.page.goto(`${BASE}/organisations/demo-org-dentalys/prestataires/${rfqId}`);
  const card = claire.page.locator(`section#rfq-${rfqId}`);
  const ct = await card.innerText();
  check("Comparaison : acompte et barème d'annulation en clair", ct.includes("acompte de 30 %") && ct.includes("annulation sans frais jusqu'à J-30") && ct.includes("50 % dus de J-30 à J-15") && ct.includes("totalité due à moins de J-15"), ct.slice(0, 400));
  // Premier devis retenu du traiteur : l'abonnement se déclenche ; l'état de départ est rétabli à la fin.
  const subBefore = await q1(`select "triggeredAt", "triggeredBy" from "Subscription" where "organizationId" = 'demo-sup-belleville'`);
  await card.locator('.quote:has-text("Traiteur Belleville") button:has-text("Retenir")').click();
  await card.locator('.quote:has-text("Traiteur Belleville") button:has-text("Confirmer : retenir le devis")').click();
  await claire.page.waitForTimeout(1500);
  await claire.page.goto(`${BASE}/organisations/demo-org-dentalys/prestataires/${rfqId}`);
  check("Devis retenu : carte « Nombre définitif »", (await claire.page.locator("#nombre-definitif").count()) === 1);
  await claire.page.fill('#nombre-definitif input[name="finalHeadcount"]', "42");
  await claire.page.click('#nombre-definitif button:has-text("Confirmer au prestataire")');
  const mail = await waitMail(LUD, "Nombre définitif : 42");
  check("Nombre définitif : enregistré et envoyé au traiteur", !!mail && (await q1(`select "finalHeadcount" n from "Rfq" where id = $1`, [rfqId])).n === 42);
  await claire.ctx.close();
  await pgc.query(`delete from "Rfq" where id = $1`, [rfqId]);
  if (!subBefore) await pgc.query(`delete from "Subscription" where "organizationId" = 'demo-sup-belleville'`);
  else await pgc.query(`update "Subscription" set "triggeredAt" = $1, "triggeredBy" = $2 where "organizationId" = 'demo-sup-belleville'`, [subBefore.triggeredAt, subBefore.triggeredBy]);
  await pgc.end();
}

// ── Invitations et logistique : événement sur invitation, congrès d'un tiers, voyages, budget ──
{
  const pgc = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await pgc.connect();
  const q1 = async (sql, args = []) => (await pgc.query(sql, args)).rows[0];
  await pgc.query(`insert into "Event" (id, "organizationId", title, "typeId", "startsAt", "durationMinutes", format, city, venue, capacity, "publishedAt", "inviteOnly", "hostedBy", "hostedUrl", "updatedAt")
    values ('e2e-r4-ev', 'demo-org-dentalys', 'Congrès ADF Invitation', 'pleniere', now() + interval '35 days', 480, 'PRESENTIEL', 'Paris', 'Palais des congrès (fictif)', 30, now(), true, 'ADF', 'https://www.adf.asso.fr', now())`);
  await pgc.query(`insert into "EventBenefit" (id, "eventId", "catalogId", label, "valueCents") values ('e2e-r4-b-ins', 'e2e-r4-ev', 'inscription', 'Frais d''inscription', 45000), ('e2e-r4-b-nuit', 'e2e-r4-ev', 'nuitee', 'Nuitée d''hôtel', 14000), ('e2e-r4-b-tr', 'e2e-r4-ev', 'transport', 'Transport aller-retour', 9000)`);
  const ev = `${BASE}/evenements/e2e-r4-ev`;
  const anon = await session();
  await anon.page.goto(`${BASE}/evenements`);
  const agenda = await text(anon.page);
  const direct = await anon.page.goto(ev);
  check("Sur invitation : absent de l'agenda, page introuvable sans invitation", !agenda.includes("Congrès ADF Invitation") && direct.status() === 404);
  await anon.ctx.close();

  // L'organisatrice invite deux personnes ; chacune reçoit un lien personnel.
  const EMMA = "emma.simon@demo.kolbase.local";
  const claire = await session();
  await login(claire.page, "claire.morel@demo.kolbase.local");
  const ws = `${BASE}/organisations/demo-org-dentalys/evenements/e2e-r4-ev`;
  await claire.page.goto(ws);
  await claire.page.fill('textarea[name="people"]', `${EMMA} ; Emma ; Simon\nPaul Externe <paul.externe@exemple.fr>\npas une adresse`);
  await claire.page.click('button:has-text("Inviter")');
  await claire.page.waitForTimeout(1500);
  const n = (await q1(`select count(*)::int n from "EventInvite" where "eventId" = 'e2e-r4-ev'`)).n;
  check("Invitations : deux ajoutées, la ligne illisible signalée", n === 2 && (await text(claire.page)).includes("1 ligne(s) illisible(s)"));
  const inv = await waitMail(EMMA, "Invitation : « Congrès ADF Invitation");
  const link = inv?.text.match(/https?:\/\/\S+invitation=[\w-]+/)?.[0];
  check("Invitation : e-mail avec lien personnel, organisateur du congrès cité", !!link && inv.text.includes("organisé par ADF"), inv?.text.slice(0, 300));

  // L'invitée s'inscrit depuis le lien, accepte nuitée et transport, donne sa ville de départ.
  const emma = await session();
  await login(emma.page, EMMA);
  await emma.page.goto(link.replace(/^https?:\/\/[^/]+/, BASE));
  let t = await text(emma.page);
  check("Invitée : page ouverte, congrès d'un tiers annoncé", t.includes("Événement sur invitation") && t.includes("Organisé par ADF"));
  await emma.page.check('input[name="accept_e2e-r4-b-nuit"]');
  await emma.page.check('input[name="accept_e2e-r4-b-tr"]');
  await emma.page.fill('input[name="departureCity"]', "Montpellier");
  await emma.page.check('input[name="ackHcp"]');
  await emma.page.click('button:has-text("M\'inscrire")');
  await emma.page.locator("text=Inscription confirmée").first().waitFor({ timeout: 8000 }).catch(() => {});
  const reg = await q1(`select r.id, tr."departureCity" city from "Registration" r join "User" u on u.id = r."userId" left join "RegistrationTravel" tr on tr."registrationId" = r.id where u.email = $1 and r."eventId" = 'e2e-r4-ev'`, [EMMA]);
  check("Invitée inscrite, ville de départ enregistrée", reg?.city === "Montpellier", JSON.stringify(reg));

  // Organisatrice : réservation, carnet de voyage, liste des chambres, budget.
  await claire.page.goto(ws);
  t = await text(claire.page);
  check("Organisatrice : invitée « Inscrit », voyageuse au départ de Montpellier", t.includes("Inscrit") && t.includes("départ de Montpellier"));
  const row = claire.page.locator('#voyages li:has-text("Emma Simon")');
  await row.locator("summary").click();
  const day = (d) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
  await row.locator('input[name="hotel"]').fill("Hôtel Rive Gauche (fictif)");
  await row.locator('input[name="checkIn"]').fill(day(34));
  await row.locator('input[name="checkOut"]').fill(day(36));
  await row.locator('select[name="roomType"]').selectOption("single");
  await row.locator('input[name="outbound"]').fill("TGV 6204 Montpellier 6 h 30 → Paris 9 h 50");
  await row.locator('button:has-text("Enregistrer")').click();
  await claire.page.waitForTimeout(1200);
  await claire.page.goto(ws);
  await claire.page.click('button:has-text("Envoyer le carnet de voyage")');
  const book = await waitMail(EMMA, "Votre voyage : « Congrès ADF Invitation");
  check("Carnet de voyage envoyé : hôtel, chambre et aller", !!book && book.text.includes("Hôtel Rive Gauche (fictif)") && book.text.includes("Individuelle") && book.text.includes("TGV 6204"), book?.text.slice(0, 300));
  const rooming = await (await claire.page.request.get(`${ws}/chambres`)).text();
  check("Liste des chambres pour l'hôtel : participante, deux nuits, chambre individuelle", rooming.includes("SIMON") && rooming.includes(";2;") && rooming.includes("Individuelle"));
  await emma.page.goto(`${BASE}/inscriptions`);
  check("Mes inscriptions : le voyage de la participante", (await text(emma.page)).includes("hôtel : Hôtel Rive Gauche (fictif)"));
  await claire.page.goto(ws);
  await claire.page.locator('#budget select[name="category"]').selectOption("hebergement");
  await claire.page.fill('#budget input[name="label"]', "Nuitées des invités");
  await claire.page.fill('#budget input[name="planned"]', "4200");
  await claire.page.click('#budget button:has-text("Ajouter le poste")');
  await claire.page.waitForTimeout(1200);
  await claire.page.goto(ws);
  check("Budget : poste prévu affiché", (await claire.page.locator("#budget").innerText()).includes("Nuitées des invités"));
  await emma.ctx.close();
  await claire.ctx.close();
  await pgc.query(`delete from "Registration" where "eventId" = 'e2e-r4-ev'`);
  await pgc.query(`delete from "Event" where id = 'e2e-r4-ev'`);
  await pgc.end();
}

// ── Experts : contrat-cadre, voyage réservé, notes de frais, remboursement et déclaration ──
{
  const pgc = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await pgc.connect();
  const q1 = async (sql, args = []) => (await pgc.query(sql, args)).rows[0];
  const proof = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n");
  const isoDay = (n) => new Date(Date.now() + n * 86400e3).toISOString().slice(0, 10);
  const NB = "nicolas.blanc@demo.kolbase.local";
  await pgc.query(`insert into "Project" (id, "organizationId", title, "typeId", status, "plannedAt", "updatedAt") values ('e2e-r5-prj', 'demo-org-dentalys', 'Board implants Frais', 'advisory', 'ACCORD', now() - interval '2 days', now())`);
  await pgc.query(`insert into "ProjectExpert" (id, "projectId", "practitionerId", status, "feeCents", days) values ('e2e-r5-x', 'e2e-r5-prj', 'demo-p-blanc', 'ACCORD', 150000, 3)`);
  const url = `${BASE}/organisations/demo-org-dentalys/dossiers/e2e-r5-prj`;
  const claire = await session();
  await login(claire.page, "claire.morel@demo.kolbase.local");

  // Contrat-cadre : période de douze mois au plus, fixée pendant le montage du dossier.
  await claire.page.goto(url);
  await claire.page.click('summary:has-text("Modifier l\'objet")');
  await claire.page.check('input[name="framework"]');
  await claire.page.fill('input[name="periodEnd"]', isoDay(400));
  await claire.page.click('button:has-text("Mettre à jour l\'objet")');
  await claire.page.waitForTimeout(1200);
  check("Contrat-cadre : plus de douze mois refusé", (await text(claire.page)).includes("douze mois au plus"));
  await claire.page.fill('input[name="periodEnd"]', isoDay(180));
  await claire.page.click('button:has-text("Mettre à jour l\'objet")');
  await claire.page.waitForTimeout(1200);
  check("Contrat-cadre : période enregistrée", (await q1(`select framework from "Project" where id = 'e2e-r5-prj'`)).framework === true);
  const conv = await claire.ctx.request.get(`${url}/convention/e2e-r5-x`);
  check("Convention du contrat-cadre générée", conv.status() === 200 && (conv.headers()["content-type"] ?? "").includes("pdf"));
  // Convention signée.
  await pgc.query(`update "Project" set status = 'SIGNE' where id = 'e2e-r5-prj'`);
  await pgc.query(`update "ProjectExpert" set status = 'SIGNE' where id = 'e2e-r5-x'`);

  // Voyage réservé par l'organisation, envoyé à l'expert.
  await claire.page.goto(`${url}?onglet=frais`);
  let t = await text(claire.page);
  check("Onglet Frais et voyages : expert engagé, aucun voyage", t.includes("Frais et voyages des experts") && t.includes("Aucun voyage réservé"));
  await claire.page.click('summary:has-text("Réserver le voyage")');
  const tf = 'form:has(input[name="hotelRef"])';
  await claire.page.fill(`${tf} input[name="hotel"]`, "Hôtel Lumière (fictif)");
  await claire.page.fill(`${tf} input[name="hotelRef"]`, "HL-4521");
  await claire.page.fill(`${tf} input[name="checkIn"]`, isoDay(10));
  await claire.page.fill(`${tf} input[name="checkOut"]`, isoDay(11));
  await claire.page.fill(`${tf} input[name="outbound"]`, "TGV 6611 Grenoble 7 h 10 → Paris 10 h 05");
  await claire.page.click(`${tf} button:has-text("Enregistrer le voyage")`);
  const tm = await waitMail(NB, "Votre voyage — Board implants Frais");
  check("Voyage : enregistré et envoyé à l'expert par e-mail", !!tm && tm.text.includes("Hôtel Lumière (fictif)") && tm.text.includes("TGV 6611") && !!(await q1(`select "sentAt" from "ExpertTravel" where "projectExpertId" = 'e2e-r5-x'`))?.sentAt, tm?.text.slice(0, 300));

  // L'expert voit son voyage, le contrat-cadre, et dépose deux notes de frais avec justificatif.
  const nb = await session();
  await login(nb.page, NB);
  await nb.page.goto(`${BASE}/sollicitations/e2e-r5-x`);
  t = await text(nb.page);
  check("Expert : voyage signalé, contrat-cadre et unités affichés", t.includes("a réservé votre voyage") && t.includes("Contrat-cadre") && t.includes("0 sur 3"));
  await nb.page.goto(`${BASE}/sollicitations/e2e-r5-x?onglet=frais`);
  t = await text(nb.page);
  check("Expert : détail du voyage visible", t.includes("Hôtel Lumière (fictif)") && t.includes("HL-4521") && t.includes("TGV 6611"));
  const ef = 'form:has(input[name="proof"])';
  const expense = async (category, label, amount) => {
    const before = (await q1(`select count(*)::int n from "ExpertExpense" where "projectExpertId" = 'e2e-r5-x'`)).n;
    await nb.page.selectOption(`${ef} select[name="category"]`, category);
    await nb.page.fill(`${ef} input[name="label"]`, label);
    await nb.page.fill(`${ef} input[name="date"]`, isoDay(-1));
    await nb.page.fill(`${ef} input[name="amount"]`, amount);
    await nb.page.setInputFiles(`${ef} input[name="proof"]`, { name: "justificatif.pdf", mimeType: "application/pdf", buffer: proof });
    await nb.page.click(`${ef} button:has-text("Envoyer la note de frais")`);
    // Le message de confirmation de la note précédente reste affiché : on attend la nouvelle ligne.
    for (let i = 0; i < 40 && (await q1(`select count(*)::int n from "ExpertExpense" where "projectExpertId" = 'e2e-r5-x'`)).n === before; i++) await nb.page.waitForTimeout(200);
  };
  await expense("repas", "Dîner de travail", "62,50");
  const sm = await waitMail("claire.morel@demo.kolbase.local", "Note de frais de Dr Nicolas Blanc");
  const first = await q1(`select status, "documentId", "amountCents" from "ExpertExpense" where "projectExpertId" = 'e2e-r5-x' and label = 'Dîner de travail'`);
  check("Note de frais déposée avec son justificatif, l'équipe prévenue", first?.status === "submitted" && !!first.documentId && first.amountCents === 6250 && !!sm);
  if (!(await nb.page.locator(`${ef} input[name="label"]`).isVisible())) await nb.page.click('summary:has-text("Déposer une note de frais")');
  await expense("transport", "Train Grenoble – Paris", "98");
  check("Seconde note de frais déposée", !!(await q1(`select 1 from "ExpertExpense" where "projectExpertId" = 'e2e-r5-x' and category = 'transport'`)));
  check("Justificatifs à part des documents du dossier", !!(await q1(`select 1 from "Document" where "projectExpertId" = 'e2e-r5-x' and kind = 'JUSTIFICATIF'`)));

  // L'organisation examine : plafond signalé, refus motivé, acceptation puis remboursement.
  await claire.page.goto(`${url}?onglet=frais`);
  t = await text(claire.page);
  check("Organisation : notes à examiner, plafond du repas signalé", t.includes("à examiner") && t.includes("au-delà du plafond (50 €)"));
  const dinner = claire.page.locator('tr:has-text("Dîner de travail")');
  await dinner.locator('button:has-text("Refuser")').click();
  await dinner.locator('input[name="note"]').fill("Repas au-delà du plafond de l'entreprise");
  await dinner.locator('button:has-text("Confirmer le refus")').click();
  const rm = await waitMail(NB, "Note de frais refusée");
  check("Refus : motif transmis à l'expert", !!rm && rm.text.includes("au-delà du plafond de l'entreprise"));
  await claire.page.goto(`${url}?onglet=frais`);
  await claire.page.locator('tr:has-text("Train Grenoble") button:has-text("Accepter")').click();
  await waitMail(NB, "Note de frais acceptée");
  await claire.page.goto(`${url}?onglet=frais`);
  await claire.page.locator('tr:has-text("Train Grenoble") button:has-text("Marquer remboursée")').click();
  const pm = await waitMail(NB, "Frais remboursés");
  check("Remboursement : statut et e-mail à l'expert", (await q1(`select status from "ExpertExpense" where "projectExpertId" = 'e2e-r5-x' and category = 'transport'`)).status === "paid" && !!pm);
  await claire.page.goto(`${url}?onglet=budget`);
  check("Budget : frais remboursés comptés", (await text(claire.page)).includes("Frais des experts (TTC)"));

  // Mission du contrat-cadre consignée, dans la limite des unités de la convention.
  await claire.page.goto(`${url}?onglet=experts`);
  await claire.page.click('summary:has-text("Consigner une mission")');
  const mf = 'form:has(button:has-text("Consigner la mission"))';
  await claire.page.fill(`${mf} input[name="date"]`, isoDay(-1));
  await claire.page.fill(`${mf} input[name="label"]`, "Webinaire implants courts");
  await claire.page.fill(`${mf} input[name="units"]`, "2");
  await claire.page.click(`${mf} button:has-text("Consigner la mission")`);
  await claire.page.locator("text=Mission consignée.").first().waitFor({ timeout: 8000 }).catch(() => {});
  check("Mission consignée : unités décomptées", (await q1(`select units from "FrameworkMission" where "projectExpertId" = 'e2e-r5-x'`))?.units === 2);
  await claire.page.fill(`${mf} input[name="date"]`, isoDay(-1));
  await claire.page.fill(`${mf} input[name="label"]`, "Relecture du support");
  await claire.page.fill(`${mf} input[name="units"]`, "2");
  await claire.page.click(`${mf} button:has-text("Consigner la mission")`);
  await claire.page.waitForTimeout(1200);
  check("Au-delà des unités prévues : un avenant est demandé", (await text(claire.page)).includes("un avenant à la convention est nécessaire") && (await q1(`select count(*)::int n from "FrameworkMission" where "projectExpertId" = 'e2e-r5-x'`)).n === 1);
  await nb.page.goto(`${BASE}/sollicitations/e2e-r5-x`);
  t = await text(nb.page);
  check("Expert : missions du contrat-cadre consultables", t.includes("Webinaire implants courts") && t.includes("2 sur 3"));
  await nb.page.goto(`${BASE}/sollicitations/e2e-r5-x?onglet=frais`);
  t = await text(nb.page);
  check("Expert : refus motivé et remboursement visibles", t.includes("Repas au-delà du plafond de l'entreprise") && t.includes("Remboursée"));

  // Les frais remboursés sont déclarés avec la convention de l'expert (Transparence Santé).
  const sophie = await session();
  await login(sophie.page, "sophie.bernard@demo.kolbase.local");
  const csv = await (await sophie.ctx.request.get(`${BASE}/organisations/demo-org-dentalys/conformite/declaration?tout=1`)).text();
  const line = csv.split("\n").find((l) => l.includes("Frais de transport") && l.includes("KB-F-"));
  check("Transparence Santé : frais remboursé déclaré, rattaché à la convention", !!line && line.includes("KB-C-E2E-R5-X") && line.includes(";98;"), line);
  await sophie.ctx.close();
  await nb.ctx.close();
  await claire.ctx.close();
  await pgc.query(`delete from "Project" where id = 'e2e-r5-prj'`);
  await pgc.end();
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
  check("Organisation non validée : pas d'annuaire", page.url().endsWith("/experts?acces=annuaire"), page.url());
  await page.goto(`${BASE}/experts/demo-p-martin`);
  check("Organisation non validée : tarif des experts masqué", !(await text(page)).includes("Tarif journalier indicatif"));
  const notAdmin = await page.goto(`${BASE}/admin`);
  check("Administration : inaccessible sans droit", notAdmin?.status() === 404, String(notAdmin?.status()));

  const admin = await session();
  await login(admin.page, "anne.chevalier@demo.kolbase.local");
  await admin.page.goto(`${BASE}/admin/organisations?statut=a-valider`);
  const card = admin.page.locator('section.card:has-text("Implants Express")').first();
  check("Administration : SIREN contrôlé dans le répertoire", (await card.innerText()).includes("IMPLANTS EXPRESS SAS — active"));
  await card.locator('button:has-text("Valider")').click();
  await admin.page.waitForTimeout(1200);

  await page.goto(`${BASE}/annuaire`);
  check("Organisation validée : annuaire accessible", page.url().endsWith("/annuaire"), page.url());
  await page.goto(`${BASE}/experts/demo-p-martin`);
  check("Organisation validée : tarif des experts visible", /tarif journalier indicatif/i.test(await text(page)));
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
  check("RPPS validé par l'administrateur, mentionné une seule fois", (await text(hugo.page)).split("Vérifié par KolBase").length - 1 === 1);
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
  // Lien réutilisé pour une adresse déjà confirmée : le dire (lot 4), plutôt qu'un « lien plus valable ».
  check("Lien de confirmation : usage unique, adresse déjà confirmée annoncée", (await text(page)).includes("déjà confirmée") && (await text(page)).includes("ce lien a déjà servi"));
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
  const demoRobots = (await page.locator('meta[name="robots"]').first().getAttribute("content").catch(() => null)) ?? "";
  check("Démonstration : fiche d'expert fictif non indexée", demoRobots.includes("noindex"), demoRobots);
  await page.goto(`${BASE}/evenements/demo-ev-tp-endo`);
  const demoEventRobots = (await page.locator('meta[name="robots"]').first().getAttribute("content").catch(() => null)) ?? "";
  check("Démonstration : événement fictif non indexé", demoEventRobots.includes("noindex"), demoEventRobots);
  await page.goto(`${BASE}/structures/septodont`);
  check("Organisation réelle : indexable", (await page.locator('meta[name="robots"]').count()) === 0);
  const robots = await (await page.request.get(`${BASE}/robots.txt`)).text();
  check("robots.txt : espaces privés exclus", robots.includes("Disallow: /admin") && robots.includes("Disallow: /organisations") && robots.includes("sitemap.xml"));
  const sitemap = await (await page.request.get(`${BASE}/sitemap.xml`)).text();
  check("Plan du site : pages publiques et organisations réelles, sans les données de démonstration", sitemap.includes("/experts</loc>") && sitemap.includes("/structures/septodont") && !sitemap.includes("demo-"));
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
  // Export des hospitalités : réservé au rôle Conformité.
  const conf = await session();
  await login(conf.page, "sophie.bernard@demo.kolbase.local");
  const csv = await (await conf.ctx.request.get(`${BASE}/organisations/demo-org-dentalys/hospitalites/export`)).text();
  await conf.ctx.close();
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
  check("Pied de page : pas de sélecteur de langue", (await page.locator("footer .locale-switch").count()) === 0);
  // Le sélecteur de l'en-tête repasse en français, et le choix est retenu.
  await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.locator('header .locale-switch button:has-text("FR")').click()]);
  await page.waitForTimeout(800);
  await page.goto(`${BASE}/`);
  check("Sélecteur de langue : retour au français mémorisé", (await page.getAttribute("html", "lang")) === "fr" && (await page.locator("header").innerText()).includes("Se connecter"));
  await ctx.close();

  // Praticienne : langue choisie dans son compte, appliquée à l'interface ; pas de sélecteur une fois connectée.
  const camille = await session();
  await login(camille.page, "camille.petit@demo.kolbase.local");
  await camille.page.goto(`${BASE}/experts`);
  check("Connectée : pas de sélecteur de langue dans l'en-tête public", (await camille.page.locator(".locale-switch").count()) === 0);
  // Un cookie de langue posé en visiteur ne l'emporte pas sur la langue du compte.
  await camille.ctx.addCookies([{ name: "kb_lang", value: "en", url: BASE }]);
  await camille.page.goto(`${BASE}/tableau-de-bord`);
  check("Connectée : la langue du compte prime sur le choix fait en visiteur", (await camille.page.getAttribute("html", "lang")) === "fr");
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
  await claire.page.goto(`${BASE}/organisations/demo-org-dentalys/dossiers/demo-prj-board?onglet=conformite`);
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
  await j.page.goto(`${BASE}/organisations/demo-org-dentalys/dossiers/demo-prj-symposium?onglet=conformite`);
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
  await sup.page.goto(`${BASE}/organisations/demo-org-mediane/devis/demo-rfq-captation`);
  const form = sup.page.locator('main form:has(input[name="line_label"])');
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
  check("Devis détaillé : envoyé", (await sup.page.locator('main button:has-text("Réviser mon devis")').count()) === 1);
  // Révision : la version 2 remplace la première.
  await sup.page.locator('main button:has-text("Réviser mon devis")').click();
  const rev = sup.page.locator('main form:has(input[name="line_label"])');
  await rev.locator('input[name="line_unit"]').nth(0).fill("2200");
  await rev.locator('button:has-text("Envoyer la version 2")').click();
  await sup.page.waitForTimeout(1500);
  check("E-mail au demandeur : devis révisé", !!(await waitMail("julien.faure@demo.kolbase.local", "Devis révisé")) || !!(await waitMail("claire.morel@demo.kolbase.local", "Devis révisé", 2000)));

  const { ctx, page } = await session();
  await login(page, "claire.morel@demo.kolbase.local");
  await page.goto(`${BASE}/organisations/demo-org-dentalys/prestataires/demo-rfq-captation`);
  const card = page.locator("section#rfq-demo-rfq-captation");
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
  await page.goto(`${BASE}/organisations/demo-org-dentalys/dossiers/demo-prj-board?onglet=evenement`);
  const d = await text(page);
  check("Dossier : événement rattaché et demandes de devis dans l'onglet Événement", d.includes("Logistique et prestataires") && d.includes("Réunion du board implantologie") && d.includes("Salle et lieu de réception"));
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
  await page.goto(`${BASE}/organisations/demo-org-dentalys/prestataires/demo-rfq-cocktail`);
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
  // Confirmation en deux temps : récapitulatif (HT, TTC, devis écartés), puis « Confirmer : … ».
  const recap = await page.locator('section#rfq-demo-rfq-cocktail .quote:has-text("Traiteur Belleville") .confirm-step').innerText();
  check("Retenir : récapitulatif avant confirmation", /HT, soit .* TTC/.test(recap) && recap.includes("Devis écartés : Les Tables du Sud"), recap);
  await page.locator('section#rfq-demo-rfq-cocktail .quote:has-text("Traiteur Belleville") button:has-text("Confirmer : retenir le devis")').click();
  await page.waitForTimeout(1200);
  check("E-mail au prestataire retenu", !!(await waitMail("ludovic.perrin@demo.kolbase.local", "Votre devis est retenu")));
  // Le prestataire retenu voit la décision et le fil reste ouvert.
  const sup = await session();
  await login(sup.page, "ludovic.perrin@demo.kolbase.local");
  await sup.page.goto(`${BASE}/organisations/demo-sup-belleville/devis/demo-rfq-cocktail`);
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
  await page.goto(`${BASE}/organisations/demo-org-dentalys/prestataires/demo-rfq-board-salle`);
  await page.locator('section#rfq-demo-rfq-board-salle .quote:has-text("Espace Confluence") button:has-text("Retenir")').click();
  await page.locator('section#rfq-demo-rfq-board-salle .quote:has-text("Espace Confluence") button:has-text("Confirmer")').click();
  await page.waitForTimeout(1200);
  await page.goto(`${BASE}/organisations/demo-org-dentalys/dossiers/demo-prj-board?onglet=budget`);
  t = await text(page);
  check("Dossier : devis retenu compté dans le budget", t.includes("Prestataires (devis retenus)") && t.includes("Salle et lieu de réception : Espace Confluence"));
  await page.goto(`${BASE}/organisations/demo-org-dentalys/dossiers/demo-prj-redaction`);
  check("Dossier de rédaction : onglet Événement fermé", (await page.locator('.dossier-tab.disabled:has-text("Événement")').count()) === 1);
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
  await sup.page.goto(`${BASE}/organisations/demo-org-mediane/devis/demo-rfq-captation`);
  const f = sup.page.locator('main form:has(input[name="line_label"])');
  if ((await f.count()) === 0) await sup.page.locator('main button:has-text("Réviser mon devis")').click();
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
  check("Appels : une seule sorte, rattachable à un événement", (await text(page)).includes("Opportunités") && (await page.locator('select[name="eventId"] option').count()) > 1);
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
  check("IA : rédaction d'un appel à experts proposée", (await page.locator('button:has-text("Rédiger la description avec l\'IA")').count()) === 1);
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
  await page.click('a:has-text("Publier une opportunité")');
  await page.waitForURL(/opportunites\?evenement=demo-ev-soiree-implanto/);
  check("Nouvel appel : événement prérempli", (await page.locator('select[name="eventId"]').inputValue()) === "demo-ev-soiree-implanto" && (await page.locator('input[name="title"]').inputValue()).startsWith("Intervenants : Soirée implantologie"));
  await page.fill('input[name="slots"]', "1");
  await page.fill('textarea[name="description"]', "Présentation de deux cas cliniques complexes en implantologie, 20 minutes, suivie d'échanges avec la salle.");
  await Promise.all([page.waitForURL(/\/opportunites\/[^/?]+$/), page.click('button:has-text("Publier l\'opportunité")')]);
  const callUrl = page.url();
  const callId = callUrl.split("/").pop();
  check("Appel publié : événement et places affichés", (await text(page)).includes("Soirée implantologie") && (await text(page)).includes("0 / 1"));
  const anon = await session();
  await anon.page.goto(`${BASE}/evenements/demo-ev-soiree-implanto`);
  check("Page de l'événement : appel à candidatures annoncé", (await text(anon.page)).includes("Opportunité d'intervention") && (await text(anon.page)).includes("Intervenants : Soirée implantologie"));
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
  await org.page.goto(`${BASE}/organisations/demo-org-orthonova/dossiers/demo-prj-aligneurs?onglet=budget`);
  await org.page.click("details.pay-edit summary");
  await org.page.click('details.pay-edit[open] button:has-text("Marquer payé")');
  await org.page.waitForTimeout(1200);
  check("Dossier : honoraires marqués payés (onglet Budget)", (await text(org.page)).includes("Payés le"));
  check("E-mail à l'expert : honoraires payés", !!(await waitMail("camille.petit@demo.kolbase.local", "Honoraires payés par OrthoNova")));
  await org.ctx.close();
  await ctx.close();
}

// ── Book prestataire : page publique, catalogue, photos, avis vérifiés ────
{
  const anon = await session();
  await anon.page.goto(`${BASE}/structures/demo-sup-belleville`);
  let t = await text(anon.page);
  // Libellés des tuiles chiffrées en capitales (CSS) : comparaison insensible à la casse.
  check("Book public : indicateurs, capacités et tarifs", /délai de réponse médian/i.test(t) && /300 personnes en cocktail/i.test(t) && /tarifs indicatifs/i.test(t) && /Cocktail dînatoire 12 pièces[\s\S]*32,00\s€ HT/i.test(t), t.slice(0, 600));
  check("Book public : avis vérifié et référence", t.includes("Service ponctuel et discret") && t.includes("Références") && t.includes("Restauration"));
  await anon.ctx.close();

  // Le prestataire enrichit son book : prestation au catalogue et photo.
  const sup = await session();
  await login(sup.page, "ludovic.perrin@demo.kolbase.local");
  await sup.page.goto(`${BASE}/organisations/demo-sup-belleville/devis?onglet=fiche`);
  t = await text(sup.page);
  check("Ma page prestataire : indicateurs, bannière, réalisations et catalogue", sup.page.url().endsWith("/page-prestataire") && /taux de réponse/i.test(t) && t.includes("Bannière") && t.includes("Réalisations (0/12)") && t.includes("Catalogue de forfaits"), sup.page.url());
  const offer = sup.page.locator("form.offer-form");
  await offer.locator('input[name="label"]').fill("Mignardises sucrées (3 pièces)");
  await offer.locator('input[name="price"]').fill("4,50");
  await offer.locator('button:has-text("Ajouter au catalogue")').click();
  await sup.page.waitForTimeout(1200);
  check("Ma page prestataire : prestation ajoutée au catalogue", (await text(sup.page)).includes("Mignardises sucrées (3 pièces)"));
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
  const photoForm = sup.page.locator("form.photo-form");
  await photoForm.locator('input[name="photo"]').setInputFiles({ name: "salle.png", mimeType: "image/png", buffer: png });
  await photoForm.locator('input[name="caption"]').fill("Buffet en salle Saône");
  await photoForm.locator('button:has-text("Ajouter la réalisation")').click();
  await sup.page.waitForTimeout(1500);
  const src = await sup.page.locator(".gallery img").first().getAttribute("src");
  check("Ma page prestataire : réalisation ajoutée", !!src && src.startsWith("/photos/"), src ?? "");
  // Bannière : envoyée, servie publiquement, affichée en tête de la page publique.
  await sup.page.locator('form.banner-form input[name="banner"]').setInputFiles({ name: "banniere.png", mimeType: "image/png", buffer: png });
  await sup.page.locator('form.banner-form button:has-text("Ajouter la bannière")').click();
  await sup.page.locator(".banner-preview img").waitFor({ timeout: 5000 }).catch(() => {});
  const bsrc = await sup.page.locator(".banner-preview img").getAttribute("src").catch(() => null);
  const bres = bsrc ? await (await session()).ctx.request.get(`${BASE}${bsrc}`) : null;
  check("Bannière : enregistrée et publique", !!bsrc && bsrc.startsWith("/bannieres/demo-sup-belleville") && !!bres?.ok() && bres.headers()["content-type"] === "image/png", bsrc ?? "");
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
  await sup.page.goto(`${BASE}/organisations/demo-sup-belleville/devis/e2e-rfq-book`);
  const qf = sup.page.locator("main form.quote-form");
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
  await page.goto(`${BASE}/organisations/demo-org-dentalys/prestataires/demo-rfq-passe-cocktail`);
  check("Avis déjà laissé visible sur la demande", (await page.locator("section#rfq-demo-rfq-passe-cocktail").innerText()).includes("Votre avis"));
  await page.goto(`${BASE}/organisations/demo-org-dentalys/prestataires/demo-rfq-board-salle`);
  check("Pas d'avis possible avant la prestation", (await page.locator("section#rfq-demo-rfq-board-salle form.review-form").count()) === 0);
  await page.goto(`${BASE}/organisations/demo-org-dentalys/prestataires/demo-rfq-passe-dejeuner`);
  const rv = page.locator("section#rfq-demo-rfq-passe-dejeuner form.review-form");
  await rv.locator('.stars label').nth(3).click();
  await rv.locator('textarea[name="comment"]').fill("Déjeuner servi à l'heure, intervenants ravis.");
  await rv.locator('button:has-text("Publier l\'avis")').click();
  await page.waitForTimeout(1200);
  check("Avis publié", (await page.locator("section#rfq-demo-rfq-passe-dejeuner").innerText()).includes("Votre avis"));
  check("E-mail au prestataire : nouvel avis", !!(await waitMail("ludovic.perrin@demo.kolbase.local", "Nouvel avis de Dentalys Implants : 4/5")));
  await page.goto(`${BASE}/organisations/demo-org-dentalys/prestataires?onglet=annuaire`);
  t = await text(page);
  const note = await page.locator('article.supplier-card:has-text("Traiteur Belleville") .rating-badge').innerText().catch(() => "");
  check("Annuaire : note moyenne et lien vers le book", note.includes("4,5") && (await page.locator('a[href="/structures/demo-sup-belleville"]').count()) > 0, note);
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
  // L'absent n'est plus « à déclarer » : il figure dans « Toutes », signalé.
  await comp.page.goto(`${BASE}/organisations/demo-org-dentalys/hospitalites?statut=toutes`);
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
  const t = await text(org.page);
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
  const t = await text(page);
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
  await org.page.goto(`${BASE}/organisations/demo-org-orthonova/dossiers/demo-prj-aligneurs?onglet=budget`);
  check("Dossier : note d'honoraires de l'expert (onglet Budget)", (await text(org.page)).includes(`N° ${num}`));
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
  check("Suggestion d'experts : ajout au dossier", (await page.locator('.fee-block:has-text("Vincent Moreau")').count()) === 1);
  await page.goto(`${BASE}/organisations/demo-org-dentalys/dossiers/demo-prj-symposium?onglet=conformite`);
  check("Relecture assistée : réservée à la conformité", (await page.locator('button:has-text("Analyser le dossier avec l\'IA")').count()) === 0);
  await ctx.close();
  const comp = await session();
  await login(comp.page, "sophie.bernard@demo.kolbase.local");
  await comp.page.goto(`${BASE}/organisations/demo-org-dentalys/dossiers/demo-prj-symposium?onglet=conformite`);
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
  // La démo accepte la version en vigueur du contrat : on simule un texte modifié depuis l'acceptation.
  const pgd = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await pgd.connect();
  await pgd.query(`update "Organization" set "dpaVersion" = '2026-01' where id = 'demo-org-dentalys'`);
  await pgd.end();
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
  const run = (await pgc.query(`select "okAt", error, result from "TaskRun" where name = 'taches-horaires'`)).rows[0];
  check("Tâches planifiées : exécution enregistrée", !!run?.okAt && run.error === null && run.result?.purged?.sessions >= 1, JSON.stringify(run));
  const adm = await session();
  await login(adm.page, "anne.chevalier@demo.kolbase.local");
  await adm.page.goto(`${BASE}/admin?onglet=lancement`);
  const launch = await text(adm.page);
  check("Lancement : tâches planifiées vérifiées", /OK\s+Tâches planifiées/.test(launch) && launch.includes("Dernière réussite il y a") && !launch.includes("Tâches planifiées : Aucune réussite"));
  // Plus de deux heures sans réussite : bandeau en tête de l'administration, quel que soit l'onglet.
  // Colonnes sans fuseau, écrites en UTC par Prisma : now() suivrait le fuseau du serveur PostgreSQL.
  await pgc.query(`update "TaskRun" set "okAt" = timezone('utc', now()) - interval '3 hours', "startedAt" = timezone('utc', now()) - interval '3 hours' where name = 'taches-horaires'`);
  await adm.page.goto(`${BASE}/admin`);
  check("Tâches arrêtées : bandeau d'alerte dans /admin", (await text(adm.page)).includes("Tâches planifiées : Aucune réussite depuis 3 h"));
  await pgc.query(`update "TaskRun" set "okAt" = timezone('utc', now()), "startedAt" = timezone('utc', now()) where name = 'taches-horaires'`);
  await pgc.end();
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
  // Bouton d'envoi désactivé et lien direct vers l'abonnement ; un envoi forcé est refusé par le serveur, la saisie reste.
  check("Abonnement : envoi désactivé, lien direct vers l'abonnement", (await page.locator('button:has-text("Envoyer les sollicitations")').isDisabled()) && (await page.locator('a[href="/organisations/demo-org-cdra/abonnement?motif=sollicitation"]').count()) === 1);
  await page.fill('input[name="title"]', "Conférence implantologie — facturation");
  await page.locator(".expert-pick label.check input").first().check();
  const fee0 = page.locator('input[name^="fee_"]').first();
  if (!(await fee0.inputValue())) await fee0.fill("1500");
  await page.locator('button:has-text("Envoyer les sollicitations")').evaluate((b) => { b.disabled = false; });
  await page.click('button:has-text("Envoyer les sollicitations")');
  await page.waitForTimeout(1500);
  check("Abonnement : sollicitation refusée tant qu'il n'est pas activé", (await text(page)).includes("menu du compte › Abonnement") && page.url().endsWith("/dossiers/nouveau") && (await page.inputValue('input[name="title"]')) === "Conférence implantologie — facturation");
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
  // Comme chez Stripe, l'API reflète l'état annoncé : l'application relit l'abonnement au lieu de croire la notification.
  sub.status = "past_due";
  await stripeWebhook("customer.subscription.updated", { ...sub, status: "active" }, "evt_retard");
  await page.goto(`${BASE}/organisations/demo-org-cdra/abonnement`);
  check("Paiement en échec : signalé, sans blocage (état relu chez Stripe)", (await text(page)).includes("Paiement en attente"));
  await stripeWebhook("customer.subscription.updated", { ...sub }, "evt_retard");
  check("Stripe : notification rejouée ignorée", stripeState.webhooks.at(-1)?.status === 200 && stripeState.webhooks.at(-1)?.body?.duplicate === true, JSON.stringify(stripeState.webhooks.at(-1)));
  sub.status = "canceled";
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
  await sup.page.goto(`${BASE}/organisations/demo-sup-belleville/devis/e2e-rfq-billing`);
  const qf = sup.page.locator("main form.quote-form");
  await qf.locator('input[name="line_label"]').first().fill("Plateau-repas");
  await qf.locator('input[name="line_qty"]').first().fill("12");
  await qf.locator('input[name="line_unit"]').first().fill("24");
  // Après un premier devis retenu : bandeau avec lien vers l'abonnement, réponse désactivée.
  check("Prestataire : après un devis retenu, l'abonnement est demandé", (await text(sup.page)).includes("répondre à de nouvelles demandes de devis") && (await qf.locator('button:has-text("Envoyer le devis")').isDisabled()) && (await sup.page.locator('a[href="/organisations/demo-sup-belleville/abonnement?motif=reponse"]').count()) === 1);
  await sup.page.goto(`${BASE}/organisations/demo-sup-belleville/abonnement`);
  check("Prestataire : abonnement 249 € HT, référencement gratuit", (await text(sup.page)).includes("249 € HT par mois") && (await text(sup.page)).includes("référencement dans l'annuaire"));
  await sup.ctx.close();
  await pgc.query(`insert into "Rfq" (id, "organizationId", category, needs, status, "sentAt", headcount, city) values ('e2e-rfq-trigger', 'demo-org-dentalys', 'restauration', 'Pause café pour 20 personnes.', 'sent', now(), 20, 'Lyon')`);
  await pgc.query(`insert into "RfqSupplier" ("rfqId", "supplierId") values ('e2e-rfq-trigger', 'demo-sup-tablesdusud')`);
  await pgc.query(`insert into "Quote" (id, "rfqId", "supplierId", "amountCents", status, "updatedAt") values ('e2e-quote-trigger', 'e2e-rfq-trigger', 'demo-sup-tablesdusud', 24000, 'submitted', now())`);
  const org = await session();
  await login(org.page, "julien.faure@demo.kolbase.local");
  await org.page.goto(`${BASE}/organisations/demo-org-dentalys/prestataires/e2e-rfq-trigger`);
  await org.page.locator('section#rfq-e2e-rfq-trigger .quote:has-text("Les Tables du Sud") button:has-text("Retenir")').click();
  await org.page.locator('section#rfq-e2e-rfq-trigger .quote:has-text("Les Tables du Sud") button:has-text("Confirmer")').click();
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
  await adm.page.click('button:has-text("Confirmer : envoyer à")');
  await adm.page.waitForTimeout(2000);
  check("E-mailing : envoyé aux membres consentants", /Lettre envoyée à \d+ membre/.test(await text(adm.page)));
  const nl = await waitMail("ines.lambert@demo.kolbase.local", /^Soirée implantologie.* — /);
  check("E-mailing : annonceur identifié et désinscription", !!nl && nl.text.includes("Communication de Dentalys Implants, diffusée par KolBase") && /\/desinscription\/[A-Za-z0-9_-]+/.test(nl.text));
  check("E-mailing : pas d'envoi sans consentement", !mails.some((m) => m.to === "olivier.girard@demo.kolbase.local" && /^Soirée implantologie.* — /.test(m.subject)));
  check("Organisateur prévenu de la réalisation", !!(await waitMail("julien.faure@demo.kolbase.local", "Service KolBase : E-mailing dédié")));
  await page.goto(`${BASE}/organisations/demo-org-dentalys/evenements/demo-ev-soiree-implanto`);
  // La mise à la une réalisée reste « En cours jusqu'au … » pendant sa durée (lot 3) ; l'e-mailing est « Réalisée ».
  check("Événement : services réalisés affichés", ((await text(page)).match(/Réalisée/g) ?? []).length >= 1 && (await text(page)).includes("En cours jusqu'au"));
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
  // L'événement a des inscrits : il ne se retire plus de l'agenda d'un clic (lot 5a, « Annuler l'événement ») ; retrait direct en base.
  await pgc.query(`update "Event" set "publishedAt" = null where id = 'demo-ev-tp-endo'`);
  await page.reload();
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
  check("Pack : plus commandable, regroupé sous son prix", /Pack visibilité — 990\s€ HT/.test(after) && (await page.locator('.service-list li.service-pack button:has-text("Commander")').count()) === 0 && !after.includes("Votre événement est en ligne"));
  // Un pack s'annule en entier, explicitement et après confirmation.
  await page.locator('li.service-pack-order button:has-text("Annuler le pack")').click();
  await page.locator('li.service-pack-order button:has-text("Confirmer : annuler le pack")').click();
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
  check("Robots : pages noindex lisibles (attestation, pointage), contrat de sous-traitance ouvert", !robots.includes("Disallow: /attestation") && !robots.includes("Disallow: /pointage") && !robots.includes("Disallow: /sous-traitance") && robots.includes("Disallow: /comptes"));
  // Listes publiques : titre, description et aperçu à leur nom ; une recherche filtrée se rattache à la liste.
  const list = await (await fetch(`${BASE}/experts?q=implant&page=2`)).text();
  const listMeta = (p) => list.match(new RegExp(`<meta (?:property|name)="${p}" content="([^"]*)"`))?.[1];
  check("Liste des experts : adresse canonique, description et aperçu propres", /<link rel="canonical" href="[^"]*\/experts"/.test(list) && listMeta("og:title") === "Experts" && (listMeta("description") ?? "").startsWith("Chirurgiens-dentistes experts"));
  const agenda = await (await fetch(`${BASE}/evenements?discipline=Implantologie&periode=mois`)).text();
  check("Agenda d'une discipline : sa propre adresse canonique", /<link rel="canonical" href="[^"]*\/evenements\?discipline=Implantologie"/.test(agenda));
  check("Accueil : adresse canonique", /<link rel="canonical" href="[^"]*"/.test(home));
  // Robots : la version française, même si l'en-tête de langue demande l'anglais.
  const bot = await (await fetch(`${BASE}/`, { headers: { "user-agent": "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)", "accept-language": "en-US,en;q=0.9" } })).text();
  check("Robot d'indexation : page en français", bot.includes('<html lang="fr"'));
  // Une seule adresse : www renvoie vers l'adresse principale (308, chemin et paramètres conservés).
  const www = await fetch(`${BASE}/experts?q=implant`, { redirect: "manual", headers: { "x-forwarded-host": `www.${new URL(BASE).host}` } });
  check("www : redirection permanente vers l'adresse principale", www.status === 308 && (www.headers.get("location") ?? "").endsWith("/experts?q=implant") && !(www.headers.get("location") ?? "").includes("www."), `${www.status} ${www.headers.get("location")}`);
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
  // Même règle pour les téléchargements par adresse directe (ils ne passent pas par les pages de l'espace).
  const leaStats = await lea.page.request.get(`${BASE}/organisations/demo-org-orthonova/statistiques/export`);
  check("Membre sans double authentification : export direct refusé", leaStats.status() === 404, String(leaStats.status()));
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

// ── Lot 1 : ouverture (lien de connexion, modifications, retour après connexion, décisions, prix) ──
{
  const pgc = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await pgc.connect();
  const q1 = async (sql, args = []) => (await pgc.query(sql, args)).rows[0];
  /** Valeur d'un champ « date et heure » (heure de Paris), dans `days` jours. */
  const parisInput = (days, hm) => `${new Date(Date.now() + days * 864e5).toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" })}T${hm}`;
  /** Connexion avec le formulaire de la page affichée (la page d'origine est portée par « next »). */
  const loginHere = async (page, email) => {
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', PW);
    await Promise.all([page.waitForLoadState("networkidle"), page.click('button:has-text("Se connecter")')]);
    await page.waitForTimeout(800);
  };
  const unfold = (ics) => ics.replace(/\r\n /g, "");

  // 4. Page d'origine conservée : pages réservées, liens entre connexion et création de compte, déjà connecté.
  {
    const a = await session();
    await a.page.goto(`${BASE}/admin?onglet=lancement`);
    check("Retour après connexion : /admin renvoie vers la connexion avec next", a.page.url().includes("/connexion?next=%2Fadmin%3Fonglet%3Dlancement"), a.page.url());
    await loginHere(a.page, "anne.chevalier@demo.kolbase.local");
    check("Retour après connexion : /admin atteint après la connexion (ancien onglet redirigé)", a.page.url().startsWith(`${BASE}/admin/exploitation`), a.page.url());
    await a.ctx.close();
    const reg = await q1(`select r.id from "Registration" r join "User" u on u.id = r."userId" where u.email = 'ines.lambert@demo.kolbase.local' and r."eventId" = 'demo-ev-soiree-implanto'`);
    const b = await session();
    await b.page.goto(`${BASE}/inscriptions/${reg.id}/badge`);
    await loginHere(b.page, "ines.lambert@demo.kolbase.local");
    check("Retour après connexion : badge d'inscription", b.page.url() === `${BASE}/inscriptions/${reg.id}/badge`, b.page.url());
    await b.ctx.close();
    const c = await session();
    await c.page.goto(`${BASE}/connexion?next=%2Fevenements`);
    check("Connexion → « Créer un compte » transmet next", (await c.page.locator('main a:has-text("Créer un compte")').getAttribute("href")) === "/inscription?next=%2Fevenements");
    await c.page.goto(`${BASE}/inscription?next=%2Fevenements`);
    check("Création de compte → « Se connecter » transmet next", (await c.page.locator('main form a:has-text("Se connecter")').getAttribute("href")) === "/connexion?next=%2Fevenements");
    await c.page.goto(`${BASE}/experts/demo-p-martin`);
    check("Fiche expert : verrou « Se connecter » avec next", ((await c.page.locator('.hidden-note a:has-text("Se connecter")').first().getAttribute("href")) ?? "") === "/connexion?next=%2Fexperts%2Fdemo-p-martin");
    await c.ctx.close();
    const d = await session();
    await login(d.page, "claire.morel@demo.kolbase.local");
    await d.page.goto(`${BASE}/connexion?next=%2Fannuaire`);
    check("Déjà connecté : /connexion mène à next", d.page.url() === `${BASE}/annuaire`, d.page.url());
    await d.page.goto(`${BASE}/inscription?next=%2Fevenements`);
    check("Déjà connecté : /inscription mène à next", d.page.url() === `${BASE}/evenements`, d.page.url());
    await d.page.goto(`${BASE}/connexion?next=%2F%2Fevil.example`);
    check("Déjà connecté : next externe ignoré", d.page.url() === `${BASE}/compte`, d.page.url());
    await d.ctx.close();
  }

  // 8. Inscription « organisation », boutons de l'accueil et de l'invitation.
  {
    const a = await session();
    await a.page.goto(`${BASE}/inscription?profil=organisation`);
    check("Inscription organisation : titre, profil présélectionné, sans pays d'exercice", (await a.page.locator("main h1").innerText()) === "Créer le compte de votre organisation" && (await a.page.locator('select[name="profession"]').inputValue()) === "" && (await a.page.locator('select[name="country"]').count()) === 0);
    await a.page.goto(`${BASE}/`);
    check("Accueil sans compte : « Publier un événement » → compte d'organisation", (await a.page.locator('a:has-text("Publier un événement")').first().getAttribute("href")) === "/inscription?profil=organisation");
    const home = await text(a.page);
    check("Accueil : plus de « gratuit » sans nuance pour les organisations", !home.includes("c'est gratuit") && !home.includes("Le référencement est gratuit.") && home.includes("gratuit jusqu'à votre première action"));
    await a.page.goto(`${BASE}/aide`);
    await a.page.click('summary:has-text("Combien coûte KolBase ?")');
    const faq = (await a.page.locator('details.faq:has-text("Combien coûte KolBase ?")').innerText()).replace(/\s/g, " ");
    check("Aide : prix annoncés (organisation, prestataire) et conditions de vente", faq.includes("599 € HT par mois") && faq.includes("5 990 € HT par an") && faq.includes("249 € HT par mois") && faq.includes("premier mois est offert") && (await a.page.locator('details.faq a[href="/conditions-de-vente"]').count()) === 1);
    check("Aide sans compte : « Référencer mon organisation » → compte d'organisation", (await a.page.locator('a:has-text("Référencer mon organisation")').first().getAttribute("href")) === "/inscription?profil=organisation");
    await a.page.goto(`${BASE}/mentions-legales`);
    const ml = await text(a.page);
    await a.page.goto(`${BASE}/confidentialite`);
    const pc = await text(a.page);
    check("Mentions légales et confidentialité : pas d'hébergeur « à compléter » affiché", !ml.includes("hébergeur des documents") && !pc.includes("hébergeur des documents") && !ml.includes("à compléter]"));
    await a.ctx.close();
    const o = await session();
    await login(o.page, "claire.morel@demo.kolbase.local");
    await o.page.goto(`${BASE}/`);
    check("Accueil connecté : « Publier un événement » → nouvel événement de l'organisation", (await o.page.locator('a:has-text("Publier un événement")').first().getAttribute("href")) === "/organisations/demo-org-dentalys/evenements/nouveau");
    await o.page.goto(`${BASE}/organisations/demo-org-dentalys/membres`);
    await o.page.fill('form:has(h2:has-text("Inviter un membre")) input[name="email"]', "lot1.invite@exemple.fr");
    await o.page.click('button:has-text("Générer le lien")');
    await o.page.waitForSelector(".copy input", { timeout: 10000 }).catch(() => {});
    const invite = await o.page.locator(".copy input").inputValue().catch(() => "");
    await o.page.goto(`${BASE}/organisations/demo-org-dentalys/prestataires?onglet=annuaire`);
    const dir = await text(o.page);
    check("Annuaire des prestataires : note sur le référencement gratuit corrigée", dir.includes("Le référencement des prestataires est gratuit") && !dir.includes("peuvent rémunérer KolBase"));
    await o.ctx.close();
    const anon = await session();
    await anon.page.goto(invite);
    const create = (await anon.page.locator('main a:has-text("Créer un compte")').getAttribute("href").catch(() => "")) ?? "";
    check("Invitation : « Créer un compte » mène au compte d'organisation, avec retour", create.startsWith("/inscription?profil=organisation&next=%2Finvitation%2F"), create);
    await anon.ctx.close();
  }

  // 1 et 3. Événement en ligne : lien de connexion réservé aux inscrits, modification annoncée, tâche à J-2, brouillon.
  {
    const org = await session();
    await login(org.page, "pierre.vidal@demo.kolbase.local");
    await org.page.goto(`${BASE}/organisations/demo-org-cdra/evenements/nouveau`);
    const title = "Webinaire Lot 1 — parodontologie en ligne";
    await org.page.fill('input[name="title"]', title);
    await org.page.fill('input[name="startsAt"]', parisInput(10, "18:00"));
    await org.page.selectOption('select[name="format"]', "DISTANCIEL");
    await org.page.fill('input[name="onlineUrl"]', "http://zoom.example.com/j/1");
    await org.page.check('input[name="publish"]');
    await org.page.click('button:has-text("Créer l\'événement")');
    await org.page.waitForTimeout(1500);
    check("Événement : lien de connexion en http refusé", (await text(org.page)).includes("Lien de connexion invalide"));
    check("Formulaire : saisie conservée après une erreur", (await org.page.inputValue('input[name="title"]')) === title && (await org.page.inputValue('select[name="format"]')) === "DISTANCIEL" && (await org.page.isChecked('input[name="publish"]')));
    await org.page.fill('input[name="onlineUrl"]', "https://zoom.example.com/j/123456");
    await Promise.all([org.page.waitForURL(/\/evenements\/[^/?]+\?publie=1/), org.page.click('button:has-text("Créer l\'événement")')]);
    const evId = org.page.url().match(/\/evenements\/([^/?]+)\?/)[1];
    check("Événement en ligne créé avec son lien", (await q1(`select "onlineUrl" from "Event" where id = $1`, [evId])).onlineUrl === "https://zoom.example.com/j/123456");
    const pub = await (await fetch(`${BASE}/evenements/${evId}`)).text();
    const pubIcs = await (await fetch(`${BASE}/evenements/${evId}/calendrier`)).text();
    check("Lien de connexion absent de la page publique et du .ics d'un non-inscrit", !pub.includes("zoom.example.com") && !pubIcs.includes("zoom.example.com"));
    // Inscription d'une praticienne : le lien apparaît partout où elle le cherche.
    const prac = await session();
    await login(prac.page, "sarah.mercier@demo.kolbase.local");
    await prac.page.goto(`${BASE}/evenements/${evId}`);
    check("Non inscrite : pas de lien de connexion", !(await prac.page.content()).includes("zoom.example.com"));
    await prac.page.click('button:has-text("M\'inscrire")');
    await prac.page.waitForTimeout(1200);
    await prac.page.reload();
    check("Inscrite : lien de connexion dans l'encart « Vous êtes inscrit »", (await prac.page.locator('.next-step:has-text("Vous êtes inscrit") a[href="https://zoom.example.com/j/123456"]').count()) === 1);
    await prac.page.goto(`${BASE}/inscriptions`);
    check("Mes inscriptions : lien de connexion", (await prac.page.locator('a[href="https://zoom.example.com/j/123456"]').count()) === 1);
    const ics1 = unfold(await (await prac.ctx.request.get(`${BASE}/evenements/${evId}/calendrier`)).text());
    const ics2 = unfold(await (await prac.ctx.request.get(`${BASE}/inscriptions/calendrier`)).text());
    check("Fichiers .ics d'une inscrite : lien de connexion", ics1.includes("LOCATION:https://zoom.example.com/j/123456") && ics1.includes("Lien de connexion : https://zoom.example.com/j/123456") && ics2.includes("https://zoom.example.com/j/123456"));
    // Modification : nouvelle date et nouveau lien, inscrite prévenue ; hospitalités encore modifiables.
    await org.page.goto(`${BASE}/organisations/demo-org-cdra/evenements/${evId}`);
    check("Événement publié : pas de « Supprimer le brouillon »", (await org.page.locator('button:has-text("Supprimer le brouillon")').count()) === 0);
    await org.page.click("#modifier summary");
    await org.page.fill('#modifier input[name="startsAt"]', parisInput(11, "18:30"));
    await org.page.fill('#modifier input[name="onlineUrl"]', "https://zoom.example.com/j/999");
    await org.page.check('#modifier input[name="benefit_cafe"]');
    await org.page.fill('#modifier input[name="value_cafe"]', "15");
    await org.page.click('button:has-text("Mettre à jour l\'événement")');
    await org.page.waitForTimeout(1500);
    check("Modification : enregistrée, inscrite prévenue", (await org.page.locator("#modifier").innerText()).includes("Événement mis à jour. L'inscrit est prévenu par e-mail."));
    const change = await waitMail("sarah.mercier@demo.kolbase.local", `Changement : « ${title} »`);
    check("E-mail « Changement » : nouvelle date et nouveau lien", !!change && change.text.includes("Nouvelle date") && change.text.includes("Lien de connexion : https://zoom.example.com/j/999"), change?.text.slice(0, 200) ?? "aucun e-mail");
    check("Hospitalités modifiables tant qu'aucun inscrit ne les a acceptées", (await q1(`select "valueCents" from "EventBenefit" where "eventId" = $1 and "catalogId" = 'cafe'`, [evId]))?.valueCents === 1500);
    await org.page.click('button:has-text("Envoyer le rappel maintenant")');
    const reminder = await waitMail("sarah.mercier@demo.kolbase.local", `Rappel : « ${title} »`);
    check("Rappel de la veille : lien de connexion", !!reminder && reminder.text.includes("Lien de connexion : https://zoom.example.com/j/999"), reminder?.text.slice(0, 200) ?? "aucun e-mail");
    // Lien manquant à moins de deux jours : tâche pour l'organisateur.
    await pgc.query(`update "Event" set "startsAt" = now() + interval '1 day', "onlineUrl" = null where id = $1`, [evId]);
    await org.page.goto(`${BASE}/organisations/demo-org-cdra`);
    check("Lien manquant à J-2 : tâche « Ajouter le lien de connexion »", (await text(org.page)).includes(`Ajouter le lien de connexion : ${title}`));
    await org.page.goto(`${BASE}/organisations/demo-org-cdra/evenements/${evId}`);
    check("Lien manquant à J-2 : alerte et formulaire ouvert", (await text(org.page)).includes("Lien de connexion manquant") && (await org.page.locator("#modifier[open]").count()) === 1);
    // Page publique de l'organisation masquée : pas de lien vers elle, bandeau dans l'aperçu.
    await pgc.query(`update "Organization" set listed = false where id = 'demo-org-cdra'`);
    const hidden = await (await fetch(`${BASE}/evenements/${evId}`)).text();
    const ld = JSON.parse(hidden.match(/<script type="application\/ld\+json">([^<]*)<\/script>/)?.[1] ?? "null");
    check("Organisation non visible : ni lien vers sa page, ni url dans les données structurées", !hidden.includes('href="/structures/demo-org-cdra"') && ld?.organizer?.name === "Collège Dentaire Rhône-Alpes" && !ld?.organizer?.url);
    await org.page.goto(`${BASE}/structures/demo-org-cdra`);
    check("Aperçu de la page publique : « Cette page n'est pas visible du public »", (await text(org.page)).includes("Cette page n'est pas visible du public"));
    await pgc.query(`update "Organization" set listed = true where id = 'demo-org-cdra'`);
    // Brouillon jamais publié, sans inscrit : supprimable.
    await org.page.goto(`${BASE}/organisations/demo-org-cdra/evenements/nouveau`);
    await org.page.fill('input[name="title"]', "Brouillon Lot 1 à supprimer");
    await org.page.fill('input[name="startsAt"]', parisInput(30, "09:00"));
    await Promise.all([org.page.waitForURL(/\/evenements\/(?!nouveau)[^/?]+$/), org.page.click('button:has-text("Créer l\'événement")')]);
    const draftId = org.page.url().split("/").at(-1);
    await org.page.click('button:has-text("Supprimer le brouillon")');
    await Promise.all([org.page.waitForURL(/\/evenements$/), org.page.click('button:has-text("Confirmer : supprimer le brouillon")')]);
    check("Brouillon jamais publié : supprimé", !(await q1(`select id from "Event" where id = $1`, [draftId])));
    await prac.ctx.close();
    await org.ctx.close();
    // Hospitalités déjà acceptées : figées, avec une mention.
    const dent = await session();
    await login(dent.page, "claire.morel@demo.kolbase.local");
    await dent.page.goto(`${BASE}/organisations/demo-org-dentalys/evenements/demo-ev-soiree-implanto`);
    await dent.page.click("#modifier summary");
    const frozen = await dent.page.locator("#modifier").innerText();
    check("Hospitalités acceptées par des inscrits : figées, avec une mention", frozen.includes("Hospitalités figées") && (await dent.page.locator('#modifier input[name^="benefit_"]').count()) === 0);
    await dent.ctx.close();
  }

  // 2. Dossier modifiable avant la signature ; honoraires souhaités par l'expert.
  {
    const org = await session();
    await login(org.page, "claire.morel@demo.kolbase.local");
    await org.page.goto(`${BASE}/organisations/demo-org-dentalys/dossiers/nouveau?expert=demo-p-fontaine`);
    await org.page.fill('input[name="title"]', "Board Lot 1 — péri-implantite");
    await org.page.fill('input[name="fee_demo-p-fontaine"]', "1500");
    await Promise.all([org.page.waitForURL(/\/dossiers\/(?!nouveau)[^/?]+$/), org.page.click('button:has-text("Envoyer les sollicitations")')]);
    const dossierUrl = org.page.url();
    const projectId = dossierUrl.split("/").at(-1);
    const link = await q1(`select id from "ProjectExpert" where "projectId" = $1 and "practitionerId" = 'demo-p-fontaine'`, [projectId]);
    const exp = await session();
    await login(exp.page, "isabelle.fontaine@demo.kolbase.local");
    await exp.page.goto(`${BASE}/sollicitations/${link.id}`);
    const sol = await text(exp.page);
    check("Expert : plus de promesse de « contre-proposition », champ « Honoraires souhaités »", !sol.includes("contre-proposition") && (await exp.page.locator('input[name="desiredFee"]').count()) === 1);
    // Lot 5a : d'autres honoraires se proposent par une réponse distincte, qui laisse la sollicitation ouverte.
    await exp.page.fill('input[name="desiredFee"]', "1800");
    await exp.page.click('button:has-text("Proposer d\'autres honoraires")');
    await exp.page.waitForTimeout(1200);
    const counter = await q1(`select "desiredFeeCents", status from "ProjectExpert" where id = $1`, [link.id]);
    check("Expert : autres honoraires proposés, sollicitation ouverte", counter.desiredFeeCents === 180000 && counter.status === "ATT_EXPERTS", JSON.stringify(counter));
    const answer = await waitMail("claire.morel@demo.kolbase.local", "propose d'autres honoraires — Board Lot 1");
    check("E-mail à l'organisation : honoraires proposés par l'expert (ancien et nouveau montant)", !!answer && /1\s500\s€ → 1\s800\s€ HT/.test(answer.text), answer?.text.slice(0, 200) ?? "aucun e-mail");
    await org.page.goto(`${dossierUrl}?onglet=experts`);
    check("Fiche du dossier : honoraires souhaités par l'expert", /Souhaités par l'expert : 1\s800\s€ HT/.test(await text(org.page)));
    // Nouvelle proposition : les honoraires changent, la réponse de l'expert est de nouveau attendue.
    await org.page.goto(`${dossierUrl}?onglet=experts&modifier=1`);
    await org.page.locator('#modifier form.terms-form:has-text("Isabelle Fontaine") input[name="fee"]').fill("1800");
    await org.page.locator('#modifier form.terms-form:has-text("Isabelle Fontaine") button:has-text("Proposer ces conditions")').click();
    await org.page.waitForTimeout(1500);
    const after = await q1(`select pe.status, pe."feeCents", p.status as project from "ProjectExpert" pe join "Project" p on p.id = pe."projectId" where pe.id = $1`, [link.id]);
    check("Conditions modifiées : proposition renvoyée à l'expert", after.status === "ATT_EXPERTS" && after.feeCents === 180000 && after.project === "ATT_EXPERTS", JSON.stringify(after));
    check("Conditions modifiées : journal d'audit", !!(await q1(`select id from "AuditLog" where action = 'project.terms' and "entityId" = $1`, [link.id])));
    const proposal = await waitMail("isabelle.fontaine@demo.kolbase.local", "Nouvelle proposition de Dentalys Implants");
    check("E-mail « Nouvelle proposition » à l'expert", !!proposal && /1\s800\s€/.test(proposal.text), proposal?.subject ?? "aucun e-mail");
    await exp.ctx.close();
    // Lien de l'e-mail ouvert sans session : connexion, puis retour à la sollicitation.
    const viaMail = await session();
    await viaMail.page.goto(linkIn(proposal) ?? `${BASE}/sollicitations/${link.id}`);
    check("Lien d'e-mail sans session : connexion avec next", viaMail.page.url().includes(`/connexion?next=%2Fsollicitations%2F${link.id}`), viaMail.page.url());
    await loginHere(viaMail.page, "isabelle.fontaine@demo.kolbase.local");
    check("Lien d'e-mail : retour à la sollicitation après connexion", viaMail.page.url() === `${BASE}/sollicitations/${link.id}` && (await text(viaMail.page)).includes("Votre réponse"), viaMail.page.url());
    await viaMail.ctx.close();
    // Objet modifié, expert ajouté.
    await org.page.goto(dossierUrl);
    await org.page.click("#objet details.inline-edit summary");
    await org.page.fill('#objet textarea[name="description"]', "Board de quatre heures sur la péri-implantite, synthèse écrite attendue.");
    await org.page.click('button:has-text("Mettre à jour l\'objet")');
    await org.page.waitForTimeout(1200);
    await org.page.goto(`${dossierUrl}?modifier=1`);
    check("Objet du dossier modifié", (await q1(`select description from "Project" where id = $1`, [projectId])).description.startsWith("Board de quatre heures"));
    await org.page.selectOption('#modifier select[name="expertId"]', "demo-p-roux");
    await org.page.fill('#modifier form:has(select[name="expertId"]) input[name="fee"]', "1200");
    await org.page.click('button:has-text("Ajouter et solliciter l\'expert")');
    await org.page.waitForTimeout(1500);
    check("Expert ajouté au dossier et sollicité", !!(await q1(`select id from "ProjectExpert" where "projectId" = $1 and "practitionerId" = 'demo-p-roux' and status = 'ATT_EXPERTS'`, [projectId])) && !!(await waitMail("mathieu.roux@demo.kolbase.local", "Nouvelle sollicitation de Dentalys Implants")));
    // Bloqué par la conformité : « Reprendre le dossier » mène à la modification.
    await pgc.query(`update "Project" set status = 'BLOQUE', "complianceNote" = 'Honoraires à justifier' where id = $1`, [projectId]);
    await org.page.goto(dossierUrl);
    check("Bloqué : pas de modification directe", (await org.page.locator("#modifier").count()) === 0);
    await Promise.all([org.page.waitForURL(/modifier=1/), org.page.click('button:has-text("Reprendre le dossier")')]);
    check("« Reprendre le dossier » mène à la modification (onglet Experts)", (await org.page.locator("#modifier details.terms-edit[open]").count()) > 0 && ["ACCORD", "ATT_EXPERTS"].includes((await q1(`select status from "Project" where id = $1`, [projectId])).status));
    await org.page.goto(dossierUrl);
    check("Abandon : motif obligatoire", (await org.page.locator('form:has(button:has-text("Abandonner le dossier")) input[name="note"][required]').count()) === 1);
    // En signature : retour en accord de principe ou abandon ; plus de retour une fois une signature lancée.
    await pgc.query(`update "Project" set status = 'SIGNATURE' where id = $1`, [projectId]);
    await org.page.goto(dossierUrl);
    check("En signature : « Retour en accord de principe » et abandon proposés", (await org.page.locator('button:has-text("Retour en accord de principe")').count()) === 1 && (await org.page.locator('button:has-text("Abandonner le dossier")').count()) === 1);
    await openMore(org.page);
    await Promise.all([org.page.waitForURL(/modifier=1/), org.page.click('button:has-text("Retour en accord de principe")')]);
    check("Retour en accord de principe : dossier de nouveau modifiable", (await org.page.locator("#modifier details.terms-edit[open]").count()) > 0);
    await pgc.query(`update "Project" set status = 'SIGNATURE' where id = $1`, [projectId]);
    await pgc.query(`insert into "ConventionSignature" (id, "projectExpertId", "requestId", status, "updatedAt") values ('e2e-lot1-sig', $1, 'e2e-lot1-req', 'ongoing', now())`, [link.id]);
    await org.page.goto(dossierUrl);
    check("Signature en cours : plus de retour en accord de principe", (await org.page.locator('button:has-text("Retour en accord de principe")').count()) === 0 && (await text(org.page)).includes("le retour en accord de principe n'est plus possible"));
    await openMore(org.page);
    await org.page.fill('form:has(button:has-text("Abandonner le dossier")) input[name="note"]', "Budget de l'année annulé");
    await org.page.click('button:has-text("Abandonner le dossier")');
    await org.page.waitForTimeout(1200);
    const abandoned = await q1(`select p.status, (select data->>'note' from "AuditLog" where action = 'project.abandon' and "entityId" = p.id) as note from "Project" p where p.id = $1`, [projectId]);
    check("Abandon depuis « En signature », motif dans l'historique", abandoned.status === "DECLINE" && abandoned.note === "Budget de l'année annulé", JSON.stringify(abandoned));
    await org.ctx.close();
  }

  // 9. Devis : TVA à 10 % pour la restauration, conservée après l'envoi ; 7. prestataire après un premier devis retenu.
  {
    const sup = await session();
    await login(sup.page, "ludovic.perrin@demo.kolbase.local");
    await sup.page.goto(`${BASE}/organisations/demo-sup-belleville`);
    check("Prestataire après un premier devis retenu : tâche « Activer l'abonnement »", (await text(sup.page)).includes("Activer l'abonnement"));
    await pgc.query(`insert into "Subscription" ("organizationId", plan, status, "exemptUntil", "updatedAt") values ('demo-sup-belleville', 'prestataire', 'a_activer', '2099-12-31', now()) on conflict ("organizationId") do update set "exemptUntil" = '2099-12-31'`);
    await pgc.query(`insert into "Rfq" (id, "organizationId", category, needs, status, "sentAt", headcount, city) values ('e2e-lot1-rfq-tva', 'demo-org-dentalys', 'restauration', 'Cocktail Lot 1 pour 40 personnes, soirée scientifique.', 'sent', now(), 40, 'Lyon')`);
    await pgc.query(`insert into "RfqSupplier" ("rfqId", "supplierId") values ('e2e-lot1-rfq-tva', 'demo-sup-belleville')`);
    await sup.page.goto(`${BASE}/organisations/demo-sup-belleville/devis/e2e-lot1-rfq-tva`);
    const card = sup.page.locator("main");
    check("Devis de restauration : TVA à 10 % proposée", (await card.locator('select[name="line_vat"]').first().inputValue()) === "1000");
    await card.locator('input[name="line_label"]').first().fill("Cocktail dînatoire 12 pièces");
    await card.locator('input[name="line_qty"]').first().fill("40");
    await card.locator('input[name="line_unit"]').first().fill("38");
    await card.locator('button:has-text("Envoyer le devis")').click();
    await sup.page.waitForTimeout(1500);
    const sent = await q1(`select "vatBp" from "Quote" where "rfqId" = 'e2e-lot1-rfq-tva'`);
    check("Devis envoyé : formulaire refermé, TVA enregistrée à 10 %", sent?.vatBp === 1000 && (await card.locator('button:has-text("Réviser mon devis")').count()) === 1 && (await card.locator("form.quote-form").count()) === 0, JSON.stringify(sent));
    await card.locator('button:has-text("Réviser mon devis")').click();
    check("Révision : la TVA affichée reste celle envoyée", (await card.locator('select[name="line_vat"]').first().inputValue()) === "1000");
    await sup.ctx.close();
    // Prestataire sans devis retenu : référencement gratuit, aucun bouton de paiement.
    const won = await q1(`select count(*)::int n from "Quote" where "supplierId" = 'demo-org-mediane' and status = 'retained'`);
    await pgc.query(`delete from "Subscription" where "organizationId" = 'demo-org-mediane'`);
    const ag = await session();
    await login(ag.page, "karim.benali@demo.kolbase.local");
    await ag.page.goto(`${BASE}/organisations/demo-org-mediane/abonnement`);
    check("Prestataire sans devis retenu : « Référencement gratuit », pas de paiement", won.n === 0 && (await text(ag.page)).includes("Référencement gratuit : rien à payer avant votre premier devis retenu") && (await ag.page.locator('button:has-text("Activer l\'abonnement")').count()) === 0);
    await ag.ctx.close();
  }

  // 5 et 6. Décisions de l'équipe KolBase annoncées ; page publique activée à la validation.
  {
    check("E-mail : organisation validée (Implants Express)", !!(await waitMail("ines.lambert@demo.kolbase.local", "Implants Express est validée sur KolBase")));
    check("E-mail : identité du praticien vérifiée", !!(await waitMail("hugo.robert@demo.kolbase.local", "Votre identité est vérifiée sur KolBase")));
    const gift = await waitMail("pierre.vidal@demo.kolbase.local", "KolBase vous offre l'abonnement jusqu'au");
    check("E-mail : gratuité de l'abonnement offerte", !!gift && gift.text.includes("Pilote"), gift?.subject ?? "aucun e-mail");
    await pgc.query(`insert into "Organization" (id, name, kind, siren, verification, listed, areas, "updatedAt") values ('e2e-lot1-labo', 'Laboratoire Lot Un', 'INDUSTRIEL', '552100554', 'PENDING', false, '{}', now()), ('e2e-lot1-refus', 'Société Lot Refus', 'INDUSTRIEL', null, 'PENDING', false, '{}', now())`);
    await pgc.query(`insert into "Membership" (id, "userId", "organizationId", role) select 'e2e-lot1-m1', id, 'e2e-lot1-labo', 'ADMIN' from "User" where email = 'julie.lemoine@demo.kolbase.local'`);
    await pgc.query(`insert into "Membership" (id, "userId", "organizationId", role) select 'e2e-lot1-m2', id, 'e2e-lot1-refus', 'ADMIN' from "User" where email = 'hugo.robert@demo.kolbase.local'`);
    const adm = await session();
    await login(adm.page, "anne.chevalier@demo.kolbase.local");
    await adm.page.goto(`${BASE}/admin/organisations`);
    const labo = adm.page.locator('section.card:has-text("Laboratoire Lot Un")').first();
    check("Admin : « Page publique : non » avant validation", /Page publique\s*non/.test(await labo.innerText()));
    check("Admin : motif du refus obligatoire", (await labo.locator('form:has(button:has-text("Refuser")) input[name="note"][required]').count()) === 1);
    await labo.locator('button:has-text("Valider")').click();
    await adm.page.waitForTimeout(1200);
    const lab = await q1(`select verification, listed from "Organization" where id = 'e2e-lot1-labo'`);
    check("Validation : page publique activée", lab.verification === "VERIFIED" && lab.listed === true && (await fetch(`${BASE}/structures/e2e-lot1-labo`)).status === 200, JSON.stringify(lab));
    check("E-mail aux administrateurs : organisation validée", !!(await waitMail("julie.lemoine@demo.kolbase.local", "Laboratoire Lot Un est validée sur KolBase")));
    await adm.page.goto(`${BASE}/admin/organisations/e2e-lot1-labo`);
    check("Admin : « Page publique : oui » après validation", /Page publique\s*oui/.test(await adm.page.locator('section.card:has-text("Laboratoire Lot Un")').first().innerText()));
    const refus = () => adm.page.locator('section.card:has-text("Société Lot Refus")').first();
    await adm.page.goto(`${BASE}/admin/organisations?statut=a-valider`);
    // Lot 5b : une organisation suspendue ne peut plus être refusée ; le refus se fait avant la validation.
    await refus().locator('form:has(button:has-text("Refuser")) input[name="note"]').fill("SIREN déjà utilisé par une autre organisation");
    await refus().locator('button:has-text("Refuser")').click();
    await adm.page.waitForTimeout(1200);
    const rej = await waitMail("hugo.robert@demo.kolbase.local", "Société Lot Refus n'a pas été validée sur KolBase");
    check("E-mail : refus, avec le motif", !!rej && rej.text.includes("Motif : SIREN déjà utilisé"));
    await adm.page.goto(`${BASE}/admin/organisations/e2e-lot1-refus`);
    await refus().locator('button:has-text("Valider")').click();
    await adm.page.waitForTimeout(1200);
    await adm.page.goto(`${BASE}/admin/organisations/e2e-lot1-refus`);
    check("Admin : motif de la suspension obligatoire", (await refus().locator('form:has(button:has-text("Suspendre")) input[name="note"][required]').count()) === 1);
    await refus().locator('form:has(button:has-text("Suspendre")) input[name="note"]').fill("Activité sans lien avec le secteur dentaire");
    await refus().locator('button:has-text("Suspendre")').click();
    await refus().locator('button:has-text("Confirmer : suspendre")').click();
    await adm.page.waitForTimeout(1200);
    const susp = await waitMail("hugo.robert@demo.kolbase.local", "Société Lot Refus est suspendue sur KolBase");
    check("E-mail : suspension, avec le motif", !!susp && susp.text.includes("Motif : Activité sans lien avec le secteur dentaire"));
    // État final inchangé pour la suite du parcours : organisation refusée.
    await pgc.query(`update "Organization" set verification = 'REJECTED', listed = false where id = 'e2e-lot1-refus'`);
    await pgc.query(`update "PractitionerProfile" set rpps = '19900000001', "rppsVerified" = false, "rppsCheckedAt" = null where id = 'demo-p-simon'`);
    await adm.page.goto(`${BASE}/admin?onglet=praticiens`);
    const simon = adm.page.locator('section.card:has-text("Emma Simon")');
    check("Admin : motif obligatoire pour refuser une identité", (await simon.locator('form:has(button:has-text("Refuser")) input[name="note"][required]').count()) === 1);
    await simon.locator('form:has(button:has-text("Refuser")) input[name="note"]').fill("Numéro introuvable dans l'Annuaire Santé");
    await simon.locator('button:has-text("Refuser")').click();
    await adm.page.waitForTimeout(1200);
    const idRej = await waitMail("emma.simon@demo.kolbase.local", "Votre identifiant professionnel n'a pas pu être vérifié");
    check("E-mail : identité refusée, motif et consigne", !!idRej && idRej.text.includes("Numéro introuvable") && idRej.text.includes("Informations personnelles"));
    await adm.ctx.close();
  }

  // 7. Prise en main : ligne « Abonnement » ; publication bloquée, puis reprise après le paiement.
  {
    await pgc.query(`insert into "Event" (id, "organizationId", title, "typeId", "startsAt", format, city, "updatedAt") values ('e2e-lot1-ev', 'e2e-lot1-labo', 'Atelier Lot Un', 'travaux-pratiques', now() + interval '20 days', 'PRESENTIEL', 'Lyon', now())`);
    const m = await session();
    await login(m.page, "julie.lemoine@demo.kolbase.local");
    await m.page.goto(`${BASE}/organisations/e2e-lot1-labo`);
    check("Prise en main : ligne « Abonnement » (gratuit puis 599 € HT par mois)", /Abonnement : création, équipe, annuaire et brouillons gratuits ; 599\s€ HT par mois/.test(await text(m.page)));
    await m.page.goto(`${BASE}/organisations/e2e-lot1-labo/evenements/e2e-lot1-ev`);
    const bannerLink = m.page.locator('a[href="/organisations/e2e-lot1-labo/abonnement?motif=evenement&objet=e2e-lot1-ev"]');
    check("Publication sans abonnement : bandeau avec lien direct, bouton désactivé", (await bannerLink.count()) === 1 && (await m.page.locator('button:has-text("Publier dans l\'agenda")').isDisabled()));
    await bannerLink.click();
    await m.page.waitForURL(/abonnement\?motif=evenement/);
    await m.page.click('button:has-text("Activer l\'abonnement mensuel")');
    await m.page.waitForURL(/\/abonnement\?session=cs_/, { timeout: 15000 });
    check("Retour de paiement : « Abonnement activé », motif et objet conservés", m.page.url().includes("motif=evenement&objet=e2e-lot1-ev") && (await text(m.page)).includes("Abonnement activé"), m.page.url());
    // Organisation neuve : le contrat de sous-traitance n'est pas encore accepté, la publication y mène d'abord.
    await Promise.all([m.page.waitForURL(/\/membres\?onglet=organisation&motif=evenement&objet=e2e-lot1-ev/), m.page.click('button:has-text("Publier maintenant")')]);
    check("Contrat non accepté : « Publier maintenant » mène au contrat de sous-traitance", !(await q1(`select "publishedAt" from "Event" where id = 'e2e-lot1-ev'`)).publishedAt && (await text(m.page)).includes("Pour publier un événement dans l'agenda, ce contrat doit d'abord être accepté"));
    await m.page.click('button:has-text("Accepter au nom de Laboratoire Lot Un")');
    await m.page.waitForSelector('button:has-text("Publier maintenant")');
    await Promise.all([m.page.waitForURL(/\?publie=1/), m.page.click('button:has-text("Publier maintenant")')]);
    check("Retour de paiement : « Publier maintenant » publie l'événement", !!(await q1(`select "publishedAt" from "Event" where id = 'e2e-lot1-ev'`)).publishedAt);
    await m.ctx.close();
  }
  await pgc.end();
}

// ── Lot 2 : conformité et chiffres justes ──────────────────────────────────
{
  const pgc = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await pgc.connect();
  const q1 = async (sql, args = []) => (await pgc.query(sql, args)).rows[0];
  /** Valeur d'un champ « date et heure » (heure de Paris), dans `days` jours. */
  const parisInput = (days, hm) => `${new Date(Date.now() + days * 864e5).toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" })}T${hm}`;

  // 1. Contrat de sous-traitance exigé avant la première action qui engage un tiers (organisation neuve,
  //    abonnement offert pour isoler le contrat).
  {
    await pgc.query(`insert into "Organization" (id, name, kind, verification, "verifiedAt", listed, areas, "updatedAt") values ('e2e-lot2-cs', 'Société Lot Deux', 'SOCIETE_SAVANTE', 'VERIFIED', now(), true, '{}', now())`);
    await pgc.query(`insert into "Membership" (id, "userId", "organizationId", role) select 'e2e-lot2-m1', id, 'e2e-lot2-cs', 'ADMIN' from "User" where email = 'marc.lefevre@demo.kolbase.local'`);
    await pgc.query(`insert into "Membership" (id, "userId", "organizationId", role) select 'e2e-lot2-m2', id, 'e2e-lot2-cs', 'PROJETS' from "User" where email = 'nadia.haddad@demo.kolbase.local'`);
    await pgc.query(`insert into "Subscription" ("organizationId", plan, status, "exemptUntil", "updatedAt") values ('e2e-lot2-cs', 'organisation', 'a_activer', now() + interval '1 year', now())`);
    const dpaLink = (motif) => `a[href="/organisations/e2e-lot2-cs/membres?onglet=organisation&motif=${motif}#sous-traitance"]`;
    const p = await session();
    await login(p.page, "nadia.haddad@demo.kolbase.local");
    await p.page.goto(`${BASE}/organisations/e2e-lot2-cs/dossiers/nouveau`);
    let t = await text(p.page);
    check("Contrat non accepté : bandeau avec lien vers Membres et réglages › Organisation", t.includes("doit d'abord accepter le contrat de sous-traitance (RGPD)") && (await p.page.locator(dpaLink("sollicitation")).count()) === 1 && !t.includes("l'abonnement de l'organisation doit être activé"));
    check("Contrat non accepté : envoi désactivé, consigne", (await p.page.locator('button:has-text("Envoyer les sollicitations")').isDisabled()) && t.includes("Envoi possible une fois le contrat de sous-traitance accepté par un administrateur"));
    await p.page.fill('input[name="title"]', "Board Lot Deux");
    await p.page.locator(".expert-pick label.check input").first().check();
    const fee = p.page.locator('input[name^="fee_"]').first();
    if (!(await fee.inputValue())) await fee.fill("1200");
    await p.page.locator('button:has-text("Envoyer les sollicitations")').evaluate((b) => { b.disabled = false; });
    await p.page.click('button:has-text("Envoyer les sollicitations")');
    await p.page.waitForTimeout(1500);
    t = await text(p.page);
    check("Contrat non accepté : sollicitation refusée par le serveur, message et lien", t.includes("un administrateur de l'organisation doit d'abord accepter le contrat de sous-traitance (RGPD) : Membres et réglages › Organisation.") && (await p.page.locator('.notice.error a:has-text("Accepter le contrat de sous-traitance")').count()) === 1 && (await q1(`select count(*)::int n from "Project" where "organizationId" = 'e2e-lot2-cs'`)).n === 0);
    for (const [path, motif] of [["opportunites", "appel"], ["evenements/nouveau", "evenement"], ["prestataires?onglet=nouvelle", "devis"]]) {
      await p.page.goto(`${BASE}/organisations/e2e-lot2-cs/${path}`);
      check(`Contrat non accepté : bandeau sur ${path.split("?")[0]}`, (await p.page.locator(dpaLink(motif)).count()) === 1);
    }
    await p.page.goto(`${BASE}/organisations/e2e-lot2-cs/membres?onglet=organisation&motif=sollicitation#sous-traitance`);
    t = await text(p.page);
    check("Contrat : un membre non administrateur ne peut pas l'accepter", t.includes("ce contrat doit d'abord être accepté par un administrateur") && (await p.page.locator('button:has-text("Accepter au nom de")').count()) === 0);
    const a = await session();
    await login(a.page, "marc.lefevre@demo.kolbase.local");
    await a.page.goto(`${BASE}/organisations/e2e-lot2-cs`);
    check("Contrat : étape de prise en main pour l'administrateur", (await text(a.page)).includes("Accepter le contrat de sous-traitance (RGPD)"));
    await a.page.goto(`${BASE}/organisations/e2e-lot2-cs/membres?onglet=organisation&motif=sollicitation#sous-traitance`);
    await a.page.click('button:has-text("Accepter au nom de Société Lot Deux")');
    await a.page.waitForTimeout(1200);
    t = await text(a.page);
    const dpa = await q1(`select "dpaVersion", "dpaAcceptedById" from "Organization" where id = 'e2e-lot2-cs'`);
    check("Contrat accepté : tracé, et reprise de l'action proposée", !!dpa.dpaVersion && !!dpa.dpaAcceptedById && t.includes("Contrat accepté : vous pouvez reprendre votre action") && (await a.page.locator('a.btn[href="/organisations/e2e-lot2-cs/dossiers/nouveau"]').count()) === 1, JSON.stringify(dpa));
    await a.ctx.close();
    await p.page.goto(`${BASE}/organisations/e2e-lot2-cs/dossiers/nouveau`);
    check("Contrat accepté : plus de bandeau, envoi possible", !(await text(p.page)).includes("accepter le contrat de sous-traitance") && !(await p.page.locator('button:has-text("Envoyer les sollicitations")').isDisabled()));
    await p.page.fill('input[name="title"]', "Board Lot Deux");
    await p.page.locator(".expert-pick label.check input").first().check();
    const fee2 = p.page.locator('input[name^="fee_"]').first();
    if (!(await fee2.inputValue())) await fee2.fill("1200");
    await p.page.click('button:has-text("Envoyer les sollicitations")');
    await p.page.waitForTimeout(1500);
    check("Contrat accepté : sollicitation envoyée", /\/dossiers\/[^/]+$/.test(p.page.url()) && !p.page.url().endsWith("/nouveau"), p.page.url());
    await p.ctx.close();
  }

  // 2. Suggestions d'experts : aucune autre organisation nommée (écran et assistant), seuls les dossiers signés comptent.
  {
    await pgc.query(`insert into "DeclaredInterest" (id, "practitionerId", organization, nature, "startYear") values ('e2e-lot2-di', 'demo-p-durand', 'Laboratoire Concurrent Lot Deux', 'Consultante', 2025)`);
    await pgc.query(`insert into "Project" (id, "organizationId", title, "typeId", "therapeuticArea", status, "updatedAt") values ('e2e-lot2-prj-signe', 'demo-org-orthonova', 'Board OrthoNova signé', 'advisory', 'Implantologie', 'SIGNE', now()), ('e2e-lot2-prj-accord', 'demo-org-orthonova', 'Board OrthoNova en accord', 'advisory', 'Implantologie', 'ACCORD', now())`);
    await pgc.query(`insert into "ProjectExpert" (id, "projectId", "practitionerId", status, "feeCents", days) values ('e2e-lot2-pe-signe', 'e2e-lot2-prj-signe', 'demo-p-durand', 'SIGNE', 200000, 1), ('e2e-lot2-pe-accord', 'e2e-lot2-prj-accord', 'demo-p-moreau', 'ACCORD', 200000, 1)`);
    const { ctx, page } = await session();
    await login(page, "claire.morel@demo.kolbase.local");
    await page.goto(`${BASE}/organisations/demo-org-dentalys/dossiers/nouveau`);
    await page.fill('input[name="title"]', "Board implants courts — lot 2");
    await page.fill('input[name="therapeuticArea"]', "Implantologie");
    const before = aiRequests.length;
    await page.click('button:has-text("Suggérer des experts")');
    await page.waitForSelector(".suggest-box", { timeout: 15000 });
    const box = await page.locator(".suggest-box").innerText();
    const durand = await page.locator('.suggest-list li:has-text("Hélène Durand")').innerText().catch(() => "");
    const moreau = await page.locator('.suggest-list li:has-text("Vincent Moreau")').innerText().catch(() => "");
    check("Suggestions : « collaboration récente avec une autre entreprise », lien déclaré compté", durand.includes("collaboration récente avec une autre entreprise") && durand.includes("1 lien déclaré par l'expert"), durand.replace(/\s+/g, " "));
    check("Suggestions : aucun nom d'autre organisation", !box.includes("OrthoNova") && !box.includes("Laboratoire Concurrent Lot Deux") && !box.includes("Alpha Ortho"));
    check("Suggestions : un dossier non signé ne compte pas comme collaboration", !!moreau && !moreau.includes("autre entreprise"), moreau.replace(/\s+/g, " "));
    const prompt = JSON.stringify(aiRequests.slice(before));
    check("Assistant d'IA : aucun nom d'autre organisation transmis", prompt.includes("collaboration récente avec une autre entreprise") && !prompt.includes("OrthoNova") && !prompt.includes("Laboratoire Concurrent Lot Deux"));
    await ctx.close();
    await pgc.query(`delete from "ProjectExpert" where id in ('e2e-lot2-pe-signe', 'e2e-lot2-pe-accord')`);
    await pgc.query(`delete from "Project" where id in ('e2e-lot2-prj-signe', 'e2e-lot2-prj-accord')`);
    await pgc.query(`delete from "DeclaredInterest" where id = 'e2e-lot2-di'`);
  }

  // 3. Seuils d'hospitalité : alerte à la saisie, régime par prestation, Hospitalités, Autorisations, convention.
  {
    const { ctx, page } = await session();
    await login(page, "claire.morel@demo.kolbase.local");
    await page.goto(`${BASE}/organisations/demo-org-dentalys/evenements/nouveau`);
    await page.fill('input[name="title"]', "Congrès Lot Deux — hospitalités");
    await page.fill('input[name="startsAt"]', parisInput(90, "09:00"));
    await page.check('input[name="benefit_nuitee"]');
    await page.fill('input[name="value_nuitee"]', "180");
    let t = await text(page);
    check("Saisie d'un événement : alerte en direct au-delà du seuil (nuitée)", t.includes("Au-delà de 150 € TTC par nuitée : autorisation") && t.includes("soumise à autorisation de l'Ordre, à demander au moins 60 jours avant"));
    await page.fill('input[name="value_nuitee"]', "140");
    t = await text(page);
    check("Saisie d'un événement : sous les seuils, déclaration", !t.includes("Au-delà de 150 €") && t.includes("Sous les seuils d'autorisation de votre organisation : convention d'hospitalité déclarée"));
    await page.fill('input[name="value_nuitee"]', "180");
    await page.check('input[name="benefit_dejeuner"]');
    await Promise.all([page.waitForURL(/\/evenements\/(?!nouveau)[^/?]+$/), page.click('button:has-text("Créer l\'événement")')]);
    const evId = page.url().split("/").pop();
    const night = await page.locator('section.card:has(h2:has-text("Hospitalités proposées")) li:has-text("Nuitée d\'hôtel")').innerText();
    const lunch = await page.locator('section.card:has(h2:has-text("Hospitalités proposées")) li:has-text("Déjeuner sur place")').innerText();
    check("Fiche de l'événement : régime par prestation", night.includes("Autorisation") && lunch.includes("Déclaration") && (await text(page)).includes("Participant qui accepte toutes les prestations : convention soumise à autorisation"), `${night} | ${lunch}`);
    await pgc.query(`insert into "Registration" (id, "eventId", "userId", profession) values ('e2e-lot2-reg-hosp', $1, 'demo-u-durand', 'Chirurgien-dentiste')`, [evId]);
    await pgc.query(`insert into "RegistrationBenefit" ("registrationId", "benefitId", "valueCents") select 'e2e-lot2-reg-hosp', id, "valueCents" from "EventBenefit" where "eventId" = $1 and "catalogId" in ('nuitee', 'dejeuner')`, [evId]);
    await ctx.close();
    // Hospitalités, autorisations, conventions : espace de la conformité.
    const so = await session();
    await login(so.page, "sophie.bernard@demo.kolbase.local");
    await so.page.goto(`${BASE}/organisations/demo-org-dentalys/hospitalites`);
    const row = await so.page.locator('section.card:has-text("Congrès Lot Deux") tr:has-text("DURAND")').innerText();
    check("Hospitalités : colonne Régime", (await so.page.locator('section.card:has-text("Congrès Lot Deux") th:has-text("Régime")').count()) === 1 && row.includes("Autorisation"), row);
    await so.page.goto(`${BASE}/organisations/demo-org-dentalys/conformite?onglet=autorisations`);
    const auth = await so.page.locator('tr:has-text("Congrès Lot Deux")').innerText().catch(() => "");
    check("Autorisations : l'hospitalité soumise à autorisation y remonte", (await text(so.page)).includes("Hospitalités soumises à autorisation") && auth.includes("DURAND Hélène") && auth.includes("Nuitée 180 € > 150 €") && auth.includes("Avant le"), auth);
    const conv = await so.page.request.get(`${BASE}/organisations/demo-org-dentalys/hospitalites/convention/e2e-lot2-reg-hosp`);
    check("Convention d'hospitalité (PDF) disponible pour une hospitalité soumise à autorisation", conv.status() === 200 && (conv.headers()["content-type"] ?? "").includes("pdf"));
    await so.ctx.close();
  }

  // 4. Une définition par indicateur.
  {
    const n = (s) => s.replace(/\s/g, " ");
    // Collaborations = dossiers signés : fiche publique et écran de suppression du compte.
    const counts = await q1(`select count(*) filter (where status in ('SIGNE', 'TERMINE'))::int signed, count(*) filter (where status not in ('ATT_EXPERTS', 'DECLINE'))::int engaged from "ProjectExpert" where "practitionerId" = 'demo-p-martin'`);
    const c = await session();
    await login(c.page, "claire.morel@demo.kolbase.local");
    await c.page.goto(`${BASE}/experts/demo-p-martin`);
    const collab = await c.page.locator('.stat-card:has-text("Collaborations via KolBase") .stat-value').innerText().catch(() => "");
    check("Fiche expert : seules les collaborations signées sont comptées", collab === String(counts.signed) && counts.engaged > counts.signed, `${collab} / ${JSON.stringify(counts)}`);
    // Dossier : « engagé » = accepté par l'expert, « proposé » à part, même définition dans l'en-tête et le budget.
    await pgc.query(`insert into "Project" (id, "organizationId", title, "typeId", "therapeuticArea", status, "budgetCents", "updatedAt") values ('e2e-lot2-prj-budget', 'demo-org-dentalys', 'Board budget lot 2', 'advisory', 'Implantologie', 'ACCORD', 1000000, now())`);
    await pgc.query(`insert into "ProjectExpert" (id, "projectId", "practitionerId", status, "feeCents", days) values ('e2e-lot2-pb-1', 'e2e-lot2-prj-budget', 'demo-p-durand', 'ACCORD', 200000, 1), ('e2e-lot2-pb-2', 'e2e-lot2-prj-budget', 'demo-p-moreau', 'ATT_EXPERTS', 150000, 1), ('e2e-lot2-pb-3', 'e2e-lot2-prj-budget', 'demo-p-blanc', 'DECLINE', 90000, 1)`);
    await c.page.goto(`${BASE}/organisations/demo-org-dentalys/dossiers/e2e-lot2-prj-budget`);
    const head = n(await c.page.locator("header.page-hero").innerText());
    const tiles = n(await c.page.locator(".state-grid").innerText());
    check("Dossier : repères, engagé = accepté, proposé à part", /1 engagé sur 3/i.test(tiles) && /1 réponse attendue/i.test(tiles) && /20 % engagé/i.test(tiles), tiles);
    await tab(c.page, "budget");
    const budget = n(await c.page.locator("section.budget-card").innerText());
    check("Dossier : budget, même définition", /2 000 €\s*engagés \(HT\) · 20 % du budget/.test(budget) && /Honoraires engagés\s*2 000 €/.test(budget) && /Honoraires proposés, sans réponse\s*1 500 €/.test(budget) && /Reste disponible\s*8 000 €/.test(budget), budget);
    check("Dossier : en-tête resserré (étape en cours, objet dans la vue d'ensemble)", /étape 2 sur 7/i.test(head) && head.includes("ensuite :"), head);
    // HT / TTC toujours indiqué ; coût par participant d'un devis rapporté aux présents après l'événement.
    await c.page.goto(`${BASE}/organisations/demo-org-dentalys/prestataires`);
    const presta = n(await text(c.page));
    await c.page.goto(`${BASE}/organisations/demo-org-dentalys/prestataires/demo-rfq-passe-cocktail`);
    const kept = n(await c.page.locator("section#rfq-demo-rfq-passe-cocktail .hero-facts").innerText());
    check("Prestataires : HT / TTC indiqués (budget engagé, prestation attribuée)", /Budget prestataires engagé\s*[\d ]+(,\d+)? € HT/i.test(presta) && /montant retenu\s*[\d ]+(,\d+)? € HT\s*[\d ]+(,\d+)? € TTC/i.test(kept), kept);
    await c.page.goto(`${BASE}/organisations/demo-org-dentalys/evenements/demo-ev-passe`);
    const past = n(await text(c.page));
    check("Événement passé : coût d'un devis par présent, montants en TTC", past.includes("€ TTC par présent") && /Coût réel\s*[\d ]+(,\d+)? € TTC/i.test(past) && past.includes("non consommées, elles ne sont pas déclarées"));
    await c.ctx.close();
    // Absents : ni « à déclarer », affichés « absent : non déclaré » (espace de la conformité).
    const so = await session();
    await login(so.page, "sophie.bernard@demo.kolbase.local");
    await so.page.goto(`${BASE}/organisations/demo-org-dentalys/hospitalites`);
    const todo = await so.page.locator('section.card:has-text("Soirée régénération osseuse")').innerText().catch(() => "");
    check("Hospitalités à déclarer : sans l'absent au pointage", !todo.includes("GIRARD"), todo.slice(0, 200));
    await so.page.goto(`${BASE}/organisations/demo-org-dentalys/hospitalites?statut=toutes`);
    const girardRow = await so.page.locator('section.card:has-text("Soirée régénération osseuse") tr:has-text("GIRARD")').innerText().catch(() => "");
    check("Hospitalités (toutes) : « Absent : non déclaré », pas de déclaration proposée", girardRow.includes("Absent : non déclaré") && !girardRow.includes("Marquer déclaré"), girardRow);
    await so.ctx.close();
    // Côté praticien absent : revenus, liens d'intérêts, Transparence, inscriptions, avis.
    await pgc.query(`insert into "Project" (id, "organizationId", title, "typeId", status, "updatedAt") values ('e2e-lot2-prj-g1', 'demo-org-orthonova', 'Atelier CFAO signé', 'travaux-pratiques', 'SIGNE', now()), ('e2e-lot2-prj-g2', 'demo-org-orthonova', 'Atelier CFAO bloqué', 'travaux-pratiques', 'BLOQUE', now())`);
    await pgc.query(`insert into "ProjectExpert" (id, "projectId", "practitionerId", status, "feeCents", days) values ('e2e-lot2-pg-1', 'e2e-lot2-prj-g1', 'demo-p-girard', 'SIGNE', 150000, 1), ('e2e-lot2-pg-2', 'e2e-lot2-prj-g2', 'demo-p-girard', 'BLOQUE', 200000, 1)`);
    const g = await session();
    await login(g.page, "olivier.girard@demo.kolbase.local");
    await g.page.goto(`${BASE}/revenus`);
    const rev = n(await text(g.page));
    const eur = (c) => n((c / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: c % 100 ? 2 : 0 }));
    const exp = await q1(`select coalesce(sum("feeCents") filter (where status in ('SIGNE', 'TERMINE')), 0)::int due, coalesce(sum("feeCents") filter (where status not in ('SIGNE', 'TERMINE', 'ATT_EXPERTS', 'DECLINE')), 0)::int prep, count(*) filter (where status = 'BLOQUE')::int blocked from "ProjectExpert" where "practitionerId" = 'demo-p-girard' and "paidAt" is null and extract(year from coalesce("respondedAt", "createdAt")) = extract(year from now())`);
    check("Revenus : « À percevoir » = signé non payé, « En préparation » à part (dossier bloqué)", rev.toLowerCase().includes(`à percevoir ${eur(exp.due)}`) && rev.toLowerCase().includes(`en préparation ${eur(exp.prep)}`) && exp.blocked >= 1 && exp.due >= 150000, `${JSON.stringify(exp)} | ${rev.slice(0, 300)}`);
    check("Revenus : hospitalité d'un absent « Absent : non déclaré », hors total", rev.includes("Absent : non déclaré") && /Hospitalités reçues\s*0 €/i.test(rev));
    await g.page.goto(`${BASE}/revenus?onglet=liens`);
    check("Liens d'intérêts : pas d'hospitalité d'un absent", !(await text(g.page)).includes("Soirée régénération osseuse"));
    await g.page.goto(`${BASE}/revenus?onglet=transparence`);
    const tr = await g.page.locator('li:has-text("Soirée régénération osseuse")').innerText().catch(() => "");
    check("Transparence (praticien) : « Absent : non déclaré »", tr.includes("Absent : non déclaré") && !tr.includes("À déclarer par l'organisation"), tr);
    await g.page.goto(`${BASE}/inscriptions`);
    const reg = await g.page.locator('.reg-tile:has-text("Soirée régénération osseuse")').innerText().catch(() => "");
    check("Mes inscriptions : absent, pas de « Donner mon avis »", reg.includes("absent : non déclaré") && !reg.includes("Donner mon avis"), reg);
    await g.page.goto(`${BASE}/evenements/demo-ev-passe/avis`);
    check("Questionnaire : réservé aux présents", (await text(g.page)).includes("réservé aux participants dont la présence a été enregistrée") && (await g.page.locator("form.survey-form").count()) === 0);
    // « Vous intervenez » seulement quand l'expert a accepté les honoraires proposés.
    await pgc.query(`insert into "OpenCall" (id, "organizationId", title, "typeId", "eventId", status) values ('e2e-lot2-call', 'demo-org-dentalys', 'Intervenant live surgery lot 2', 'pleniere', 'demo-ev-live-surgery', 'closed')`);
    await pgc.query(`insert into "Project" (id, "organizationId", title, "typeId", status, "updatedAt") values ('e2e-lot2-prj-spk', 'demo-org-dentalys', 'Intervention live surgery lot 2', 'pleniere', 'ATT_EXPERTS', now())`);
    await pgc.query(`insert into "ProjectExpert" (id, "projectId", "practitionerId", status, "feeCents", days) values ('e2e-lot2-ps-1', 'e2e-lot2-prj-spk', 'demo-p-girard', 'ATT_EXPERTS', 80000, 1)`);
    await pgc.query(`insert into "Application" (id, "openCallId", "practitionerId", status, "projectId") values ('e2e-lot2-app', 'e2e-lot2-call', 'demo-p-girard', 'retained', 'e2e-lot2-prj-spk')`);
    await g.page.goto(`${BASE}/tableau-de-bord`);
    let dash = await text(g.page);
    check("Tableau de bord : « Honoraires proposés, à accepter » avant l'acceptation", dash.includes("Honoraires proposés, à accepter · Dentalys Implants") && !dash.includes("Vous intervenez · Dentalys Implants"));
    await g.page.goto(`${BASE}/interventions?onglet=interventions`);
    let card = await g.page.locator('.card:has-text("Intervenant live surgery lot 2"), .card:has(a[href="/evenements/demo-ev-live-surgery"])').first().innerText().catch(() => "");
    check("Mes interventions : à accepter, pas encore « Vous intervenez »", card.includes("Honoraires proposés, à accepter") && !card.includes("Vous intervenez"), card);
    await pgc.query(`update "ProjectExpert" set status = 'ACCORD', "respondedAt" = now() where id = 'e2e-lot2-ps-1'`);
    await g.page.goto(`${BASE}/tableau-de-bord`);
    dash = await text(g.page);
    await g.page.goto(`${BASE}/interventions?onglet=interventions`);
    card = await g.page.locator('.card:has(a[href="/evenements/demo-ev-live-surgery"])').first().innerText().catch(() => "");
    check("Honoraires acceptés : « Vous intervenez »", dash.includes("Vous intervenez · Dentalys Implants") && card.includes("Vous intervenez"), card);
    await g.ctx.close();
    // Suppression du compte : seules les conventions signées sont retenues.
    const m = await session();
    await login(m.page, "antoine.martin@demo.kolbase.local");
    await m.page.goto(`${BASE}/compte`);
    await m.page.click('summary:has-text("Supprimer mon compte")');
    const del = await m.page.locator('details:has(summary:has-text("Supprimer mon compte"))').innerText();
    check("Suppression du compte : conventions signées seulement", del.includes(`vos ${counts.signed} convention(s)`), del.slice(0, 400));
    await m.ctx.close();
  }

  // 5. Signature électronique close quand la convention signée est déposée à la main ou que le dossier passe « Signé ».
  {
    const pdf = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n");
    await pgc.query(`insert into "Project" (id, "organizationId", title, "typeId", status, "updatedAt") values ('e2e-lot2-prj-sig', 'demo-org-academie', 'Formation lot 2 en signature', 'dpc', 'SIGNATURE', now())`);
    await pgc.query(`insert into "ProjectExpert" (id, "projectId", "practitionerId", status, "feeCents", days) values ('e2e-lot2-sig-roux', 'e2e-lot2-prj-sig', 'demo-p-roux', 'SIGNATURE', 150000, 1), ('e2e-lot2-sig-fontaine', 'e2e-lot2-prj-sig', 'demo-p-fontaine', 'SIGNATURE', 120000, 1)`);
    const { ctx, page } = await session();
    await login(page, "anne.chevalier@demo.kolbase.local");
    const url = `${BASE}/organisations/demo-org-academie/dossiers/e2e-lot2-prj-sig?onglet=documents`;
    const card = (name) => page.locator(`#conventions li:has-text("${name}")`);
    for (const name of ["Mathieu Roux", "Isabelle Fontaine"]) {
      await page.goto(url);
      await card(name).locator('button:has-text("Envoyer en signature électronique")').click();
      await card(name).locator('.pill:has-text("En cours de signature")').waitFor({ timeout: 20000 }).catch(() => {});
    }
    const reqOf = (link) => [...signatureRequests.values()].filter((r) => r.body.external_id === link).at(-1);
    check("Signature électronique : deux demandes en cours", reqOf("e2e-lot2-sig-roux")?.status === "ongoing" && reqOf("e2e-lot2-sig-fontaine")?.status === "ongoing");
    // Dépôt à la main de la convention signée de Dr Roux : sa demande est annulée chez Yousign.
    await page.goto(url.replace("onglet=experts", "onglet=documents"));
    const upload = 'form:has(input[name="file"])';
    await page.selectOption(`${upload} select[name="kind"]`, "CONVENTION_SIGNEE");
    await page.selectOption(`${upload} select[name="linkId"]`, "e2e-lot2-sig-roux");
    await page.setInputFiles(`${upload} input[name="file"]`, { name: "convention-roux-lot2-signee.pdf", mimeType: "application/pdf", buffer: pdf });
    await page.click(`${upload} button:has-text("Déposer")`);
    await page.waitForTimeout(1500);
    await page.goto(url);
    const roux = reqOf("e2e-lot2-sig-roux");
    const rouxDb = await q1(`select status, note from "ConventionSignature" where "projectExpertId" = 'e2e-lot2-sig-roux'`);
    check("Convention déposée signée : demande annulée chez Yousign (raison et note)", roux?.status === "canceled" && roux?.cancelation?.reason === "other" && /convention signée déposée/.test(roux?.cancelation?.custom_note ?? "") && rouxDb.status === "canceled", JSON.stringify({ yousign: roux?.status, db: rouxDb }));
    const rc = await card("Mathieu Roux").innerText();
    check("Organisation : demande close affichée, plus de nouvel envoi proposé", rc.includes("Demande annulée : convention signée déposée dans KolBase") && !rc.includes("Envoyer de nouveau en signature électronique"), rc.replace(/\s+/g, " ").slice(0, 300));
    const ex = await session();
    await login(ex.page, "mathieu.roux@demo.kolbase.local");
    await ex.page.goto(`${BASE}/sollicitations/e2e-lot2-sig-roux`);
    let et = await text(ex.page);
    await ex.page.goto(`${BASE}/sollicitations/e2e-lot2-sig-roux?onglet=documents`);
    check("Expert : plus « en attente de votre signature », « Convention signée (PDF) »", !et.includes("Convention en attente de votre signature") && !(await text(ex.page)).includes("Convention en attente de votre signature") && (await ex.page.locator('a:has-text("Convention signée (PDF)")').count()) >= 1 && et.includes("Convention signée déposée : l'organisation confirme la signature du dossier"));
    await ex.ctx.close();
    // Convention de Dr Fontaine déposée sans clore la demande (cas antérieur), puis dossier passé « Signé » : demande close.
    await pgc.query(`insert into "Document" (id, "projectId", "projectExpertId", kind, name, "contentType", size, "storageKey") values ('e2e-lot2-doc-fontaine', 'e2e-lot2-prj-sig', 'e2e-lot2-sig-fontaine', 'CONVENTION_SIGNEE', 'convention-fontaine-signee.pdf', 'application/pdf', ${pdf.length}, 'dossiers/e2e-lot2-prj-sig/fontaine.pdf')`);
    await page.goto(url.split("?")[0]);
    await page.click('button:has-text("Convention signée")');
    await page.waitForTimeout(1500);
    const fo = reqOf("e2e-lot2-sig-fontaine");
    const foDb = await q1(`select s.status sig, p.status prj from "ConventionSignature" s join "ProjectExpert" e on e.id = s."projectExpertId" join "Project" p on p.id = e."projectId" where s."projectExpertId" = 'e2e-lot2-sig-fontaine'`);
    check("Dossier passé « Signé » : la demande encore en cours est annulée", fo?.status === "canceled" && foDb.sig === "canceled" && foDb.prj === "SIGNE", JSON.stringify({ yousign: fo?.status, db: foDb }));
    const fs = await session();
    await login(fs.page, "isabelle.fontaine@demo.kolbase.local");
    await fs.page.goto(`${BASE}/sollicitations/e2e-lot2-sig-fontaine?onglet=documents`);
    et = await text(fs.page);
    check("Expert (dossier signé) : pas de demande en attente, convention signée (PDF)", !et.includes("Convention en attente de votre signature") && (await fs.page.locator('a[href="/documents/e2e-lot2-doc-fontaine"]').count()) >= 1);
    await fs.ctx.close();
    await ctx.close();
  }

  // 7. Suppression et export du compte : coordonnées de facturation et liens d'intérêts.
  {
    const pe = await session();
    await login(pe.page, "camille.petit@demo.kolbase.local");
    const exp = await (await pe.page.request.get(`${BASE}/compte/export`)).json().catch(() => null);
    const pr = exp?.compte?.practitioner;
    check("Export du compte : liens d'intérêts déclarés et notes d'honoraires", (pr?.declaredInterests ?? []).some((d) => d.organization === "Laboratoire Alpha Ortho (fictif)") && (pr?.feeNotes ?? []).some((n) => /^NH-/.test(n.number) && n.organization?.name), JSON.stringify({ interests: pr?.declaredInterests?.length, notes: pr?.feeNotes?.length }));
    await pe.ctx.close();
    await pgc.query(`update "PractitionerProfile" set iban = 'FR7630006000011234567890189', "billingAddress" = '3 rue du Test, 69001 Lyon', siret = '73282932000074', "vatRegime" = 'assujetti', "vatNumber" = 'FR40303265045', rpps = coalesce(rpps, '19900000027') where id = 'demo-p-laurent'`);
    await pgc.query(`insert into "DeclaredInterest" (id, "practitionerId", organization, nature, "startYear") values ('e2e-lot2-di-laurent', 'demo-p-laurent', 'Laboratoire Gamma (fictif)', 'Consultant', 2024)`);
    await pgc.query(`insert into "Project" (id, "organizationId", title, "typeId", status, "updatedAt") values ('e2e-lot2-prj-laurent', 'demo-org-orthonova', 'Conférence signée lot 2', 'pleniere', 'SIGNE', now())`);
    await pgc.query(`insert into "ProjectExpert" (id, "projectId", "practitionerId", status, "feeCents", days) values ('e2e-lot2-pl-1', 'e2e-lot2-prj-laurent', 'demo-p-laurent', 'SIGNE', 100000, 1)`);
    const del = 'form:has(button:has-text("Supprimer définitivement"))';
    const pl = await session();
    await login(pl.page, "paul.laurent@demo.kolbase.local");
    await pl.page.goto(`${BASE}/compte`);
    await pl.page.click('summary:has-text("Supprimer mon compte")');
    const announced = await text(pl.page);
    check("Écran de suppression : facturation et liens d'intérêts effacés annoncés", announced.includes("coordonnées de facturation (IBAN, adresse, SIRET, TVA), liens d'intérêts déclarés") && announced.includes("restent attachés à vos 1 convention(s)"));
    await pl.page.fill(`${del} input[name="password"]`, PW);
    await pl.page.check(`${del} input[name="confirm"]`);
    await Promise.all([pl.page.waitForURL(/compte=supprime/), pl.page.click(`${del} button`)]);
    await pl.ctx.close();
    const after = await q1(`select p.iban, p."billingAddress", p.siret, p."vatNumber", p.rpps, u."firstName", (select count(*)::int from "DeclaredInterest" d where d."practitionerId" = p.id) interests from "PractitionerProfile" p join "User" u on u.id = p."userId" where p.id = 'demo-p-laurent'`);
    check("Suppression : IBAN, adresse, SIRET, TVA et liens déclarés effacés ; nom et RPPS gardés pour la convention", after.iban === null && after.billingAddress === null && after.siret === null && after.vatNumber === null && after.interests === 0 && after.firstName === "Paul" && !!after.rpps, JSON.stringify(after));
  }

  // 6. Une seule structure de facturation (conventions et notes d'honoraires), un seul formulaire ; 30 jours partout.
  {
    await pgc.query(`insert into "Project" (id, "organizationId", title, "typeId", status, "updatedAt") values ('e2e-lot2-prj-durand', 'demo-org-orthonova', 'Comité lot 2 signé', 'advisory', 'SIGNE', now())`);
    await pgc.query(`insert into "ProjectExpert" (id, "projectId", "practitionerId", status, "feeCents", days) values ('e2e-lot2-pd-1', 'e2e-lot2-prj-durand', 'demo-p-durand', 'SIGNE', 180000, 1)`);
    const mo = await session();
    await login(mo.page, "vincent.moreau@demo.kolbase.local");
    await mo.page.goto(`${BASE}/tableau-de-bord`);
    const task = mo.page.locator('a:has-text("Compléter vos coordonnées de facturation")');
    const noAddress = !(await q1(`select "billingAddress" from "PractitionerProfile" where id = 'demo-p-moreau'`)).billingAddress;
    check("Accueil : tâche « Compléter vos coordonnées de facturation » vers Mes revenus", noAddress && (await task.count()) === 1 && (await task.first().getAttribute("href")) === "/revenus?onglet=facturation#coordonnees" && !(await text(mo.page)).includes("Déclarer votre structure de facturation"));
    await mo.ctx.close();
    const d = await session();
    await login(d.page, "helene.durand@demo.kolbase.local");
    await d.page.goto(`${BASE}/revenus?onglet=facturation`);
    const bill = 'form:has(textarea[name="billingAddress"])';
    check("Coordonnées de facturation : la structure de facturation déclarée y est reprise", (await d.page.inputValue(`${bill} input[name="billingEntity"]`)) === "SELARL Dr Durand" && (await d.page.inputValue(`${bill} select[name="billingLegalForm"]`)) === "SELARL");
    await d.page.fill(`${bill} input[name="billingEntity"]`, "Durand Implantologie");
    await d.page.selectOption(`${bill} select[name="billingLegalForm"]`, "SELAS");
    await d.page.fill(`${bill} textarea[name="billingAddress"]`, "8 quai Claude Bernard\n69007 Lyon");
    await d.page.fill(`${bill} input[name="siret"]`, "73282932000074");
    await d.page.click(`${bill} button:has-text("Enregistrer")`);
    await d.page.waitForTimeout(1200);
    const payees = (await pgc.query(`select name, "legalForm", siren from "PractitionerStructure" where "practitionerId" = 'demo-p-durand' and "isPayee"`)).rows;
    check("Un seul formulaire : la structure de facturation est mise à jour (une seule, SIREN repris du SIRET)", payees.length === 1 && payees[0].name === "Durand Implantologie" && payees[0].legalForm === "SELAS" && payees[0].siren === "732829320", JSON.stringify(payees));
    await d.page.goto(`${BASE}/compte`);
    const structs = await d.page.locator('section.card:has(h2:has-text("Structures juridiques"))').innerText();
    check("Structures juridiques : plus de case « structure de facturation », lien vers les coordonnées", (await d.page.locator('input[name="isPayee"]').count()) === 0 && structs.includes("Durand Implantologie") && structs.includes("structure de facturation") && (await d.page.locator('a[href="/revenus?onglet=facturation#coordonnees"]').count()) >= 1);
    await d.page.goto(`${BASE}/tableau-de-bord`);
    check("Accueil : plus de tâche de facturation une fois les coordonnées complètes", (await d.page.locator('a:has-text("Compléter vos coordonnées de facturation")').count()) === 0);
    await d.page.goto(`${BASE}/revenus?onglet=facturation`);
    await d.page.locator('li:has-text("Comité lot 2 signé") button:has-text("Établir la note")').click();
    await d.page.waitForTimeout(1500);
    const note = await q1(`select data from "FeeNote" where "projectExpertId" = 'e2e-lot2-pd-1'`);
    check("Note d'honoraires : même structure de facturation que la convention", note?.data?.issuer?.entity === "Durand Implantologie (SELAS)" && note?.data?.issuer?.siret === "73282932000074", JSON.stringify(note?.data?.issuer));
    const conv = await d.page.request.get(`${BASE}/sollicitations/e2e-lot2-pd-1/convention`);
    check("Convention : disponible avec la structure de facturation", conv.status() === 200);
    await d.ctx.close();
  }

  // 8. Professions non éligibles (pas de référencement, ni Revenus, Publications, Structures) et praticiens hors de France.
  {
    await pgc.query(`insert into "User" (id, email, "firstName", "lastName", "passwordHash", "emailVerifiedAt", "updatedAt") select 'e2e-lot2-u-asst', 'lot2.assistante@exemple.fr', 'Lou', 'Assistante', "passwordHash", now(), now() from "User" where id = 'demo-u-durand'`);
    await pgc.query(`insert into "PractitionerProfile" (id, "userId", profession, city, country, "updatedAt") values ('e2e-lot2-p-asst', 'e2e-lot2-u-asst', 'Assistant(e) dentaire', 'Lyon', 'FR', now())`);
    await pgc.query(`insert into "User" (id, email, "firstName", "lastName", "passwordHash", "emailVerifiedAt", "updatedAt") select 'e2e-lot2-u-us', 'lot2.boston@exemple.fr', 'Ana', 'Boston', "passwordHash", now(), now() from "User" where id = 'demo-u-durand'`);
    await pgc.query(`insert into "PractitionerProfile" (id, "userId", profession, city, country, "updatedAt") values ('e2e-lot2-p-us', 'e2e-lot2-u-us', 'Chirurgien-dentiste', 'Boston, MA', 'US', now())`);
    const a = await session();
    await login(a.page, "lot2.assistante@exemple.fr");
    await a.page.goto(`${BASE}/tableau-de-bord`);
    const dash = await text(a.page);
    const nav = await a.page.locator("body").innerText();
    check("Profession non éligible : pas de « Me référencer » ni d'entrée Revenus", !dash.includes("Devenir expert référencé") && (await a.page.locator('a[href="/compte"]:has-text("Me référencer")').count()) === 0 && (await a.page.locator('a[href="/revenus"]').count()) === 0 && !dash.includes("Référencez-vous comme expert"), nav.slice(0, 200));
    await a.page.goto(`${BASE}/compte`);
    const acc = await text(a.page);
    check("Profession non éligible : ni Publications ni Structures juridiques dans Mon compte", !/Publications \(\d+\)/.test(acc) && !/Structures juridiques \(\d+\)/.test(acc) && acc.includes("réservé aux chirurgiens-dentistes"));
    await a.ctx.close();
    await pgc.query(`update "PractitionerProfile" set "licenseNumber" = null where id = 'demo-p-janssens'`);
    const be = await session();
    await login(be.page, "sophie.janssens@demo.kolbase.local");
    await be.page.goto(`${BASE}/tableau-de-bord`);
    const bed = await text(be.page);
    check("Hors de France (Belgique) : identifiant du pays demandé, pas le RPPS", bed.includes("Renseigner votre numéro INAMI") && !bed.includes("RPPS"));
    await be.ctx.close();
    const us = await session();
    await login(us.page, "lot2.boston@exemple.fr");
    await us.page.goto(`${BASE}/compte`);
    const usc = await text(us.page);
    check("Hors de France (États-Unis) : prérequis du référencement = NPI, pas de RPPS", usc.includes("Prérequis : renseignez votre NPI") && !usc.includes("numéro RPPS") && (await us.page.locator('input[name="rpps"]').count()) === 0 && (await us.page.locator('input[name="licenseNumber"]').count()) === 1);
    await us.ctx.close();
  }

  {
    // Webinaire sans pointage : tous les inscrits peuvent donner leur avis (personne n'y est « absent »).
    const was = (await pgc.query(`SELECT "startsAt" FROM "Event" WHERE id = 'demo-ev-webinaire-aligneurs'`)).rows[0].startsAt;
    await pgc.query(`UPDATE "Event" SET "startsAt" = now() - interval '1 day' WHERE id = 'demo-ev-webinaire-aligneurs'`);
    const w = await session();
    await login(w.page, "sarah.mercier@demo.kolbase.local");
    await w.page.goto(`${BASE}/evenements/demo-ev-webinaire-aligneurs/avis`);
    check("Webinaire sans pointage : questionnaire ouvert aux inscrits", (await w.page.locator("form.survey-form").count()) === 1, await text(w.page));
    await w.page.goto(`${BASE}/evenements/demo-ev-webinaire-aligneurs`);
    check("Webinaire sans pointage : « Donner mon avis » sur la fiche", (await text(w.page)).includes("Donner mon avis"));
    await w.ctx.close();
    await pgc.query(`UPDATE "Event" SET "startsAt" = $1 WHERE id = 'demo-ev-webinaire-aligneurs'`, [was]);
  }

  await pgc.end();
}

// ── Lot 3 : agences, services de visibilité, administration ────────────────
{
  const pgc = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await pgc.connect();
  const q1 = async (sql, args = []) => (await pgc.query(sql, args)).rows[0];
  /** Attend qu'une condition (souvent un état en base) soit vraie, au lieu d'un délai fixe. */
  const until = async (fn, ms = 6000) => {
    for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 150))) if (await fn()) return true;
    return false;
  };
  // Sessions partagées par les vérifications du lot : équipe KolBase, visiteur, organisateur.
  const adm = await session();
  await login(adm.page, "anne.chevalier@demo.kolbase.local");
  const anon = await session();
  const jul = await session();
  await login(jul.page, "julien.faure@demo.kolbase.local");
  /** Geste irréversible en deux temps : le bouton, puis « Confirmer : … ». */
  const confirmClick = async (scope, label) => {
    await scope.locator(`button:has-text("${label}")`).first().click();
    const ok = scope.locator('button:has-text("Confirmer")').first();
    await ok.waitFor({ timeout: 3000 });
    await ok.click();
  };

  // 1. Agence mandatée dans le circuit des devis : prévenue, tâches, droit de retenir, ce qu'elle ne voit pas.
  {
    // Mandat actif de Dentalys pour l'Agence Médiane (sans droit de retenir), « Live surgery » confié.
    await pgc.query(`insert into "Mandate" (id, "mandatorId", "agencyId", scope) select 'e2e-l3-mandat', 'demo-org-dentalys', 'demo-org-mediane', 'Événements confiés'
      where not exists (select 1 from "Mandate" where "mandatorId" = 'demo-org-dentalys' and "agencyId" = 'demo-org-mediane' and ("endsAt" is null or "endsAt" > now()))`);
    await pgc.query(`update "Mandate" set "canAward" = false where "mandatorId" = 'demo-org-dentalys' and "agencyId" = 'demo-org-mediane'`);
    await pgc.query(`update "Event" set "agencyId" = 'demo-org-mediane' where id = 'demo-ev-live-surgery'`);
    // Demande créée par l'agence (Karim) : deux traiteurs consultés, deux devis reçus.
    await pgc.query(`insert into "Rfq" (id, "organizationId", "eventId", category, needs, status, "sentAt", "createdById", headcount)
      select 'e2e-l3-rfq', 'demo-org-dentalys', 'demo-ev-live-surgery', 'restauration', 'Déjeuner opératoire des participants de la chirurgie en direct, 80 couverts.', 'sent', now(), id, 80 from "User" where email = 'karim.benali@demo.kolbase.local'`);
    await pgc.query(`insert into "RfqSupplier" ("rfqId", "supplierId") values ('e2e-l3-rfq', 'demo-sup-belleville'), ('e2e-l3-rfq', 'demo-sup-tablesdusud')`);
    await pgc.query(`insert into "Quote" (id, "rfqId", "supplierId", "amountCents", "vatBp", "updatedAt") values ('e2e-l3-q1', 'e2e-l3-rfq', 'demo-sup-belleville', 240000, 1000, now()), ('e2e-l3-q2', 'e2e-l3-rfq', 'demo-sup-tablesdusud', 280000, 1000, now())`);

    // Question du traiteur : l'agence qui a créé la demande est prévenue (appartenance par le mandat).
    const sup = await session();
    await login(sup.page, "ludovic.perrin@demo.kolbase.local");
    await sup.page.goto(`${BASE}/organisations/demo-sup-belleville/devis/e2e-l3-rfq`);
    const card = sup.page.locator("main");
    await card.locator('textarea[name="body"]').first().fill("Faut-il prévoir des plateaux-repas en salle ?");
    await card.locator('button:has-text("Envoyer")').first().click();
    check("Agence : question d'un prestataire envoyée à l'agence qui a créé la demande", !!(await waitMail("karim.benali@demo.kolbase.local", "Question de Traiteur Belleville")));
    await sup.ctx.close();

    const ag = await session();
    await login(ag.page, "karim.benali@demo.kolbase.local");
    await ag.page.goto(`${BASE}/organisations/demo-org-mediane`);
    let at = await text(ag.page);
    check("Accueil de l'agence : devis et questions des événements confiés", at.includes("Devis à comparer : Live surgery") && at.includes("Question de Traiteur Belleville"), at.slice(0, 400));
    await ag.page.goto(`${BASE}/organisations/demo-org-dentalys`);
    at = await text(ag.page);
    check("Espace du client (agence) : tâches de devis et de questions", at.includes("Devis à comparer : Live surgery") && at.includes("Question de Traiteur Belleville"), at.slice(0, 400));
    await ag.page.goto(`${BASE}/organisations/demo-org-dentalys/prestataires/e2e-l3-rfq`);
    const mine = ag.page.locator("section#rfq-e2e-l3-rfq");
    check("Agence sans droit de retenir : « Proposer à l'organisation », pas « Retenir »", (await mine.locator('button:has-text("Proposer à l")').count()) === 2 && (await mine.locator('button:has-text("Retenir")').count()) === 0);
    await ag.page.goto(`${BASE}/organisations/demo-org-dentalys/prestataires/demo-rfq-captation`);
    const capt = ag.page.locator("section#rfq-demo-rfq-captation");
    check("Agence consultée sur son événement : « À retenir par l'organisation (conflit d'intérêts) »", (await capt.innerText()).includes("À retenir par l'organisation (conflit d'intérêts)"));
    await ag.page.goto(`${BASE}/organisations/demo-org-dentalys/prestataires?onglet=nouvelle`);
    await ag.page.locator('button.chip:has-text("Audiovisuel et captation")').click();
    check("Nouvelle demande : l'agence ne peut pas se consulter elle-même", !(await text(ag.page)).includes("Agence Médiane Événements"));
    // Ni l'abonnement, ni la gestion de la fiche, ni « Voir notre page publique » du client.
    await ag.page.goto(`${BASE}/organisations/demo-org-dentalys/abonnement`);
    check("Agence : pas d'accès à l'abonnement du client", !ag.page.url().includes("/abonnement"), ag.page.url());
    await ag.page.click(".session-chip");
    check("Agence : pas de « Voir notre page publique » pour le client", !(await ag.page.locator(".account-menu").innerText()).includes("Voir notre page publique"));
    await ag.page.goto(`${BASE}/structures/demo-org-dentalys`);
    check("Agence : pas de « Gérer l'organisation » sur la fiche publique du client", (await ag.page.locator('a:has-text("Gérer l\'organisation")').count()) === 0);
    // L'agence propose : les organisateurs décident.
    await ag.page.goto(`${BASE}/organisations/demo-org-dentalys/prestataires/e2e-l3-rfq`);
    await mine.locator('.quote:has-text("Traiteur Belleville") button:has-text("Proposer à l")').click();
    await until(async () => (await q1(`select "proposedQuoteId" from "Rfq" where id = 'e2e-l3-rfq'`))?.proposedQuoteId === "e2e-l3-q1");
    await mine.locator(':text("Proposé à l\'organisation, qui retient")').waitFor({ timeout: 4000 }).catch(() => {});
    check("Agence : devis proposé à l'organisation", (await mine.innerText()).includes("Proposé à l'organisation, qui retient"));
    check("E-mail aux organisateurs : devis proposé par l'agence", !!(await waitMail("claire.morel@demo.kolbase.local", "Devis à retenir : Agence Médiane Événements propose Traiteur Belleville")));

    const org = await session();
    await login(org.page, "claire.morel@demo.kolbase.local");
    await org.page.goto(`${BASE}/organisations/demo-org-dentalys`);
    check("Accueil de l'organisation : devis proposé par l'agence à retenir", (await text(org.page)).includes("Devis à retenir : Live surgery"));
    await org.page.goto(`${BASE}/organisations/demo-org-dentalys/prestataires/e2e-l3-rfq`);
    const oc = await org.page.locator("section#rfq-e2e-l3-rfq").innerText();
    check("Carte de demande : « Créée par … (agence) » et devis proposé", oc.includes("Créée par Karim Benali (Agence Médiane Événements, agence mandatée)") && oc.includes("Proposé par l'agence mandatée"), oc.slice(0, 400));
    await org.page.goto(`${BASE}/organisations/demo-org-dentalys/prestataires/demo-rfq-captation`);
    check("Carte de demande : l'agence mandatée signalée parmi les prestataires consultés", (await org.page.locator("section#rfq-demo-rfq-captation").innerText()).includes("Agence mandatée sur cet événement"));
    // Droit de retenir accordé : l'agence retient, les organisateurs sont prévenus.
    await org.page.goto(`${BASE}/organisations/demo-org-dentalys/prestataires?onglet=agences`);
    await org.page.locator('section.card:has-text("Agence Médiane") button:has-text("Autoriser à retenir les devis")').click();
    await until(async () => (await q1(`select "canAward" from "Mandate" where "mandatorId" = 'demo-org-dentalys' and "agencyId" = 'demo-org-mediane' and ("endsAt" is null or "endsAt" > now())`))?.canAward === true);
    check("Mandat : droit de retenir les devis accordé", (await q1(`select "canAward" from "Mandate" where "mandatorId" = 'demo-org-dentalys' and "agencyId" = 'demo-org-mediane' and ("endsAt" is null or "endsAt" > now())`))?.canAward === true);
    await ag.page.reload();
    await confirmClick(mine.locator('.quote:has-text("Les Tables du Sud")'), "Retenir");
    await until(async () => (await q1(`select status from "Quote" where id = 'e2e-l3-q2'`))?.status === "retained");
    check("Agence avec droit : devis retenu", (await q1(`select status from "Quote" where id = 'e2e-l3-q2'`))?.status === "retained");
    const won = await waitMail("claire.morel@demo.kolbase.local", "Agence Médiane Événements a retenu un devis");
    check("E-mail aux organisateurs : devis retenu par l'agence (montants HT et TTC)", !!won && won.text.includes("devis des Tables du Sud") && /2\s800\s€ HT \(3\s080\s€ TTC\)/.test(won.text), won?.text);
    // Événement repris, puis fin du mandat : l'agence est prévenue.
    await org.page.goto(`${BASE}/organisations/demo-org-dentalys/evenements/demo-ev-live-surgery`);
    await org.page.selectOption('select[name="agencyId"]', "");
    await org.page.click('form:has(select[name="agencyId"]) button');
    check("E-mail à l'agence : événement repris par l'organisation", !!(await waitMail("karim.benali@demo.kolbase.local", /Live surgery.*n'est plus confié à votre agence/)));
    await org.page.goto(`${BASE}/organisations/demo-org-dentalys/prestataires?onglet=agences`);
    await org.page.locator('section.card:has-text("Agence Médiane") button:has-text("Mettre fin au mandat")').click();
    check("E-mail à l'agence : fin du mandat", !!(await waitMail("karim.benali@demo.kolbase.local", "Fin du mandat de Dentalys Implants")));
    await org.ctx.close();
    await ag.ctx.close();
  }

  // 6 et 7. Actualités : « Enregistrer et publier » publie ce qui est à l'écran ; suppression confirmée.
  {
    await adm.page.goto(`${BASE}/admin/actualites/nouveau`);
    await adm.page.fill('input[name="title"]', "Lot trois : brouillon");
    await adm.page.fill('textarea[name="excerpt"]', "Une actualité de test pour la publication depuis le formulaire.");
    await adm.page.fill('textarea[name="body"]', "Premier jet.");
    await Promise.all([adm.page.waitForURL(/\/admin\/actualites\/[^/?]+\?cree=1/), adm.page.click('button:has-text("Créer le brouillon")')]);
    const artId = adm.page.url().split("/").at(-1).split("?")[0];
    // Modifié à l'écran sans enregistrer, puis publié : c'est le texte à l'écran qui part en ligne.
    await adm.page.fill('input[name="title"]', "Lot trois : version publiée");
    await adm.page.fill('input[name="slug"]', "lot-trois-version-publiee");
    await adm.page.fill('textarea[name="body"]', "Texte relu, publié tel quel.");
    await adm.page.click('button:has-text("Enregistrer et publier")');
    await until(async () => !!(await q1(`select "publishedAt" from "Article" where id = $1`, [artId]))?.publishedAt);
    const pub = await anon.page.goto(`${BASE}/actualites/lot-trois-version-publiee`);
    const pt = await text(anon.page);
    check("Actualité : « Enregistrer et publier » publie le texte à l'écran", pub?.status() === 200 && pt.includes("Lot trois : version publiée") && pt.includes("Texte relu, publié tel quel."), pt.slice(0, 200));
    await adm.page.goto(`${BASE}/admin/actualites/${artId}`);
    await adm.page.click('button:has-text("Supprimer")');
    check("Suppression d'une actualité : confirmation d'abord", (await adm.page.locator('button:has-text("Confirmer : supprimer définitivement")').count()) === 1 && !!(await q1(`select id from "Article" where id = $1`, [artId])));
    await Promise.all([adm.page.waitForURL(/\/admin\/actualites$/), adm.page.click('button:has-text("Confirmer : supprimer définitivement")')]);
    check("Suppression d'une actualité : confirmée", !(await q1(`select id from "Article" where id = $1`, [artId])));
  }

  // 4. Suspension réversible : statut distinct, motif, confirmation, e-mail ; tout est masqué puis rendu.
  {
    const before = await q1(`select listed, (select count(*)::int from "OpenCall" where "organizationId" = 'demo-org-cdra' and status = 'open') calls from "Organization" where id = 'demo-org-cdra'`);
    await adm.page.goto(`${BASE}/admin/organisations/demo-org-cdra`);
    const card = () => adm.page.locator('section.card:has-text("Collège Dentaire Rhône-Alpes")').first();
    await card().locator('form:has(button:has-text("Suspendre")) input[name="note"]').fill("Contrôle de conformité en cours");
    await card().locator('button:has-text("Suspendre")').click();
    check("Suspension : confirmation avec ce qui est masqué", (await card().locator(".confirm-step").innerText()).includes("rien n'est supprimé"));
    await card().locator('button:has-text("Confirmer : suspendre")').click();
    await until(async () => (await q1(`select verification from "Organization" where id = 'demo-org-cdra'`)).verification === "SUSPENDED");
    const sus = await q1(`select verification, listed, (select count(*)::int from "OpenCall" where "organizationId" = 'demo-org-cdra' and status = 'open') calls from "Organization" where id = 'demo-org-cdra'`);
    check("Suspension : statut « suspendue », rien de détruit (page publique et appels conservés)", sus.verification === "SUSPENDED" && sus.listed === before.listed && sus.calls === before.calls, JSON.stringify(sus));
    const mail = await waitMail("pierre.vidal@demo.kolbase.local", "Collège Dentaire Rhône-Alpes est suspendue sur KolBase");
    check("E-mail : suspension avec motif, rien n'est supprimé", !!mail && mail.text.includes("Motif : Contrôle de conformité en cours") && mail.text.includes("Rien n'est supprimé"));
    check("Organisation suspendue : page publique masquée", (await anon.page.goto(`${BASE}/structures/demo-org-cdra`))?.status() === 404);
    check("Organisation suspendue : événements masqués", (await anon.page.goto(`${BASE}/evenements/demo-ev-journee-cdra`))?.status() === 404);
    const own = await session();
    await login(own.page, "pierre.vidal@demo.kolbase.local");
    await own.page.goto(`${BASE}/organisations/demo-org-cdra`);
    check("Organisation : « Organisation suspendue : motif »", (await text(own.page)).includes("Organisation suspendue : Contrôle de conformité en cours"));
    await own.page.goto(`${BASE}/organisations/demo-org-cdra/membres?onglet=organisation`);
    check("Organisation suspendue : pas de nouvelle demande de validation", (await own.page.locator('input[name="siren"]').count()) === 0 && (await text(own.page)).includes("Suspendue par KolBase"));
    // Réactiver : tout réapparaît tel quel.
    await adm.page.goto(`${BASE}/admin/organisations/demo-org-cdra`);
    await card().locator('button:has-text("Réactiver")').click();
    await until(async () => (await q1(`select verification from "Organization" where id = 'demo-org-cdra'`)).verification === "VERIFIED");
    check("Réactivation : organisation validée", (await q1(`select verification from "Organization" where id = 'demo-org-cdra'`)).verification === "VERIFIED");
    check("Réactivation : page publique et événements rendus", (await anon.page.goto(`${BASE}/structures/demo-org-cdra`))?.status() === 200 && (await anon.page.goto(`${BASE}/evenements/demo-ev-journee-cdra`))?.status() === 200);
    check("E-mail : réactivation", !!(await waitMail("pierre.vidal@demo.kolbase.local", "Collège Dentaire Rhône-Alpes est de nouveau active")));
    await own.ctx.close();
  }

  // 2. Lettre d'information tenue : praticiens confirmés seulement, deux envois par mois, historique, test, élision.
  {
    // Les envois déjà faits par le parcours sont reportés au mois précédent : le compteur du mois repart de zéro.
    await pgc.query(`update "NewsletterCampaign" set "sentAt" = "sentAt" - interval '40 days', "createdAt" = "createdAt" - interval '40 days'`);
    // Une administratrice d'organisation (sans profil praticien) abonnée : elle ne reçoit pas la lettre.
    await pgc.query(`update "User" set "notifyPrefs" = "notifyPrefs" || '{"newsletter": true}' where email = 'claire.morel@demo.kolbase.local'`);
    // Deuxième onglet de l'administratrice, ouvert avant les envois (compteur périmé).
    const stale = { page: await adm.ctx.newPage() };
    await stale.page.goto(`${BASE}/admin/services/lettre`);
    await adm.page.goto(`${BASE}/admin/services/lettre`);
    const lt = await text(adm.page);
    check("Lettre libre : audience des praticiens et compteur du mois", /Envoyé à \d+ praticiens? \(compte praticien/.test(lt) && lt.includes("Envois en ") && lt.includes(": 0 sur 2"), lt.slice(0, 300));
    await adm.page.fill('input[name="subject"]', "Lot trois : lettre de novembre");
    await adm.page.fill('textarea[name="body"]', "Les nouveautés du mois sur KolBase, pour les praticiens abonnés.");
    check("Lettre libre : aperçu de l'e-mail", (await adm.page.locator(".mail-preview").innerText()).includes("Les nouveautés du mois sur KolBase"));
    await adm.page.click('button:has-text("M\'envoyer un test")');
    check("Lettre libre : envoi de test à l'administrateur seul", !!(await waitMail("anne.chevalier@demo.kolbase.local", "[Test] Lot trois : lettre de novembre")) && !mails.some((m) => m.subject === "Lot trois : lettre de novembre"));
    check("Envoi de test : ni enregistré ni compté", !(await q1(`select id from "NewsletterCampaign" where subject = 'Lot trois : lettre de novembre'`)));
    // Double clic sur la confirmation : un seul envoi.
    await adm.page.click('button:has-text("Envoyer à")');
    await adm.page.locator('button:has-text("Confirmer : envoyer à")').dblclick();
    await until(async () => !!(await q1(`select "sentAt" from "NewsletterCampaign" where subject = 'Lot trois : lettre de novembre'`))?.sentAt);
    await adm.page.waitForTimeout(300);
    check("Lettre libre : envoyée une seule fois malgré le double clic", (await q1(`select count(*)::int n from "NewsletterCampaign" where subject = 'Lot trois : lettre de novembre'`)).n === 1);
    const reader = (await q1(`select u.email from "User" u join "PractitionerProfile" p on p."userId" = u.id where u."notifyPrefs"->>'newsletter' = 'true' and u."emailVerifiedAt" is not null limit 1`))?.email;
    check("Lettre : praticiens confirmés seulement (pas un membre d'organisation)", !!reader && !!(await waitMail(reader, "Lot trois : lettre de novembre")) && !mails.some((m) => m.to === "claire.morel@demo.kolbase.local" && m.subject === "Lot trois : lettre de novembre"), reader);
    // Deuxième envoi du mois, puis le troisième (page ouverte avant) est refusé.
    await adm.page.goto(`${BASE}/admin/services/lettre`);
    await adm.page.fill('input[name="subject"]', "Lot trois : seconde lettre");
    await adm.page.fill('textarea[name="body"]', "Deuxième et dernier envoi possible ce mois-ci.");
    await adm.page.click('button:has-text("Envoyer à")');
    await adm.page.click('button:has-text("Confirmer : envoyer à")');
    await until(async () => !!(await q1(`select "sentAt" from "NewsletterCampaign" where subject = 'Lot trois : seconde lettre'`))?.sentAt);
    await stale.page.fill('input[name="subject"]', "Lot trois : troisième lettre");
    await stale.page.fill('textarea[name="body"]', "Cet envoi dépasse le plafond du mois et doit être refusé.");
    await stale.page.click('button:has-text("Envoyer à")');
    await stale.page.click('button:has-text("Confirmer : envoyer à")');
    await stale.page.locator(':text("Plafond atteint : 2 envois")').waitFor({ timeout: 5000 }).catch(() => {});
    check("Plafond : troisième envoi du mois refusé avec un message", (await text(stale.page)).includes("Plafond atteint : 2 envois") && !(await q1(`select id from "NewsletterCampaign" where subject = 'Lot trois : troisième lettre'`)));
    await adm.page.goto(`${BASE}/admin/services/lettre`);
    check("Plafond : envoi impossible depuis la page", (await text(adm.page)).includes("Plafond atteint pour") && (await adm.page.locator('button:has-text("Envoyer à")').isDisabled()));
    await adm.page.goto(`${BASE}/admin?onglet=services`);
    const hist = await adm.page.locator("section#lettre").innerText();
    check("Admin : compteur et historique des envois (objet, destinataires, commande liée)", hist.includes("2 envois sur 2") && hist.includes("Lot trois : seconde lettre") && hist.includes("Lettre libre") && hist.includes("E-mailing dédié aux membres KolBase · Dentalys Implants"), hist.slice(0, 400));
    // Élision : « Communication d'Académie Odonto Formation ».
    await pgc.query(`insert into "ServiceOrder" (id, "organizationId", "eventId", "offerId", label, "priceCents", "orderedById", status, "updatedAt")
      select 'e2e-l3-mailing', 'demo-org-academie', 'demo-ev-tp-endo', 'svc-newsletter', 'E-mailing dédié aux membres KolBase', 69000, id, 'demandee', now() from "User" where email = 'anne.chevalier@demo.kolbase.local'`);
    await adm.page.goto(`${BASE}/admin/services/e2e-l3-mailing`);
    check("E-mailing : « Communication d'Académie Odonto Formation »", (await adm.page.locator(".mail-preview").innerText()).includes("Communication d'Académie Odonto Formation, diffusée par KolBase."));
    await pgc.query(`delete from "ServiceOrder" where id = 'e2e-l3-mailing'`);
    await stale.page.close();
    await pgc.query(`update "User" set "notifyPrefs" = "notifyPrefs" || '{"newsletter": false}' where email = 'claire.morel@demo.kolbase.local'`);

    // Commande d'un e-mailing : audience affichée ; impossible quand elle est nulle.
    await jul.page.goto(`${BASE}/organisations/demo-org-dentalys/evenements/demo-ev-soiree-implanto`);
    const mailing = () => jul.page.locator('.service-list li:not(.service-pack):has-text("E-mailing dédié")');
    check("Commande d'e-mailing : audience actuelle affichée", /\d+ praticiens? abonnés? à la lettre d'information aujourd'hui/.test(await mailing().innerText()));
    const subs = (await pgc.query(`select id from "User" where "notifyPrefs"->>'newsletter' = 'true'`)).rows.map((r) => r.id);
    await pgc.query(`update "User" set "notifyPrefs" = "notifyPrefs" || '{"newsletter": false}' where id = any($1)`, [subs]);
    await jul.page.reload();
    check("Commande d'e-mailing : impossible sans abonné (message)", (await mailing().innerText()).includes("aucun praticien n'est abonné") && (await mailing().locator('button:has-text("Commander")').count()) === 0);
    await pgc.query(`update "User" set "notifyPrefs" = "notifyPrefs" || '{"newsletter": true}' where id = any($1)`, [subs]);

    // Abonné dont l'adresse n'est pas confirmée : l'envoi commencera après la confirmation, lien renvoyé.
    await pgc.query(`update "User" set "notifyPrefs" = "notifyPrefs" || '{"newsletter": true}', "emailVerifiedAt" = null where email = 'sarah.mercier@demo.kolbase.local'`);
    const pr = await session();
    await login(pr.page, "sarah.mercier@demo.kolbase.local");
    await pr.page.goto(`${BASE}/actualites`);
    check("Lettre : abonné non confirmé prévenu que l'envoi attend la confirmation", (await text(pr.page)).includes("l'envoi commencera après la confirmation de votre adresse"));
    const sentBefore = mails.filter((m) => m.to === "sarah.mercier@demo.kolbase.local" && m.subject.startsWith("Confirmez votre adresse")).length;
    await pr.page.locator('.newsletter-done button:has-text("Renvoyer le lien")').click();
    for (let i = 0; i < 40 && mails.filter((m) => m.to === "sarah.mercier@demo.kolbase.local" && m.subject.startsWith("Confirmez votre adresse")).length === sentBefore; i++) await pr.page.waitForTimeout(200);
    check("Lettre : lien de confirmation renvoyé depuis l'encart", mails.filter((m) => m.to === "sarah.mercier@demo.kolbase.local" && m.subject.startsWith("Confirmez votre adresse")).length > sentBefore);
    await pgc.query(`update "User" set "emailVerifiedAt" = now(), "notifyPrefs" = "notifyPrefs" || '{"newsletter": false}' where email = 'sarah.mercier@demo.kolbase.local'`);
    await pr.ctx.close();
  }

  // 5. Gratuité et Stripe : abonnement en cours mis en pause puis repris ; date de fin = fin de journée à Paris.
  {
    const subId = "sub_e2el3pause";
    stripeState.subscriptions.set(subId, { id: subId, object: "subscription", customer: "cus_e2el3", status: "active", trial_end: null, current_period_end: Math.floor(Date.now() / 1000) + 20 * 86400, cancel_at_period_end: false, metadata: { orgId: "demo-org-orthonova" }, pause_collection: null });
    await pgc.query(`insert into "Subscription" ("organizationId", plan, status, "stripeCustomerId", "stripeSubscriptionId", "updatedAt") values ('demo-org-orthonova', 'organisation', 'active', 'cus_e2el3', $1, now())
      on conflict ("organizationId") do update set status = 'active', "stripeCustomerId" = 'cus_e2el3', "stripeSubscriptionId" = $1, "exemptUntil" = null, "exemptNote" = null`, [subId]);
    const lastDay = new Date(Date.now() + 12 * 864e5).toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
    await adm.page.goto(`${BASE}/admin?onglet=abonnements`);
    const row = () => adm.page.locator('tr:has-text("OrthoNova")');
    await row().locator('input[name="until"]').fill(lastDay);
    await row().locator('input[name="note"]').fill("Pilote lot trois");
    await row().locator('button:has-text("offrir")').click();
    await until(async () => !!(await q1(`select "exemptUntil" from "Subscription" where "organizationId" = 'demo-org-orthonova'`))?.exemptUntil);
    await row().locator(':text("jusqu\'au")').waitFor({ timeout: 4000 }).catch(() => {});
    const ex = await q1(`select to_char(("exemptUntil" at time zone 'UTC') at time zone 'Europe/Paris', 'YYYY-MM-DD HH24:MI') d from "Subscription" where "organizationId" = 'demo-org-orthonova'`);
    check("Gratuité : fin de la journée saisie, heure de Paris", ex?.d === `${lastDay} 23:59`, ex?.d);
    const shown = new Date(`${lastDay}T12:00:00Z`).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "short", year: "numeric" });
    check("Gratuité : date affichée = date saisie (pas le lendemain)", (await row().innerText()).includes(`jusqu'au ${shown}`), await row().innerText());
    const paused = stripeState.subscriptions.get(subId).pause_collection;
    check("Gratuité : facturation Stripe en pause (void, reprise à la fin)", paused?.behavior === "void" && !!paused.resumes_at && new Date(paused.resumes_at * 1000).toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" }) === lastDay, JSON.stringify(paused));
    const offer = await waitMail("thomas.garnier@demo.kolbase.local", "KolBase vous offre l'abonnement jusqu'au");
    check("E-mail : gratuité offerte, facturation suspendue", !!offer && offer.text.includes("est suspendue pendant cette période") && offer.text.includes("inclus"));
    // Retirer : confirmation, puis la facturation reprend.
    await row().locator('button:has-text("retirer")').click();
    check("Retirer la gratuité : confirmation qui annonce la reprise de la facturation", (await row().locator(".confirm-step").innerText()).includes("la facturation de son abonnement Stripe reprend") && !!(await q1(`select "exemptUntil" from "Subscription" where "organizationId" = 'demo-org-orthonova'`))?.exemptUntil);
    await row().locator('button:has-text("Confirmer : retirer la gratuité")').click();
    // La base est mise à jour avant l'appel à Stripe : attendre les deux, sinon le test dépend de la charge de la machine.
    await until(async () => stripeState.subscriptions.get(subId).pause_collection === null && !(await q1(`select "exemptUntil" from "Subscription" where "organizationId" = 'demo-org-orthonova'`))?.exemptUntil);
    check("Gratuité retirée : facturation Stripe reprise", stripeState.subscriptions.get(subId).pause_collection === null && !(await q1(`select "exemptUntil" from "Subscription" where "organizationId" = 'demo-org-orthonova'`))?.exemptUntil);
    const back = await waitMail("thomas.garnier@demo.kolbase.local", "gratuité de l'abonnement retirée");
    check("E-mail : gratuité retirée, la facturation reprend", !!back && back.text.includes("la facturation de votre abonnement en cours reprend"));
  }

  // 3. Pack et mise à la une : regroupés côté admin, lien suivi depuis l'accueil seulement, factures annoncées justes.
  {
    await pgc.query(`insert into "ServiceOrder" (id, "organizationId", "eventId", "offerId", label, "priceCents", "orderedById", status, "packLabel", "trackCode", "createdAt", "updatedAt")
      select x.id, 'demo-org-dentalys', 'demo-ev-live-surgery', x.offer, x.label, x.price, u.id, 'demandee', 'Pack visibilité', x.code, now(), now()
      from "User" u, (values ('e2e-l3-p1', 'svc-newsletter', 'E-mailing dédié aux membres KolBase', 58477, 'l3pack1'), ('e2e-l3-p2', 'svc-reseaux', 'Publication sur les réseaux sociaux de KolBase', 24577, 'l3pack2'), ('e2e-l3-p3', 'svc-une', 'À la une de la page d''accueil (7 jours)', 15946, 'l3pack3')) as x(id, offer, label, price, code)
      where u.email = 'julien.faure@demo.kolbase.local'`);
    await adm.page.goto(`${BASE}/admin?onglet=services`);
    const grp = adm.page.locator('li.service-pack-group:has-text("Live surgery")');
    const gt = (await grp.innerText()).replace(/\s+/g, " ");
    check("Admin : services d'un pack regroupés sous son prix, détail dépliable", /Pack visibilité — 990 € HT/.test(gt) && gt.includes("Détail des 3 services du pack") && gt.includes("Publication sur les réseaux sociaux"), gt.slice(0, 200));
    check("Admin : pas de « lien à utiliser » pour la mise à la une", !(await grp.locator('li.card:has-text("À la une de la page")').innerText()).includes("Lien suivi à utiliser") && (await grp.locator('li.card:has-text("réseaux sociaux")').innerText()).includes("Lien suivi à utiliser"));
    await pgc.query(`delete from "ServiceOrder" where id in ('e2e-l3-p1', 'e2e-l3-p2', 'e2e-l3-p3')`);
    // Mise à la une réalisée (Soirée implantologie, plus haut) : lien suivi depuis l'accueil, direct depuis /evenements.
    await anon.page.goto(`${BASE}/`);
    const homeHref = await anon.page.locator('.event-card:has-text("Soirée implantologie") h3 a').getAttribute("href");
    await anon.page.goto(`${BASE}/evenements`);
    const listHref = await anon.page.locator('.event-card:has-text("Soirée implantologie") h3 a').first().getAttribute("href");
    check("Mise à la une : lien suivi depuis l'accueil seulement", homeHref?.startsWith("/r/") && listHref === "/evenements/demo-ev-soiree-implanto", `${homeHref} | ${listHref}`);
    // Filtres de l'agenda : la discipline a sa propre adresse, et le filtre reste visible et retirable.
    await anon.page.goto(`${BASE}/evenements?discipline=Endodontie&periode=90j`);
    const endo = await anon.page.locator(".event-card").allInnerTexts();
    check("Agenda : filtre par discipline et période", endo.length > 0 && endo.every((c) => c.includes("Endodontie")) && (await anon.page.locator('.chips a.chip.active:has-text("Endodontie")').count()) === 1 && (await anon.page.locator('select[name="periode"]').inputValue()) === "90j", endo.join(" | ").slice(0, 200));
    await jul.page.goto(`${BASE}/organisations/demo-org-dentalys/evenements/demo-ev-soiree-implanto`);
    check("Mise à la une : « En cours jusqu'au … » tant qu'elle dure", (await jul.page.locator('li.service-order:has-text("À la une de la page")').first().innerText()).includes("En cours jusqu'au"));
    // E-mails de réalisation : « prochaine facture » seulement si la ligne est sur la facture Stripe.
    const hors = mails.find((m) => m.to === "julien.faure@demo.kolbase.local" && m.subject.startsWith("Service KolBase : E-mailing dédié"));
    const stripeMail = mails.find((m) => m.to === "pierre.vidal@demo.kolbase.local" && m.subject.startsWith("Service KolBase : Publication sur les réseaux sociaux"));
    check("Réalisation hors Stripe : « facture à venir »", !!hors && hors.text.includes("facture à venir") && !hors.text.includes("prochaine facture"), hors?.text);
    check("Réalisation facturée par Stripe : « sur votre prochaine facture »", !!stripeMail && stripeMail.text.includes("sur votre prochaine facture"), stripeMail?.text);
  }

  await jul.ctx.close();
  await anon.ctx.close();
  await adm.ctx.close();
  await pgc.end();
}

// ── Lot 4 : finitions (confirmations, événement en cours, vocabulaire, accès, organisation en attente, mobile) ──
{
  const pgc = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await pgc.connect();
  const q1 = async (sql, args = []) => (await pgc.query(sql, args)).rows[0];
  const until = async (fn, ms = 6000) => {
    for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 150))) if (await fn()) return true;
    return false;
  };
  const unfold = (ics) => ics.replace(/\r\n /g, "");
  const EMMA = "emma.simon@demo.kolbase.local";
  const emma = await session();
  await login(emma.page, EMMA);

  // 1. Inscription : e-mail de confirmation (lieu, badge, prestations, .ics), carte « Inscrit », annulation en deux temps.
  {
    await emma.page.goto(`${BASE}/evenements/demo-ev-tp-endo`);
    await emma.page.check('input[name="accept_demo-ev-tp-endo-b-cafe"]');
    await emma.page.check('input[name="ackHcp"]');
    await emma.page.click('button:has-text("M\'inscrire")');
    await emma.page.locator("text=Inscription confirmée").first().waitFor({ timeout: 8000 }).catch(() => {});
    const mail = await waitMail(EMMA, "Inscription confirmée : « Travaux pratiques");
    const ics = mail?.attachments?.find((a) => a.filename?.endsWith(".ics"));
    check("Inscription : e-mail de confirmation (date, lieu, prestations, badge)", !!mail && mail.text.includes("Centre de formation Académie") && mail.text.includes("Pause café") && /\/inscriptions\/\S+\/badge/.test(mail.text) && mail.text.includes("Mes inscriptions"), mail?.text.slice(0, 200));
    check("Inscription : invitation d'agenda (.ics) jointe", !!ics && unfold(ics.content).includes("SUMMARY:Travaux pratiques") && ics.content.includes("BEGIN:VEVENT"), ics?.filename ?? "aucune pièce jointe");
    await emma.page.goto(`${BASE}/evenements`);
    const card = await emma.page.locator('article.event-card:has-text("endodontie sous microscope")').innerText();
    check("Carte d'événement : « Inscrit » au lieu de « S'inscrire »", card.includes("Inscrit") && !card.includes("S'inscrire"), card.replace(/\s+/g, " ").slice(-80));
    await emma.page.goto(`${BASE}/inscriptions`);
    const tile = emma.page.locator('.reg-tile:has-text("endodontie sous microscope")');
    await tile.locator('button:has-text("Annuler mon inscription")').click();
    const armed = await tile.locator('button:has-text("Confirmer : annuler mon inscription")').isVisible();
    const still = await q1(`select count(*)::int n from "Registration" r join "User" u on u.id = r."userId" where u.email = $1 and r."eventId" = 'demo-ev-tp-endo'`, [EMMA]);
    check("Mes inscriptions : annulation en deux temps (premier clic sans effet)", armed && still.n === 1);
    await tile.locator('button:has-text("Confirmer : annuler mon inscription")').click();
    await emma.page.waitForURL(/annulee=1/, { timeout: 8000 }).catch(() => {});
    const gone = await until(async () => (await q1(`select count(*)::int n from "Registration" r join "User" u on u.id = r."userId" where u.email = $1 and r."eventId" = 'demo-ev-tp-endo'`, [EMMA])).n === 0);
    const cancelMail = await waitMail(EMMA, "Inscription annulée : « Travaux pratiques");
    check("Mes inscriptions : annulation confirmée, message et e-mail", gone && (await text(emma.page)).includes("Inscription annulée") && !!cancelMail && cancelMail.text.includes("prestations que vous aviez acceptées"), cancelMail?.subject ?? "aucun e-mail");

    // En ligne : le lien de connexion part avec la confirmation ; annulation depuis la page de l'événement.
    const was = await q1(`select "onlineUrl" from "Event" where id = 'demo-ev-webinaire-aligneurs'`);
    await pgc.query(`update "Event" set "onlineUrl" = 'https://visio.example.com/j/lot4' where id = 'demo-ev-webinaire-aligneurs'`);
    await emma.page.goto(`${BASE}/evenements/demo-ev-webinaire-aligneurs`);
    await emma.page.click('button:has-text("M\'inscrire")');
    const online = await waitMail(EMMA, "Inscription confirmée : « Webinaire");
    const onlineIcs = online?.attachments?.find((a) => a.filename?.endsWith(".ics"));
    check("Inscription en ligne : lien de connexion dans l'e-mail et l'invitation d'agenda", !!online && online.text.includes("Lien de connexion : https://visio.example.com/j/lot4") && !!onlineIcs && unfold(onlineIcs.content).includes("visio.example.com/j/lot4"));
    await emma.page.goto(`${BASE}/evenements/demo-ev-webinaire-aligneurs`);
    await emma.page.click('button:has-text("Annuler mon inscription")');
    await emma.page.click('button:has-text("Confirmer : annuler mon inscription")');
    await emma.page.waitForURL(/annulee=1/, { timeout: 8000 }).catch(() => {});
    check("Page de l'événement : annulation confirmée en deux temps", (await text(emma.page)).includes("Inscription annulée") && (await emma.page.locator('button:has-text("M\'inscrire")').count()) === 1);
    await pgc.query(`update "Event" set "onlineUrl" = $1 where id = 'demo-ev-webinaire-aligneurs'`, [was.onlineUrl]);
  }

  // 1 et 7. Candidature : e-mail de confirmation ; appel aux places pourvues « Complet ».
  {
    await pgc.query(`insert into "OpenCall" (id, "organizationId", title, "typeId", status, slots, "createdById") values ('e2e-lot4-call', 'demo-org-dentalys', 'Relecture lot quatre', 'advisory', 'open', 1, 'demo-u-julien') on conflict do nothing`);
    // Expert référencé (Emma Simon n'est plus référencée à ce stade du parcours).
    const GIRARD = "olivier.girard@demo.kolbase.local";
    const gi = await session();
    await login(gi.page, GIRARD);
    await gi.page.goto(`${BASE}/opportunites/e2e-lot4-call`);
    check("Appel : « un dossier s'ouvre ; il avance après votre accord »", (await text(gi.page)).includes("un dossier de collaboration s'ouvre") && (await text(gi.page)).includes("il avance après votre accord"));
    await gi.page.fill('textarea[name="message"]', "Je relis volontiers vos supports, avec un retour sous huit jours.");
    await gi.page.click('button:has-text("Candidater")');
    const sent = await waitMail(GIRARD, "Candidature envoyée : Relecture lot quatre");
    check("Candidature : e-mail de confirmation avec le message et la suite", !!sent && sent.text.includes("Votre message") && sent.text.includes("retour sous huit jours") && sent.text.includes("retirer votre candidature"));
    await pgc.query(`update "Application" set status = 'retained' where "openCallId" = 'e2e-lot4-call'`);
    const jul = await session();
    await login(jul.page, "julien.faure@demo.kolbase.local");
    await jul.page.goto(`${BASE}/organisations/demo-org-dentalys/opportunites/e2e-lot4-call`);
    const pill = await jul.page.locator(".page-hero .pill").first().innerText().catch(() => "");
    check("Appel aux places pourvues : « Complet » (organisation)", pill.includes("Complet") && (await text(jul.page)).includes("toutes les places sont pourvues"), pill);
    await gi.page.goto(`${BASE}/opportunites/e2e-lot4-call`);
    check("Appel aux places pourvues : « Complet » (praticien)", (await gi.page.locator(".page-hero .pill").first().innerText()).includes("Complet"));
    await gi.ctx.close();
    await pgc.query(`delete from "Application" where "openCallId" = 'e2e-lot4-call'`);
    await pgc.query(`delete from "OpenCall" where id = 'e2e-lot4-call'`);

    // 2. Événement en cours : pointage visible, ni bilan ni absents ni attestations ; après la fin, le bilan.
    const orig = await q1(`select "startsAt" from "Event" where id = 'demo-ev-soiree-implanto'`);
    await pgc.query(`update "Event" set "startsAt" = (now() at time zone 'utc') - interval '30 minutes' where id = 'demo-ev-soiree-implanto'`);
    await pgc.query(`update "Registration" set "checkedInAt" = (now() at time zone 'utc'), "checkedInById" = 'demo-u-julien' where "eventId" = 'demo-ev-soiree-implanto' and "userId" = 'demo-u-lambert'`);
    const evUrl = `${BASE}/organisations/demo-org-dentalys/evenements/demo-ev-soiree-implanto`;
    await jul.page.goto(evUrl);
    let t = await text(jul.page);
    check("Événement en cours : carte d'accueil et pointage ouverts", t.includes("Événement en cours") && (await jul.page.locator('a:has-text("Ouvrir le pointage")').count()) === 1);
    check("Événement en cours : ni bilan, ni absents, ni attestations", !t.includes("Bilan de l'événement") && (await jul.page.locator('table .pill:has-text("Absent")').count()) === 0 && (await jul.ctx.request.get(`${evUrl}/attestations`)).status() === 404);
    const ines = await session();
    await login(ines.page, "ines.lambert@demo.kolbase.local");
    await ines.page.goto(`${BASE}/inscriptions`);
    const inesTile = await ines.page.locator('.reg-tile:has-text("Soirée implantologie")').innerText();
    check("Participant pendant l'événement : « en cours », badge encore affiché", inesTile.includes("en cours") && inesTile.includes("Mon badge d'accueil"));
    await pgc.query(`update "Event" set "startsAt" = (now() at time zone 'utc') - interval '4 hours' where id = 'demo-ev-soiree-implanto'`);
    await jul.page.goto(evUrl);
    t = await text(jul.page);
    check("Événement terminé : bilan et absents", t.includes("Bilan de l'événement") && (await jul.page.locator('table .pill:has-text("Absent")').count()) > 0);
    const csv = await (await jul.ctx.request.get(`${evUrl}/export`)).text();
    check("Export des inscrits : colonnes Présence et Arrivée", csv.split("\r\n")[0].includes("Présence;Arrivée") && /Lambert;[^\r\n]*;présent;/.test(csv) && csv.includes(";absent;"), csv.split("\r\n")[0]);
    await pgc.query(`update "Event" set "startsAt" = $1 where id = 'demo-ev-soiree-implanto'`, [orig.startsAt]);

    // 7. Historique du dossier sans code technique ; dossier terminé sans « Créer l'événement ».
    await jul.page.goto(`${BASE}/organisations/demo-org-dentalys/dossiers/demo-prj-hist-board25`);
    t = await text(jul.page);
    check("Historique du dossier : libellés, aucun code technique", t.includes("Déclaration simple : convention à signer") && !/\b(project|signature|document|expert|solicitation)\.[a-z_]+\b/.test(t));
    await tab(jul.page, "evenement");
    check("Dossier terminé : pas de « Créer l'événement du dossier »", !(await text(jul.page)).includes("Créer l'événement du dossier"));
    // 7. Accès refusé : un message plutôt qu'un retour muet.
    await jul.page.goto(`${BASE}/organisations/demo-org-dentalys/conformite`);
    check("Accès refusé : message sur l'accueil de l'organisation", jul.page.url().endsWith("?acces=refuse") && (await text(jul.page)).includes("réservée à d'autres rôles"), jul.page.url());
    // 7. « Solliciter » depuis l'espace courant.
    await pgc.query(`insert into "Membership" (id, "userId", "organizationId", role) values ('e2e-lot4-m', 'demo-u-julien', 'demo-org-cdra', 'PROJETS')`);
    // La page précédente mémorise son espace (kb_espace) une fois hydratée : attendre cette écriture avant de la remplacer.
    await jul.page.waitForLoadState("networkidle");
    await jul.page.waitForFunction(() => document.cookie.includes("kb_espace="), null, { timeout: 5000 }).catch(() => {});
    await jul.ctx.addCookies([{ name: "kb_espace", value: "demo-org-cdra", url: BASE }]);
    await jul.page.goto(`${BASE}/experts/demo-p-martin`);
    const solicit = (await jul.page.locator('a:has-text("Solliciter")').first().getAttribute("href")) ?? "";
    check("« Solliciter » : depuis l'espace d'organisation courant", solicit.startsWith("/organisations/demo-org-cdra/dossiers/nouveau"), solicit);
    await pgc.query(`delete from "Membership" where id = 'e2e-lot4-m'`);
    await jul.ctx.close();
    await ines.ctx.close();
  }

  // 7. Conformité : fiche événement en lecture, pastilles justes, lien de pointage masqué.
  {
    const so = await session();
    await login(so.page, "sophie.bernard@demo.kolbase.local");
    const r = await so.page.goto(`${BASE}/organisations/demo-org-dentalys/evenements/demo-ev-soiree-implanto`);
    const t = await text(so.page);
    check("Conformité : fiche événement en lecture seule", r?.status() === 200 && so.page.url().includes("/evenements/demo-ev-soiree-implanto") && t.includes("Lecture seule (rôle Conformité)") && !t.includes("Modifier l'événement") && (await so.page.locator('button:has-text("Retirer de l\'agenda")').count()) === 0, so.page.url());
    await so.page.goto(`${BASE}/organisations/demo-org-dentalys/hospitalites`);
    const toValidate = (await q1(`select count(*)::int n from "Project" where "organizationId" = 'demo-org-dentalys' and status = 'EN_VALID'`)).n;
    const badge = async (label) => (await so.page.locator(`.section-nav a:has-text("${label}") .count`).count()) ? Number(await so.page.locator(`.section-nav a:has-text("${label}") .count`).innerText()) : 0;
    check("Pastilles hors de /conformite : « À valider » juste, rien sur Registre ni Paramètres", (await badge("À valider")) === toValidate && (await badge("Registre des conventions")) === 0 && (await badge("Paramètres")) === 0, `À valider ${await badge("À valider")} / ${toValidate}`);
    check("Hospitalités : pas de lien vers le pointage pour la conformité", (await so.page.locator('a:has-text("Corriger le pointage")').count()) === 0);
    await so.ctx.close();
  }

  // 7. Dossier né d'un appel rattaché à un événement : lien vers l'événement, pas de création proposée.
  {
    const pv = await session();
    await login(pv.page, "pierre.vidal@demo.kolbase.local");
    await pv.page.goto(`${BASE}/organisations/demo-org-cdra/dossiers/demo-prj-cdra-paro?onglet=evenement`);
    check("Dossier né d'un appel rattaché à un événement : l'événement de l'opportunité dans l'onglet, pas de création proposée", (await text(pv.page)).includes("l'intervention a lieu à cet événement") && (await pv.page.locator(".event-hero").count()) === 1 && !(await text(pv.page)).includes("Créer l'événement du dossier"));
    await pv.ctx.close();
  }

  // 3. Vocabulaire : menu praticien, statut vu par l'expert, « Candidater », /structures, experts vérifiés d'abord.
  {
    await emma.page.goto(`${BASE}/tableau-de-bord`);
    check("Menu praticien : « Mes inscriptions » et « Mon compte »", (await emma.page.locator('aside a[href="/inscriptions"]').first().innerText()).includes("Mes inscriptions") && (await emma.page.locator('aside a[href="/compte"]').first().innerText()).includes("Mon compte"));
    await emma.page.goto(`${BASE}/appels`);
    check("Appels publics connecté : « Candidater »", (await emma.page.locator('article.dossier-card a:has-text("Candidater")').count()) > 0 && (await emma.page.locator('text=Se connecter pour candidater').count()) === 0);
    const bl = await session();
    await login(bl.page, "nicolas.blanc@demo.kolbase.local");
    await bl.page.goto(`${BASE}/sollicitations`);
    const st = await text(bl.page);
    check("Expert : « Votre réponse est attendue », pas « En attente des experts »", st.includes("Votre réponse est attendue") && !st.includes("En attente des experts"));
    await bl.ctx.close();
    const anon = await session();
    await anon.page.goto(`${BASE}/appels`);
    check("Appels publics sans session : « Se connecter pour candidater »", (await anon.page.locator('article.dossier-card a:has-text("Se connecter pour candidater")').count()) > 0);
    await anon.page.goto(`${BASE}/structures?type=prestataires`);
    const h1p = await anon.page.locator("main h1").innerText();
    await anon.page.goto(`${BASE}/structures`);
    check("/structures : titre selon le filtre", h1p === "Prestataires" && (await anon.page.locator("main h1").innerText()) === "Organisations référencées", h1p);
    await anon.page.goto(`${BASE}/experts`);
    const cards = await anon.page.locator("a.kol-card").allInnerTexts();
    const firstUnverified = cards.findIndex((c) => !c.includes("Identité vérifiée"));
    check("Réseau vérifié : experts vérifiés d'abord", firstUnverified === -1 || cards.slice(firstUnverified).every((c) => !c.includes("Identité vérifiée")));
    // 5. Accueil public : compteurs alignés sur les listes, sans bandeau de logos, filtres visibles.
    await anon.page.goto(`${BASE}/appels`);
    const callCards = await anon.page.locator("article.dossier-card").count();
    await anon.page.goto(`${BASE}/`);
    const callTab = await anon.page.locator('.home-search button:has-text("Opportunités")').innerText();
    check("Accueil : « Opportunités » = appels listés", new RegExp(`Opportunités\\s*${callCards}\\b`).test(callTab), `${callTab} / ${callCards} appels listés`);
    check("Accueil : plus de « Ils publient sur KolBase »", !(await text(anon.page)).includes("Ils publient sur KolBase"));
    await anon.page.goto(`${BASE}/experts?type=${encodeURIComponent("Conférence")}&ville=Lyon`);
    const chips = await anon.page.locator(".active-filters").innerText().catch(() => "");
    check("Recherche de l'accueil : filtres visibles sur la page de résultats", chips.includes("Type : Conférence") && chips.includes("Ville : Lyon"), chips);
    // 4. Menu public mobile : bouton « Se connecter », « Se référencer » en tête de la rangée de liens.
    const mob = await browser.newContext({ locale: "fr-FR", viewport: { width: 390, height: 844 } });
    const mp = await mob.newPage();
    await mp.goto(`${BASE}/`);
    check("Menu public mobile : bouton « Se connecter », « Se référencer » accessible", (await mp.locator('header .nav-actions a.btn:visible').innerText()) === "Se connecter" && (await mp.locator('header nav a:has-text("Se référencer")').isVisible()));
    await login(mp, EMMA);
    await mp.goto(`${BASE}/tableau-de-bord`);
    check("Barre mobile : cinq entrées au plus", (await mp.locator(".bottom-nav a").count()) <= 5 && (await mp.locator(".bottom-nav a").count()) >= 3, String(await mp.locator(".bottom-nav a").count()));
    await mob.close();
    await anon.ctx.close();
  }

  // 7. Intégrations, invitation, cloche des suivis, Mon compte, confirmation d'adresse, opportunités non référencé.
  {
    const cl = await session();
    await login(cl.page, "claire.morel@demo.kolbase.local");
    await cl.page.goto(`${BASE}/organisations/demo-org-dentalys/integrations`);
    check("Intégrations : signature électronique active", (await cl.page.locator('section:has(h2:has-text("Signature électronique")) .pill').innerText()) === "Actif");
    await cl.page.goto(`${BASE}/organisations/demo-org-dentalys/membres`);
    const form = 'form:has(h2:has-text("Inviter un membre"))';
    check("Invitation : libellé de l'adresse explicite", (await cl.page.locator(form).innerText()).includes("E-mail de la personne invitée (l'invitation lui est envoyée et réservée)"));
    await cl.page.selectOption(`${form} select[name="role"]`, "PROJETS");
    await cl.page.fill(`${form} input[name="email"]`, "lot4.invite@exemple.fr");
    await cl.page.click(`${form} button:has-text("Générer le lien")`);
    const inv = await waitMail("lot4.invite@exemple.fr", "vous invite à rejoindre");
    check("Invitation : rôle annoncé dans l'e-mail", !!inv && inv.text.includes("avec le rôle « Projets »") && inv.text.includes("réservée à cette adresse"));
    await cl.ctx.close();

    await emma.page.goto(`${BASE}/compte`);
    check("Mon compte : sommaire et RPPS dans l'encart de référencement", (await emma.page.locator('nav.account-toc a[href="#securite"]').count()) === 1 && (await emma.page.locator("#referencement").innerText()).includes("N° RPPS"));
    await emma.ctx.close();

    await pgc.query(`update "User" set "emailVerifiedAt" = null where email = 'ines.lambert@demo.kolbase.local'`);
    await pgc.query(`insert into "Follow" (id, "userId", "organizationId") values ('e2e-lot4-f', 'demo-u-lambert', 'demo-org-dentalys') on conflict do nothing`);
    const ines = await session();
    await login(ines.page, "ines.lambert@demo.kolbase.local");
    await ines.page.goto(`${BASE}/tableau-de-bord`);
    check("Suivre : cloche des suivis visible dès un profil suivi", (await ines.page.locator('a[href="/suivis"]').count()) > 0);
    await ines.page.goto(`${BASE}/opportunites`);
    check("Opportunités sans référencement : « Référencez-vous pour candidater »", ines.page.url().includes("/compte?candidater=1") && (await text(ines.page)).includes("Référencez-vous pour candidater") && !(await text(ines.page)).includes("L'annuaire est réservé"), ines.page.url());
    check("Adresse non confirmée : seule la lettre d'information en dépend", (await text(ines.page)).includes("Sans confirmation, vous ne recevez pas la lettre d'information"));
    await ines.page.click('button:has-text("Renvoyer le lien")');
    const verify = await waitMail("ines.lambert@demo.kolbase.local", "Confirmez votre adresse");
    const out = await session();
    await out.page.goto(linkIn(verify));
    check("Lien de confirmation ouvert déconnecté : résultat sur la page de connexion", out.page.url().includes("/connexion") && (await text(out.page)).includes("Adresse e-mail confirmée. Connectez-vous pour continuer."), out.page.url());
    await out.ctx.close();
    await pgc.query(`delete from "Follow" where id = 'e2e-lot4-f'`);
    await ines.ctx.close();
  }

  // 6. Organisation en attente (association avec RNA) : demande datée, validation avant l'abonnement, annuaire expliqué.
  {
    const hu = await session();
    await login(hu.page, "hugo.robert@demo.kolbase.local");
    await hu.page.goto(`${BASE}/organisations/nouvelle`);
    await hu.page.fill('input[name="name"]', "Société Lot Quatre");
    await hu.page.selectOption('select[name="kind"]', "SOCIETE_SAVANTE");
    await hu.page.fill('input[name="siren"]', "W751234567");
    await hu.page.click('button:has-text("Créer l\'organisation")');
    await hu.page.waitForURL((u) => /^\/organisations\/[^/]+$/.test(u.pathname) && !u.pathname.endsWith("/nouvelle"), { timeout: 10000 }).catch(() => {});
    const org = await q1(`select id, rna, "verificationRequestedAt" from "Organization" where name = 'Société Lot Quatre'`);
    const adminMail = await waitMail("anne.chevalier@demo.kolbase.local", "Organisation à valider : Société Lot Quatre");
    check("Association : SIREN facultatif, RNA accepté", org?.rna === "W751234567" && !!org.verificationRequestedAt && !!adminMail && adminMail.text.includes("RNA W751234567"));
    await hu.page.goto(`${BASE}/organisations/${org?.id}/membres?onglet=organisation`);
    const card = await hu.page.locator('section:has(h2:has-text("Validation de l"))').innerText();
    check("Carte de validation : « Demande transmise le … », pas de nouvel envoi", card.includes("Demande transmise le") && !card.includes("Envoyer pour validation"), card.slice(0, 160));
    await hu.page.goto(`${BASE}/organisations/${org?.id}/evenements/nouveau`);
    const ev = await text(hu.page);
    check("Organisation en attente : la validation prime sur l'abonnement", ev.includes("en attente de validation par KolBase") && !ev.includes("l'abonnement de l'organisation doit être activé"));
    await hu.page.goto(`${BASE}/annuaire`);
    check("« Praticiens » d'une organisation en attente : l'annuaire public dit pourquoi", hu.page.url().includes("/experts?acces=annuaire") && (await text(hu.page)).includes("n'est pas encore validée par KolBase"), hu.page.url());
    await hu.ctx.close();
  }

  // 8. Anglais : navigation de l'espace organisation et création d'organisation.
  {
    const en = await session();
    // Langue réglée dans le compte (le sélecteur n'existe que pour les visiteurs).
    await pgc.query(`update "User" set locale = 'en' where id = 'demo-u-julien'`);
    await login(en.page, "julien.faure@demo.kolbase.local");
    await en.page.goto(`${BASE}/organisations/demo-org-dentalys`);
    const side = await en.page.locator("aside").first().innerText().catch(() => "");
    check("Anglais : navigation de l'espace organisation traduite", side.includes("Files") && side.includes("Events") && !side.includes("Dossiers"), side.replace(/\s+/g, " ").slice(0, 120));
    await en.page.goto(`${BASE}/organisations/nouvelle`);
    check("Anglais : création d'organisation traduite", (await text(en.page)).includes("Organisation name") && !(await text(en.page)).includes("Nom de l'organisation"));
    await pgc.query(`update "User" set locale = 'fr' where id = 'demo-u-julien'`);
    await en.ctx.close();
  }
  await pgc.end();
}

// ── Lot 5a : confidentialité des devis, tiers prévenus, négociation des honoraires ──
{
  const pgc = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await pgc.connect();
  const q1 = async (sql, args = []) => (await pgc.query(sql, args)).rows[0];
  const until = async (fn, ms = 6000) => {
    for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 150))) if (await fn()) return true;
    return false;
  };
  /** Geste irréversible en deux temps : le bouton, puis « Confirmer : … ». */
  const confirmClick = async (scope, label) => {
    await scope.locator(`button:has-text("${label}")`).first().click();
    const ok = scope.locator('button:has-text("Confirmer")').first();
    await ok.waitFor({ timeout: 3000 });
    await ok.click();
  };
  /** E-mails reçus depuis un repère (pour vérifier qu'un e-mail n'est pas parti). */
  const mailsSince = (from, to, subject) => mails.slice(from).filter((m) => m.to === to && m.subject.includes(subject));
  const KARIM = "karim.benali@demo.kolbase.local";
  const CLAIRE = "claire.morel@demo.kolbase.local";

  // 1. Agence consultée sur une demande de l'événement qu'elle pilote : ni devis concurrents, ni décision, ni e-mails.
  {
    await pgc.query(`insert into "Mandate" (id, "mandatorId", "agencyId", scope) select 'e2e-5a-mandat', 'demo-org-dentalys', 'demo-org-mediane', 'Événements confiés'
      where not exists (select 1 from "Mandate" where "mandatorId" = 'demo-org-dentalys' and "agencyId" = 'demo-org-mediane' and ("endsAt" is null or "endsAt" > now()))`);
    await pgc.query(`update "Mandate" set "canAward" = false where "mandatorId" = 'demo-org-dentalys' and "agencyId" = 'demo-org-mediane'`);
    await pgc.query(`insert into "Event" (id, "organizationId", title, "typeId", "startsAt", city, venue, capacity, "publishedAt", "agencyId", "updatedAt")
      values ('e2e-5a-ev', 'demo-org-dentalys', 'Soirée des partenaires', 'symposium', now() + interval '30 days', 'Lyon', 'Salle des Célestins (fictive)', 80, now(), 'demo-org-mediane', now())`);
    await pgc.query(`insert into "Subscription" ("organizationId", plan, status, "exemptUntil", "updatedAt") values ('demo-sup-belleville', 'prestataire', 'a_activer', '2099-12-31', now()) on conflict ("organizationId") do update set "exemptUntil" = '2099-12-31'`);
    const claireId = (await q1(`select id from "User" where email = $1`, [CLAIRE])).id;
    const karimId = (await q1(`select id from "User" where email = $1`, [KARIM])).id;
    // Demande de Claire : l'agence de l'événement et Traiteur Belleville consultés ; l'agence a déjà répondu.
    await pgc.query(`insert into "Rfq" (id, "organizationId", "eventId", category, needs, status, "sentAt", "createdById", headcount)
      values ('e2e-5a-rfq', 'demo-org-dentalys', 'e2e-5a-ev', 'evenementiel', 'Coordination générale de la soirée, accueil et vestiaire des 80 invités.', 'sent', now(), $1, 80)`, [claireId]);
    await pgc.query(`insert into "RfqSupplier" ("rfqId", "supplierId") values ('e2e-5a-rfq', 'demo-org-mediane'), ('e2e-5a-rfq', 'demo-sup-belleville')`);
    await pgc.query(`insert into "Quote" (id, "rfqId", "supplierId", "amountCents", "vatBp", "updatedAt") values ('e2e-5a-qa', 'e2e-5a-rfq', 'demo-org-mediane', 500000, 2000, now())`);

    // Le concurrent répond (premier devis, détaillé) puis pose une question : l'agence n'en est pas prévenue.
    const mark = mails.length;
    const sup = await session();
    await login(sup.page, "ludovic.perrin@demo.kolbase.local");
    await sup.page.goto(`${BASE}/organisations/demo-sup-belleville/devis/e2e-5a-rfq`);
    const sc = sup.page.locator("main");
    const qf = sc.locator('form:has(input[name="line_label"])');
    await qf.locator('input[name="line_label"]').first().fill("Accueil et vestiaire Belleville");
    await qf.locator('input[name="line_unit"]').first().fill("3333");
    await qf.locator('input[name="conditions"]').fill("Conditions réservées au client");
    await qf.locator('button:has-text("Envoyer le devis")').click();
    await until(async () => !!(await q1(`select id from "Quote" where "rfqId" = 'e2e-5a-rfq' and "supplierId" = 'demo-sup-belleville'`)));
    await sc.locator('textarea[name="body"]').fill("Question réservée au client : combien de portants ?");
    await sc.locator('button:has-text("Envoyer")').last().click();
    const recu = await waitMail(CLAIRE, "Devis reçu de Traiteur Belleville");
    const quest = await waitMail(CLAIRE, "Question de Traiteur Belleville");
    check("Confidentialité : l'organisatrice reçoit le devis et la question du concurrent", !!recu && !!quest);
    check("Confidentialité : l'agence consultée ne reçoit ni « Devis reçu » ni « Question de » du concurrent",
      mailsSince(mark, KARIM, "Devis reçu de Traiteur Belleville").length === 0 && mailsSince(mark, KARIM, "Question de Traiteur Belleville").length === 0,
      mails.slice(mark).filter((m) => m.to === KARIM).map((m) => m.subject).join(" | "));

    // Ce que voit l'agence sur la demande : son devis seulement, aucune décision possible.
    const ag = await session();
    await login(ag.page, KARIM);
    await ag.page.goto(`${BASE}/organisations/demo-org-dentalys/prestataires/e2e-5a-rfq`);
    const card = ag.page.locator("section#rfq-e2e-5a-rfq");
    const at = await card.innerText();
    check("Confidentialité : l'agence voit son propre devis et l'explication", at.includes("Votre organisation est consultée sur cette demande") && at.includes("Agence Médiane") && /5\s000/.test(at), at.slice(0, 300));
    check("Confidentialité : ni devis, ni montant, ni conditions, ni question du concurrent",
      !at.includes("Traiteur Belleville") && !/3\s333/.test(at) && !at.includes("Conditions réservées") && !at.includes("Question réservée") && !at.includes("Meilleure offre") && !at.includes("dès "), at.slice(0, 400));
    check("Confidentialité : ni « Proposer », ni « Retenir », ni « Annuler » pour l'agence",
      (await card.locator('button:has-text("Proposer")').count()) === 0 && (await card.locator('button:has-text("Retenir")').count()) === 0 && (await card.locator('button:has-text("Annuler la demande")').count()) === 0 && (await card.locator("textarea").count()) === 0);
    await ag.page.goto(`${BASE}/organisations/demo-org-dentalys/evenements/e2e-5a-ev`);
    const lg = await ag.page.locator(".logistics-list").innerText().catch(() => "");
    check("Confidentialité : fiche de l'événement sans « meilleure offre » du concurrent", lg.includes("Votre organisation est consultée") && !/3\s999,60/.test(lg) && !lg.includes("meilleure offre"), lg.slice(0, 300));
    await ag.page.goto(`${BASE}/organisations/demo-org-mediane`);
    const agTodo = await ag.page.locator('a.todo-row:has-text("Soirée des partenaires")').count();
    await ag.page.goto(`${BASE}/organisations/demo-org-dentalys`);
    check("Confidentialité : pas de tâche « Devis à comparer » ni « Question de » sur cette demande pour l'agence",
      agTodo === 0 && (await ag.page.locator('a.todo-row:has-text("Soirée des partenaires")').count()) === 0);

    // L'organisatrice : tout, avec l'agence signalée ; à la consultation, « Agence de cet événement ».
    const org = await session();
    await login(org.page, CLAIRE);
    await org.page.goto(`${BASE}/organisations/demo-org-dentalys/prestataires/e2e-5a-rfq`);
    const oc = await org.page.locator("section#rfq-e2e-5a-rfq").innerText();
    check("Organisatrice : les deux devis, l'agence signalée sur son événement", oc.includes("Traiteur Belleville") && /3\s333/.test(oc) && oc.includes("Agence mandatée sur cet événement"), oc.slice(0, 300));
    await org.page.goto(`${BASE}/organisations/demo-org-dentalys/prestataires?onglet=nouvelle&evenement=e2e-5a-ev&cat=evenementiel`);
    const line = await org.page.locator('.supplier:has-text("Agence Médiane")').innerText().catch(() => "");
    check("Consultation : « Agence de cet événement » signalée, consultation possible", line.includes("Agence de cet événement") && line.includes("Consulter"), line.slice(0, 200));
    // Décision de l'organisatrice : l'agence apprend que son devis n'est pas retenu, sans le montant du concurrent.
    const mark2 = mails.length;
    await org.page.goto(`${BASE}/organisations/demo-org-dentalys/prestataires/e2e-5a-rfq`);
    await confirmClick(org.page.locator('section#rfq-e2e-5a-rfq .quote:has-text("Traiteur Belleville")'), "Retenir");
    await until(async () => (await q1(`select status from "Rfq" where id = 'e2e-5a-rfq'`))?.status === "awarded");
    const lost = await waitMail(KARIM, "Votre devis n'est pas retenu par Dentalys Implants");
    check("Décision : l'agence reçoit « non retenu », pas l'annonce du devis retenu et de son montant",
      !!lost && mailsSince(mark2, KARIM, "a retenu un devis").length === 0, mails.slice(mark2).filter((m) => m.to === KARIM).map((m) => m.subject).join(" | "));
    await ag.page.goto(`${BASE}/organisations/demo-org-dentalys/prestataires/e2e-5a-rfq`);
    const after = await ag.page.locator("section#rfq-e2e-5a-rfq").innerText();
    check("Décision vue par l'agence : prestataire retenu sans son montant", after.includes("Attribuée à Traiteur Belleville") && !/3\s333/.test(after) && !/3\s999/.test(after), after.slice(0, 300));

    // Annuler : l'auteur de la demande (ici l'agence) peut ; pas une agence qui n'en est pas l'auteur.
    await pgc.query(`insert into "Rfq" (id, "organizationId", "eventId", category, needs, status, "sentAt", "createdById", headcount)
      values ('e2e-5a-rfq2', 'demo-org-dentalys', 'e2e-5a-ev', 'impression', 'Signalétique de la soirée : kakémonos et plan de table.', 'sent', now(), $1, 80),
             ('e2e-5a-rfq3', 'demo-org-dentalys', 'e2e-5a-ev', 'restauration', 'Cocktail des partenaires, 80 personnes.', 'sent', now(), $2, 80)`, [karimId, claireId]);
    await pgc.query(`insert into "RfqSupplier" ("rfqId", "supplierId") values ('e2e-5a-rfq2', 'demo-sup-tablesdusud'), ('e2e-5a-rfq3', 'demo-sup-belleville')`);
    await pgc.query(`insert into "Quote" (id, "rfqId", "supplierId", "amountCents", "vatBp", "updatedAt") values ('e2e-5a-q3', 'e2e-5a-rfq3', 'demo-sup-belleville', 210000, 1000, now())`);
    await ag.page.goto(`${BASE}/organisations/demo-org-dentalys/prestataires/e2e-5a-rfq3`);
    check("Annuler : pas proposé à l'agence sur une demande de l'organisation", (await ag.page.locator('section#rfq-e2e-5a-rfq3 button:has-text("Annuler la demande")').count()) === 0);
    await ag.page.goto(`${BASE}/organisations/demo-org-dentalys/prestataires/e2e-5a-rfq2`);
    const c2 = ag.page.locator("section#rfq-e2e-5a-rfq2");
    await c2.locator('button:has-text("Annuler la demande")').click();
    check("Annuler : confirmation en deux temps qui annonce les e-mails", (await c2.innerText()).includes("Les organisateurs sont prévenus") && (await c2.locator('button:has-text("Confirmer : annuler la demande")').count()) === 1);
    await c2.locator('button:has-text("Confirmer : annuler la demande")').click();
    await until(async () => (await q1(`select status from "Rfq" where id = 'e2e-5a-rfq2'`))?.status === "cancelled");
    const cancelled = await q1(`select "cancelledById", "cancelledAt" from "Rfq" where id = 'e2e-5a-rfq2'`);
    check("Annuler : par l'auteur de la demande, qui et quand enregistrés", cancelled?.cancelledById === karimId && !!cancelled.cancelledAt);
    const cm = await waitMail(CLAIRE, "Demande de devis annulée : Soirée des partenaires");
    check("Annuler : e-mail aux organisateurs quand l'agence annule", !!cm && cm.text.includes("Karim Benali (Agence Médiane Événements)"), cm?.text);
    await org.page.goto(`${BASE}/organisations/demo-org-dentalys/prestataires/e2e-5a-rfq2`);
    const c2t = await org.page.locator("section#rfq-e2e-5a-rfq2").innerText();
    check("Carte : « Annulée par … le … »", /Annulée par Karim Benali \(Agence Médiane Événements, agence mandatée\) le \d/.test(c2t), c2t.slice(0, 300));

    // Proposition de l'agence puis révision du devis : la proposition tombe, l'agence est prévenue.
    await ag.page.goto(`${BASE}/organisations/demo-org-dentalys/prestataires/e2e-5a-rfq3`);
    await ag.page.locator('section#rfq-e2e-5a-rfq3 button:has-text("Proposer à l")').click();
    await until(async () => (await q1(`select "proposedQuoteId" from "Rfq" where id = 'e2e-5a-rfq3'`))?.proposedQuoteId === "e2e-5a-q3");
    await org.page.goto(`${BASE}/organisations/demo-org-dentalys/prestataires/e2e-5a-rfq3`);
    const proposed = (await org.page.locator("section#rfq-e2e-5a-rfq3").innerText()).includes("Proposé par l'agence mandatée");
    await sup.page.goto(`${BASE}/organisations/demo-sup-belleville/devis/e2e-5a-rfq3`);
    const c3 = sup.page.locator("main");
    await c3.locator('button:has-text("Réviser mon devis")').click();
    await c3.locator('input[name="line_unit"]').first().fill("2300");
    await c3.locator('button:has-text("Envoyer la version 2")').click();
    await until(async () => (await q1(`select revision from "Quote" where id = 'e2e-5a-q3'`))?.revision === 2);
    await until(async () => !(await q1(`select "proposedQuoteId" from "Rfq" where id = 'e2e-5a-rfq3'`))?.proposedQuoteId);
    check("Révision : la proposition de l'agence est retirée", !(await q1(`select "proposedQuoteId" from "Rfq" where id = 'e2e-5a-rfq3'`))?.proposedQuoteId);
    check("Révision : e-mail à l'agence « devis proposé révisé »", !!(await waitMail(KARIM, "Devis proposé révisé : Traiteur Belleville")));
    await org.page.goto(`${BASE}/organisations/demo-org-dentalys/prestataires/e2e-5a-rfq3`);
    const r3 = await org.page.locator("section#rfq-e2e-5a-rfq3").innerText();
    await org.page.goto(`${BASE}/organisations/demo-org-dentalys`);
    check("Révision : proposition et tâche « Devis à retenir » retirées", proposed && !r3.includes("Proposé par l'agence mandatée") && !(await text(org.page)).includes("Devis à retenir : Soirée des partenaires"), r3.slice(0, 300));
    await sup.ctx.close();
    await org.ctx.close();
    await ag.ctx.close();
  }

  // 2. Tiers prévenus : experts (étapes du dossier, recrutement clos), équipe Projets, client d'une demande de devis.
  {
    const pdf = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n");
    const MOREAU = "vincent.moreau@demo.kolbase.local";
    const LEMOINE = "julie.lemoine@demo.kolbase.local";
    const claireId = (await q1(`select id from "User" where email = $1`, [CLAIRE])).id;
    await pgc.query(`update "User" set "notifyPrefs" = '{}' where email in ($1, $2)`, [MOREAU, LEMOINE]);
    // Dossier en accord de principe : Moreau engagé, Lemoine sollicitée sans réponse.
    await pgc.query(`insert into "Project" (id, "organizationId", title, "typeId", status, "createdById", "updatedAt") values ('e2e-5a-prj', 'demo-org-dentalys', 'Board 5a maintenance implantaire', 'advisory', 'ACCORD', $1, now())`, [claireId]);
    await pgc.query(`insert into "ProjectExpert" (id, "projectId", "practitionerId", status, "feeCents", days, "respondedAt") values
      ('e2e-5a-l-moreau', 'e2e-5a-prj', 'demo-p-moreau', 'ACCORD', 150000, 1, now()), ('e2e-5a-l-lemoine', 'e2e-5a-prj', 'demo-p-lemoine', 'ATT_EXPERTS', 150000, 1, null)`);
    const org = await session();
    await login(org.page, CLAIRE);
    const dossier = `${BASE}/organisations/demo-org-dentalys/dossiers/e2e-5a-prj`;
    await org.page.goto(dossier);
    // Soumission : la réponse attendue de Lemoine est close, elle en est prévenue.
    await confirmClick(org.page.locator('form:has(input[value="submit"])'), "Soumettre à la conformité");
    await until(async () => (await q1(`select status from "Project" where id = 'e2e-5a-prj'`))?.status === "EN_VALID");
    const clos = await waitMail(LEMOINE, "Recrutement clos : Board 5a maintenance implantaire");
    check("Recrutement clos : e-mail à l'experte restée sans réponse", !!clos && clos.text.includes("sans votre réponse"), clos?.text);
    const lem = await session();
    await login(lem.page, LEMOINE);
    await lem.page.goto(`${BASE}/sollicitations`);
    const tile = await lem.page.locator('a.row-item:has-text("Board 5a maintenance implantaire")').innerText();
    check("Recrutement clos : « Recrutement clos » dans la liste, pas « Décliné / abandonné »", tile.includes("Recrutement clos") && !tile.includes("Décliné"), tile);
    const expected = Number((await q1(`select count(*) as n from "ProjectExpert" pe join "Project" p on p.id = pe."projectId" where pe."practitionerId" = 'demo-p-lemoine' and pe.status = 'ATT_EXPERTS' and pe."desiredFeeCents" is null and p.status in ('ATT_EXPERTS', 'ACCORD')`)).n);
    const badge = await lem.page.locator('a.side-link[href="/sollicitations"] .side-badge').innerText().catch(() => "0");
    check("Menu « Sollicitations » : seulement les réponses attendues d'un recrutement ouvert", Number(badge) === expected, `${badge} affiché, ${expected} attendu`);
    await lem.page.goto(`${BASE}/sollicitations/e2e-5a-l-lemoine`);
    const lt = await text(lem.page);
    check("Recrutement clos : la fiche le dit, sans « À vous de répondre »", lt.includes("Recrutement clos") && !lt.includes("Décliné / abandonné") && !lt.includes("À vous de répondre"));

    // Signature : l'expert dépose sa convention (type présélectionné), l'équipe Projets est prévenue ; signé, l'expert l'est.
    await pgc.query(`update "Project" set status = 'SIGNATURE' where id = 'e2e-5a-prj'`);
    await pgc.query(`update "ProjectExpert" set status = 'SIGNATURE' where id = 'e2e-5a-l-moreau'`);
    const mor = await session();
    await login(mor.page, MOREAU);
    await mor.page.goto(`${BASE}/sollicitations/e2e-5a-l-moreau`);
    const tl = await mor.page.locator(".pipeline").innerText();
    check("Frise de l'expert : « Sollicitation reçue » sur l'étape franchie", tl.includes("Sollicitation reçue") && !tl.includes("Votre réponse est attendue"), tl.replace(/\s+/g, " "));
    await tab(mor.page, "documents");
    const up = mor.page.locator('form:has(input[name="file"])');
    check("En signature : « Convention signée » présélectionnée au dépôt", (await up.locator('select[name="kind"]').inputValue()) === "CONVENTION_SIGNEE");
    await up.locator('input[name="file"]').setInputFiles({ name: "convention-moreau-signee.pdf", mimeType: "application/pdf", buffer: pdf });
    await up.locator('button:has-text("Déposer")').click();
    const dep = await waitMail(CLAIRE, "Convention signée déposée par Dr Vincent Moreau — Board 5a maintenance implantaire");
    check("Convention déposée par l'expert : e-mail à l'équipe Projets", !!dep);
    await org.page.goto(dossier);
    await org.page.locator('form:has(input[value="signed"]) button').click();
    await until(async () => (await q1(`select status from "Project" where id = 'e2e-5a-prj'`))?.status === "SIGNE");
    check("Dossier signé : e-mail à l'expert", !!(await waitMail(MOREAU, "Dossier signé : Board 5a maintenance implantaire")));

    // Retour en accord de principe puis abandon (motif) : l'expert est prévenu ; le motif figure sur sa sollicitation.
    await pgc.query(`insert into "Project" (id, "organizationId", title, "typeId", status, "createdById", "updatedAt") values ('e2e-5a-prj2', 'demo-org-dentalys', 'Comité 5a occlusion', 'advisory', 'VALIDE', $1, now())`, [claireId]);
    await pgc.query(`insert into "ProjectExpert" (id, "projectId", "practitionerId", status, "feeCents", days, "respondedAt") values ('e2e-5a-l2-moreau', 'e2e-5a-prj2', 'demo-p-moreau', 'VALIDE', 120000, 1, now())`);
    await org.page.goto(`${BASE}/organisations/demo-org-dentalys/dossiers/e2e-5a-prj2`);
    await openMore(org.page);
    await Promise.all([org.page.waitForURL(/modifier=1/), org.page.locator('form:has(input[value="back_to_accord"]) button').click()]);
    check("Retour en accord de principe : e-mail à l'expert engagé", !!(await waitMail(MOREAU, "Conditions à revoir : Comité 5a occlusion")));
    await org.page.goto(`${BASE}/organisations/demo-org-dentalys/dossiers/e2e-5a-prj2`);
    await openMore(org.page);
    const ab = org.page.locator('form:has(input[value="abandon"])');
    await ab.locator('input[name="note"]').fill("Budget reporté à l'an prochain");
    await ab.locator("button").click();
    await until(async () => (await q1(`select status from "Project" where id = 'e2e-5a-prj2'`))?.status === "DECLINE");
    const abm = await waitMail(MOREAU, "Dossier abandonné : Comité 5a occlusion");
    check("Abandon : e-mail à l'expert avec le motif", !!abm && abm.text.includes("Motif : Budget reporté à l'an prochain"), abm?.text);
    await mor.page.goto(`${BASE}/sollicitations/e2e-5a-l2-moreau`);
    const mt = await text(mor.page);
    check("Abandon : motif affiché sur la sollicitation de l'expert", mt.includes("Abandonné par l'organisation") && mt.includes("Motif : Budget reporté à l'an prochain"), mt.slice(0, 300));
    await mor.ctx.close();
    await lem.ctx.close();

    // Demande de devis déclinée (motif) : le client est prévenu, la carte le dit.
    await pgc.query(`insert into "Rfq" (id, "organizationId", "eventId", category, needs, status, "sentAt", "createdById", headcount)
      values ('e2e-5a-rfq4', 'demo-org-dentalys', 'e2e-5a-ev', 'salle', 'Salle de réception pour la remise des prix, 80 personnes.', 'sent', now(), $1, 80)`, [claireId]);
    await pgc.query(`insert into "RfqSupplier" ("rfqId", "supplierId") values ('e2e-5a-rfq4', 'demo-sup-belleville'), ('e2e-5a-rfq4', 'demo-sup-tablesdusud')`);
    const sup = await session();
    await login(sup.page, "ludovic.perrin@demo.kolbase.local");
    await sup.page.goto(`${BASE}/organisations/demo-sup-belleville/devis/e2e-5a-rfq4`);
    const dc = sup.page.locator("main");
    await dc.locator('summary:has-text("Décliner la demande")').click();
    await dc.locator('input[name="note"]').fill("Pas de salle disponible à cette date");
    await dc.locator('button:has-text("Décliner")').last().click();
    check("Décliner : confirmation en deux temps", (await dc.locator('button:has-text("Confirmer : décliner la demande")').count()) === 1);
    await dc.locator('button:has-text("Confirmer : décliner la demande")').click();
    await until(async () => (await q1(`select declined from "RfqSupplier" where "rfqId" = 'e2e-5a-rfq4' and "supplierId" = 'demo-sup-belleville'`))?.declined === true);
    const dm = await waitMail(CLAIRE, "Traiteur Belleville décline votre demande de devis");
    check("Décliner : e-mail au client avec le motif", !!dm && dm.text.includes("Motif : Pas de salle disponible à cette date"), dm?.text);
    await org.page.goto(`${BASE}/organisations/demo-org-dentalys/prestataires/e2e-5a-rfq4`);
    const c4 = await org.page.locator("section#rfq-e2e-5a-rfq4").innerText();
    const declinedCard = await org.page.locator('section#rfq-e2e-5a-rfq4 .quote:has-text("Traiteur Belleville")').innerText();
    const waitingCard = await org.page.locator('section#rfq-e2e-5a-rfq4 .quote:has-text("Les Tables du Sud")').innerText();
    check("Demande : « Traiteur Belleville a décliné » et son motif, Les Tables du Sud encore attendu",
      declinedCard.includes("Traiteur Belleville a décliné") && declinedCard.includes("Pas de salle disponible à cette date") && waitingCard.includes("Devis attendu") && /1 a décliné/.test(c4), c4.slice(0, 400));
    await sup.ctx.close();

    // Annuler un événement qui a des inscrits : motif, e-mail, page lisible « Événement annulé », hors de l'agenda.
    const EMMA = "emma.simon@demo.kolbase.local";
    await pgc.query(`insert into "Event" (id, "organizationId", title, "typeId", "startsAt", city, venue, capacity, "publishedAt", "updatedAt")
      values ('e2e-5a-ev2', 'demo-org-dentalys', 'Atelier occlusion 5a', 'symposium', now() + interval '20 days', 'Lyon', 'Salle B (fictive)', 30, now(), now()),
             ('e2e-5a-ev3', 'demo-org-dentalys', 'Soirée retirée 5a', 'symposium', now() + interval '25 days', 'Lyon', 'Salle C (fictive)', 30, now(), now())`);
    await pgc.query(`insert into "AuditLog" (id, "actorId", action, "entityType", "entityId") values ('e2e-5a-pub3', $1, 'event.publish', 'Event', 'e2e-5a-ev3')`, [claireId]);
    await pgc.query(`insert into "EventBenefit" (id, "eventId", "catalogId", label, "valueCents") values ('e2e-5a-b2', 'e2e-5a-ev2', 'cafe', 'Pause café', 600)`);
    await pgc.query(`insert into "Registration" (id, "eventId", "userId", profession) select 'e2e-5a-reg2', 'e2e-5a-ev2', id, 'Chirurgien-dentiste' from "User" where email = $1`, [EMMA]);
    await pgc.query(`insert into "RegistrationBenefit" ("registrationId", "benefitId", "valueCents") values ('e2e-5a-reg2', 'e2e-5a-b2', 600)`);
    const evUrl = `${BASE}/organisations/demo-org-dentalys/evenements/e2e-5a-ev2`;
    await org.page.goto(evUrl);
    check("Événement avec inscrits : « Annuler l'événement » au lieu de « Retirer de l'agenda »",
      (await org.page.locator('button:has-text("Retirer de l")').count()) === 0 && (await org.page.locator('button:has-text("Annuler l\'événement")').count()) === 1);
    const cf = org.page.locator('form:has(input[name="reason"])');
    await cf.locator('input[name="reason"]').fill("Intervenant indisponible");
    await cf.locator('button:has-text("Annuler l\'événement")').click();
    check("Annuler l'événement : confirmation qui annonce l'e-mail aux inscrits", (await cf.innerText()).includes("L'inscrit reçoit un e-mail avec le motif"));
    await cf.locator('button:has-text("Confirmer : annuler l\'événement")').click();
    await until(async () => !!(await q1(`select "cancelledAt" from "Event" where id = 'e2e-5a-ev2'`))?.cancelledAt);
    const ev = await q1(`select e."publishedAt", e."cancelReason", r."cancelledAt" as reg, (select count(*) from "RegistrationBenefit" where "registrationId" = 'e2e-5a-reg2') as benefits from "Event" e join "Registration" r on r."eventId" = e.id where e.id = 'e2e-5a-ev2'`);
    check("Annuler l'événement : inscriptions annulées, hospitalités retirées, hors de l'agenda", !ev.publishedAt && ev.cancelReason === "Intervenant indisponible" && !!ev.reg && Number(ev.benefits) === 0, JSON.stringify(ev));
    const em = await waitMail(EMMA, "Événement annulé : « Atelier occlusion 5a »");
    check("Annuler l'événement : e-mail aux inscrits avec le motif", !!em && em.text.includes("Motif : Intervenant indisponible"), em?.text);
    const anon = await session();
    const pg5 = await anon.page.goto(`${BASE}/evenements/e2e-5a-ev2`);
    const pt = await text(anon.page);
    check("Événement annulé : lisible à son adresse avec la mention, sans inscription", pg5?.status() === 200 && pt.includes("Événement annulé") && pt.includes("Intervenant indisponible") && (await anon.page.locator('a:has-text("m\'inscrire"), button:has-text("M\'inscrire")').count()) === 0, pt.slice(0, 200));
    await anon.page.goto(`${BASE}/evenements`);
    check("Événement annulé : absent de l'agenda", !(await text(anon.page)).includes("Atelier occlusion 5a"));
    await anon.ctx.close();
    const emma = await session();
    await login(emma.page, EMMA);
    await emma.page.goto(`${BASE}/inscriptions`);
    const it = await text(emma.page);
    check("Mes inscriptions : rangée « Annulés par l'organisateur », avec le motif", /Annulés par l'organisateur[\s\S]*Atelier occlusion 5a[\s\S]*Événement annulé/.test(it) && it.includes("Intervenant indisponible"), it.slice(-400));
    await emma.ctx.close();
    await org.page.goto(evUrl);
    check("Fiche de l'organisation : « Annulé », motif, plus d'action de diffusion", (await text(org.page)).includes("Événement annulé le") && (await org.page.locator('.page-hero .pill:has-text("Annulé")').count()) === 1 && (await org.page.locator('button:has-text("Publier dans l"), button:has-text("Annuler l\'événement")').count()) === 0);
    // Sans inscrit : « Retirer de l'agenda » reste possible ; la fiche dit « Retiré de l'agenda », pas « Brouillon ».
    await org.page.goto(`${BASE}/organisations/demo-org-dentalys/evenements/e2e-5a-ev3`);
    await org.page.locator('button:has-text("Retirer de l")').click();
    await until(async () => !(await q1(`select "publishedAt" from "Event" where id = 'e2e-5a-ev3'`))?.publishedAt);
    await org.page.reload();
    const wt = await org.page.locator(".page-hero .pill").first().innerText();
    check("Retiré de l'agenda (sans inscrit) : « Retiré de l'agenda », pas « Brouillon »", wt.includes("Retiré de l'agenda") && !(await text(org.page)).includes("Brouillon :"), wt);

    // Suppression du compte d'un expert : retiré du dossier non signé, équipe Projets prévenue, dossier non soumettable.
    await pgc.query(`insert into "Project" (id, "organizationId", title, "typeId", status, "createdById", "updatedAt") values ('e2e-5a-prj3', 'demo-org-dentalys', 'Board 5a esthétique', 'advisory', 'ACCORD', $1, now())`, [claireId]);
    await pgc.query(`insert into "ProjectExpert" (id, "projectId", "practitionerId", status, "feeCents", days, "respondedAt") values
      ('e2e-5a-l3-blanc', 'e2e-5a-prj3', 'demo-p-blanc', 'ACCORD', 150000, 1, now()), ('e2e-5a-l3-moreau', 'e2e-5a-prj3', 'demo-p-moreau', 'ATT_EXPERTS', 150000, 1, null)`);
    const bl = await session();
    await login(bl.page, "nicolas.blanc@demo.kolbase.local");
    await bl.page.goto(`${BASE}/compte`);
    await bl.page.click('summary:has-text("Supprimer mon compte")');
    const del = 'form:has(button:has-text("Supprimer définitivement"))';
    await bl.page.fill(`${del} input[name="password"]`, PW);
    await bl.page.check(`${del} input[name="confirm"]`);
    await Promise.all([bl.page.waitForURL(/compte=supprime/), bl.page.click(`${del} button`)]);
    await bl.ctx.close();
    const gone = await q1(`select pe.status, pe."responseNote", p.status as project from "ProjectExpert" pe join "Project" p on p.id = pe."projectId" where pe.id = 'e2e-5a-l3-blanc'`);
    check("Compte supprimé : expert retiré du dossier non signé, dossier en attente des experts", gone?.status === "DECLINE" && gone.responseNote === "Compte supprimé" && gone.project === "ATT_EXPERTS", JSON.stringify(gone));
    const rm = await waitMail(CLAIRE, /Nicolas Blanc a supprimé son compte — Board 5a esthétique/);
    check("Compte supprimé : e-mail à l'équipe Projets", !!rm && rm.text.includes("revient en attente des experts"), rm?.text);
    await org.page.goto(`${BASE}/organisations/demo-org-dentalys/dossiers/e2e-5a-prj3`);
    const noSubmit = (await org.page.locator('form:has(input[value="submit"])').count()) === 0;
    await tab(org.page, "experts");
    check("Compte supprimé : dossier plus soumettable, expert signalé", noSubmit && (await text(org.page)).includes("Retiré : compte supprimé"));
    await org.ctx.close();
  }

  // 3. Négociation des honoraires : l'expert propose d'autres honoraires, l'organisation les accepte ou renvoie une offre.
  {
    const MOREAU = "vincent.moreau@demo.kolbase.local";
    const LEMOINE = "julie.lemoine@demo.kolbase.local";
    const claireId = (await q1(`select id from "User" where email = $1`, [CLAIRE])).id;
    await pgc.query(`insert into "Project" (id, "organizationId", title, "typeId", status, "createdById", "updatedAt") values ('e2e-5a-prj4', 'demo-org-dentalys', 'Board 5a négociation', 'advisory', 'ATT_EXPERTS', $1, now())`, [claireId]);
    await pgc.query(`insert into "ProjectExpert" (id, "projectId", "practitionerId", status, "feeCents", days) values ('e2e-5a-l4', 'e2e-5a-prj4', 'demo-p-moreau', 'ATT_EXPERTS', 150000, 1)`);
    const dossier = `${BASE}/organisations/demo-org-dentalys/dossiers/e2e-5a-prj4`;
    const org = await session();
    await login(org.page, CLAIRE);
    // Premier e-mail de sollicitation : le nombre d'unités.
    await org.page.goto(`${dossier}?modifier=1`);
    await org.page.selectOption('#modifier select[name="expertId"]', "demo-p-lemoine");
    await org.page.fill('#modifier form:has(select[name="expertId"]) input[name="units"]', "2");
    await org.page.fill('#modifier form:has(select[name="expertId"]) input[name="fee"]', "1500");
    await org.page.click('button:has-text("Ajouter et solliciter l\'expert")');
    await until(async () => !!(await q1(`select id from "ProjectExpert" where "projectId" = 'e2e-5a-prj4' and "practitionerId" = 'demo-p-lemoine'`)));
    const solMail = await waitMail(LEMOINE, /Nouvelle sollicitation de Dentalys Implants/);
    const fresh = mails.filter((m) => m.to === LEMOINE && m.subject.includes("Nouvelle sollicitation de Dentalys Implants")).at(-1);
    check("Première sollicitation : nombre d'unités et honoraires dans l'e-mail", !!solMail && fresh.text.includes("Prestation : 2 journées.") && /Honoraires proposés : 1\s500\s€ HT/.test(fresh.text), fresh?.text);

    // L'expert : un montant avec « Accepter » est refusé ; « Proposer d'autres honoraires » laisse la sollicitation ouverte.
    const mor = await session();
    await login(mor.page, MOREAU);
    await mor.page.goto(`${BASE}/sollicitations/e2e-5a-l4`);
    const form = mor.page.locator('section.highlight form');
    check("Expert : trois réponses (accord, autres honoraires, déclin) et ce qu'elles font",
      (await form.locator('button:has-text("Donner mon accord de principe")').count()) === 1 && (await form.locator('button:has-text("Proposer d\'autres honoraires")').count()) === 1 && (await form.locator('button:has-text("Décliner")').count()) === 1
      && (await form.innerText()).includes("la sollicitation reste ouverte"));
    await form.locator('input[name="desiredFee"]').fill("1800");
    await form.locator('button:has-text("Donner mon accord de principe")').click();
    await form.locator(".notice.error").waitFor({ timeout: 4000 }).catch(() => {});
    check("Expert : un montant avec « Accepter » est refusé (pas d'accord au montant refusé)", (await form.innerText()).includes("choisissez « Proposer d'autres honoraires »") && (await q1(`select status from "ProjectExpert" where id = 'e2e-5a-l4'`)).status === "ATT_EXPERTS");
    await form.locator('textarea[name="note"]').fill("Deux demi-journées de préparation sont à prévoir.");
    await form.locator('button:has-text("Proposer d\'autres honoraires")').click();
    await until(async () => (await q1(`select "desiredFeeCents" from "ProjectExpert" where id = 'e2e-5a-l4'`))?.desiredFeeCents === 180000);
    const cp = await q1(`select pe.status, pe."desiredFeeCents", p.status as project from "ProjectExpert" pe join "Project" p on p.id = pe."projectId" where pe.id = 'e2e-5a-l4'`);
    check("Contre-proposition : sollicitation ouverte, dossier pas « Décliné »", cp.status === "ATT_EXPERTS" && cp.desiredFeeCents === 180000 && cp.project === "ATT_EXPERTS", JSON.stringify(cp));
    const cpm = await waitMail(CLAIRE, "Dr Vincent Moreau propose d'autres honoraires — Board 5a négociation");
    check("Contre-proposition : e-mail à l'équipe Projets (ancien et nouveau montant, message)", !!cpm && /1\s500\s€ → 1\s800\s€ HT/.test(cpm.text) && cpm.text.includes("Deux demi-journées"), cpm?.text);
    await mor.page.goto(`${BASE}/sollicitations`);
    check("Contre-proposition : « Contre-proposition envoyée » dans la liste de l'expert", (await mor.page.locator('a.row-item:has-text("Board 5a négociation")').innerText()).includes("Contre-proposition envoyée"));

    // L'organisation : tâche, carte, « Accepter ces honoraires » ; l'expert est engagé et prévenu.
    await org.page.goto(`${BASE}/organisations/demo-org-dentalys`);
    check("Accueil de l'organisation : honoraires proposés par un expert à traiter", (await text(org.page)).includes("Honoraires proposés par un expert : Board 5a négociation"));
    await org.page.goto(`${dossier}?onglet=experts`);
    const card = org.page.locator('article.expert-card:has-text("Vincent Moreau")');
    const ct = await card.innerText();
    check("Dossier : contre-proposition visible avec les deux montants", ct.includes("Contre-proposition") && /1\s500\s€ → 1\s800\s€ HT/.test(ct), ct.slice(0, 300));
    await confirmClick(card, "Accepter ces honoraires");
    // L'expert puis le dossier sont mis à jour l'un après l'autre : attendre les deux, sinon la lecture tombe entre les deux.
    await until(async () => (await q1(`select pe.status, p.status as project from "ProjectExpert" pe join "Project" p on p.id = pe."projectId" where pe.id = 'e2e-5a-l4'`))?.project === "ACCORD");
    const acc = await q1(`select pe.status, pe."feeCents", pe."previousFeeCents", pe."desiredFeeCents", p.status as project from "ProjectExpert" pe join "Project" p on p.id = pe."projectId" where pe.id = 'e2e-5a-l4'`);
    check("Accepter ces honoraires : montant de l'expert, expert engagé", acc.status === "ACCORD" && acc.feeCents === 180000 && acc.previousFeeCents === 150000 && acc.desiredFeeCents === null && acc.project === "ACCORD", JSON.stringify(acc));
    const am = await waitMail(MOREAU, "Honoraires acceptés : Board 5a négociation");
    check("Accepter ces honoraires : e-mail à l'expert (1 500 € → 1 800 € HT)", !!am && /1\s500\s€ → 1\s800\s€ HT/.test(am.text), am?.text);
    await mor.page.goto(`${BASE}/sollicitations/e2e-5a-l4`);
    check("Page de l'expert : ancien montant rappelé", /1\s500\s€ → 1\s800\s€ HT/.test(await text(mor.page)));
    await mor.ctx.close();

    // « Proposer ces conditions » : confirmation visible ; l'e-mail et la page de l'expert rappellent l'ancien montant.
    await org.page.goto(`${dossier}?modifier=1`);
    const tf = org.page.locator('#modifier form.terms-form:has-text("Julie Lemoine")');
    await tf.locator('input[name="fee"]').fill("1700");
    await tf.locator('button:has-text("Proposer ces conditions")').click();
    await tf.locator(".notice.ok").waitFor({ timeout: 5000 }).catch(() => {});
    check("« Proposer ces conditions » : message de confirmation visible", (await tf.innerText()).includes("Nouvelle proposition envoyée à l'expert"), await tf.innerText());
    const np = await waitMail(LEMOINE, "Nouvelle proposition de Dentalys Implants");
    check("Nouvelle proposition : l'e-mail rappelle l'ancien montant", !!np && /1\s500\s€ → 1\s700\s€ HT/.test(np.text), np?.text);
    const lem = await session();
    await login(lem.page, LEMOINE);
    const lid = (await q1(`select id from "ProjectExpert" where "projectId" = 'e2e-5a-prj4' and "practitionerId" = 'demo-p-lemoine'`)).id;
    await lem.page.goto(`${BASE}/sollicitations/${lid}`);
    check("Nouvelle proposition : la page de l'expert rappelle l'ancien montant", /1\s500\s€ → 1\s700\s€ HT/.test(await text(lem.page)));
    await lem.ctx.close();

    // Soumettre avec une réponse attendue : confirmation qui l'annonce, l'expert reçoit « Recrutement clos ».
    await org.page.goto(dossier);
    const sub = org.page.locator('form:has(input[value="submit"])');
    await sub.locator('button:has-text("Soumettre à la conformité")').click();
    check("Soumettre : « 1 réponse attendue sera close » annoncé", (await sub.innerText()).includes("1 réponse attendue sera close") && (await sub.innerText()).includes("Julie Lemoine"), await sub.innerText());
    await sub.locator('button:has-text("Confirmer")').click();
    await until(async () => (await q1(`select status from "Project" where id = 'e2e-5a-prj4'`))?.status === "EN_VALID");
    check("Soumettre : l'offre renvoyée est close, l'experte prévenue", !!(await waitMail(LEMOINE, "Recrutement clos : Board 5a négociation")));
    await org.ctx.close();
  }

  await pgc.end();
}

// ── Lot 5b : entrée, chiffres de l'événement, administration, finitions ──
{
  const pgc = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await pgc.connect();
  const q1 = async (sql, args = []) => (await pgc.query(sql, args)).rows[0];
  const until = async (fn, ms = 6000) => {
    for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 150))) if (await fn()) return true;
    return false;
  };
  const CLAIRE = "claire.morel@demo.kolbase.local";
  /** E-mail reçu depuis un repère (les blocs précédents ont pu envoyer un e-mail de même sujet). */
  const mailSince = async (from, to, subject, timeout = 8000) => {
    for (const end = Date.now() + timeout; Date.now() < end; await new Promise((r) => setTimeout(r, 200))) {
      const m = mails.slice(from).find((x) => x.to === to && x.subject.includes(subject));
      if (m) return m;
    }
    return null;
  };
  /** Création de compte depuis la page ouverte (formulaire déjà affiché). */
  const signUpHere = async (page, first, last, email, password = "lot5b-mot-de-passe-1") => {
    await page.fill('input[name="firstName"]', first);
    await page.fill('input[name="lastName"]', last);
    if (email) await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', password);
    await page.check('input[name="cgu"]');
    await page.click('button:has-text("Créer mon compte")');
    await Promise.race([
      page.waitForURL((u) => u.pathname !== "/inscription", { timeout: 15000 }),
      page.locator("main .notice.error").waitFor({ timeout: 15000 }),
    ]).catch(() => {});
    await page.waitForTimeout(300);
  };

  // 1. Entrée : page d'origine gardée par l'en-tête, le mot de passe oublié et l'invitation ; profil et saisie gardés.
  {
    const a = await session();
    await a.page.goto(`${BASE}/evenements`);
    check("En-tête public : « Se connecter » et « Se référencer » gardent la page courante",
      (await a.page.locator('header.public-nav .nav-actions a:has-text("Se connecter")').first().getAttribute("href")) === "/connexion?next=%2Fevenements" &&
      (await a.page.locator('header.public-nav .nav-actions a:has-text("Se référencer")').first().getAttribute("href")) === "/inscription?next=%2Fevenements");
    await a.page.goto(`${BASE}/connexion?next=%2Fevenements`);
    check("En-tête public sur la connexion : pas de retour vers une page d'authentification", (await a.page.locator('header.public-nav .nav-actions a:has-text("Se connecter")').first().getAttribute("href")) === "/connexion");
    // Mot de passe oublié → retour à la connexion → page d'origine après le nouveau mot de passe.
    const forgot = await a.page.locator('main a:has-text("Mot de passe oublié")').getAttribute("href");
    check("Connexion : « Mot de passe oublié » garde next", forgot === "/mot-de-passe-oublie?next=%2Fevenements", forgot);
    await a.page.goto(`${BASE}${forgot}`);
    check("Mot de passe oublié : « Retour à la connexion » garde next", (await a.page.locator('main a:has-text("Retour à la connexion")').getAttribute("href")) === "/connexion?next=%2Fevenements");
    await a.ctx.close();
    const m = await session();
    await m.page.goto(`${BASE}/inscription`);
    await signUpHere(m.page, "Romane", "Lot5b", "romane.lot5b@exemple.fr");
    await m.ctx.close();
    const r = await session();
    await r.page.goto(`${BASE}/mot-de-passe-oublie?next=%2Fevenements`);
    await r.page.fill('input[name="email"]', "romane.lot5b@exemple.fr");
    await r.page.click('button:has-text("Recevoir le lien")');
    const reset = await waitMail("romane.lot5b@exemple.fr", "Réinitialiser votre mot de passe");
    await r.page.goto(linkIn(reset));
    await r.page.fill('input[name="password"]', "lot5b-mot-de-passe-2");
    await r.page.fill('input[name="confirm"]', "lot5b-mot-de-passe-2");
    await Promise.all([r.page.waitForURL((u) => !u.pathname.startsWith("/mot-de-passe"), { timeout: 15000 }).catch(() => {}), r.page.click('button:has-text("Enregistrer et me connecter")')]);
    check("Nouveau mot de passe : retour à la page d'origine", r.page.url() === `${BASE}/evenements`, r.page.url());
    await r.ctx.close();
    // Mauvais mot de passe : l'adresse reste saisie.
    const w = await session();
    await login(w.page, "romane.lot5b@exemple.fr", "mauvais-mot-de-passe-5b");
    check("Connexion refusée : l'adresse saisie reste", (await w.page.inputValue('input[name="email"]')) === "romane.lot5b@exemple.fr" && (await text(w.page)).includes("E-mail ou mot de passe incorrect"));
    // Lettre d'information : réservée aux praticiens (inscription organisation, Mon compte d'un compte organisation).
    await w.page.goto(`${BASE}/inscription?profil=organisation`);
    check("Inscription organisation : nom et type de la structure demandés", (await w.page.locator('input[name="orgName"]').count()) === 1 && (await w.page.locator('select[name="orgKind"]').count()) === 1);
    const orgNews = await w.page.locator('input[name="newsletter"]').count();
    await w.page.selectOption('select[name="profession"]', "Chirurgien-dentiste");
    check("Inscription : lettre d'information proposée au praticien seulement", orgNews === 0 && (await w.page.locator('input[name="newsletter"]').count()) === 1);
    await w.ctx.close();
    // « Se référencer » pour une structure : son nom et son type sont repris à l'étape suivante (sa fiche).
    const st = await session();
    await st.page.goto(`${BASE}/inscription?profil=organisation`);
    await st.page.fill('input[name="orgName"]', "Traiteur Lot5b");
    await st.page.selectOption('select[name="orgKind"]', "PRESTATAIRE");
    await signUpHere(st.page, "Paul", "Lot5b", "paul.lot5b@exemple.fr");
    check("Inscription d'une structure : étape 2 préremplie (nom, type)", st.page.url().includes("/organisations/nouvelle?") && (await st.page.inputValue('input[name="name"]')) === "Traiteur Lot5b" && (await st.page.inputValue('select[name="kind"]')) === "PRESTATAIRE" && (await st.page.locator('.eyebrow-sm:has-text("Étape 2 sur 2")').count()) === 1, st.page.url());
    await st.ctx.close();
    const cl = await session();
    await login(cl.page, CLAIRE);
    await cl.page.goto(`${BASE}/compte`);
    check("Mon compte sans profil praticien : pas de case pour la lettre", (await cl.page.locator('#notifications input[name="newsletter"]').count()) === 0);
    // Invitation nominative : profil gardé, adresse préremplie, acceptation qui confirme l'adresse.
    await cl.page.goto(`${BASE}/organisations/demo-org-dentalys/membres`);
    const form = 'form:has(h2:has-text("Inviter un membre"))';
    const invite = async (email) => {
      await cl.page.fill(`${form} input[name="email"]`, email);
      await cl.page.click(`${form} button:has-text("Générer le lien")`);
      const mail = await waitMail(email, "vous invite à rejoindre");
      return linkIn(mail);
    };
    const linkA = await invite("lot5b.invitee@exemple.fr");
    const linkB = await invite("lot5b.confirmee@exemple.fr");
    await cl.ctx.close();
    const inv = await session();
    await inv.page.goto(linkA);
    await inv.page.click('main a:has-text("Se connecter pour accepter")');
    await inv.page.waitForURL(/\/connexion/);
    const toSignUp = await inv.page.locator('main a:has-text("Créer un compte")').getAttribute("href");
    check("Invitation → connexion → « Créer un compte » : profil organisation gardé", toSignUp.startsWith("/inscription?profil=organisation&next=%2Finvitation%2F"), toSignUp);
    await inv.page.goto(`${BASE}${toSignUp}`);
    check("Invitation : adresse invitée préremplie", (await inv.page.inputValue('input[name="email"]')) === "lot5b.invitee@exemple.fr" && (await inv.page.locator('input[name="newsletter"]').count()) === 0);
    await signUpHere(inv.page, "Inès", "Invitée", "");
    check("Invitation : retour à l'invitation après la création du compte, acceptation possible", inv.page.url().includes("/invitation/") && (await inv.page.locator('button:has-text("Accepter l\'invitation")').count()) === 1 && !(await text(inv.page)).includes("Confirmez d'abord"), inv.page.url());
    const verifyA = await waitMail("lot5b.invitee@exemple.fr", "Confirmez votre adresse");
    check("E-mail de confirmation d'un compte organisation : pas de lettre d'information", !!verifyA && !verifyA.text.includes("lettre d'information") && verifyA.text.includes("C'est à cette adresse que KolBase vous écrit"), verifyA?.text.slice(0, 200));
    await Promise.all([inv.page.waitForURL(/\/organisations\/demo-org-dentalys/), inv.page.click('button:has-text("Accepter l\'invitation")')]);
    const ua = await q1(`select u."emailVerifiedAt" v, (select count(*)::int from "Membership" m where m."userId" = u.id and m."organizationId" = 'demo-org-dentalys') n from "User" u where email = 'lot5b.invitee@exemple.fr'`);
    check("Invitation nominative acceptée : membre et adresse confirmée", ua?.n === 1 && !!ua?.v, JSON.stringify(ua));
    await inv.ctx.close();
    // Autre invité : le lien de confirmation ramène à l'invitation.
    const b = await session();
    await b.page.goto(linkB);
    await b.page.goto(`${BASE}${await b.page.locator('main a:has-text("Créer un compte")').getAttribute("href")}`);
    await signUpHere(b.page, "Basile", "Confirmé", "");
    const verifyB = await waitMail("lot5b.confirmee@exemple.fr", "Confirmez votre adresse");
    await b.page.goto(`${BASE}/compte`);
    await b.page.goto(linkIn(verifyB));
    check("Lien de confirmation : retour à l'invitation", b.page.url().includes("/invitation/") && (await b.page.locator('button:has-text("Accepter l\'invitation")').count()) === 1, b.page.url());
    await b.ctx.close();
    // Création de comptes : limite par adresse e-mail (essais répétés), la limite par adresse IP laisse passer un congrès.
    const s = await session();
    let last = "";
    for (let i = 0; i < 6; i++) {
      await s.page.goto(`${BASE}/inscription`);
      await signUpHere(s.page, "Romane", "Lot5b", "romane.lot5b@exemple.fr");
      last = await text(s.page);
    }
    check("Création de comptes : essais répétés sur une même adresse limités", last.includes("Trop de tentatives"), last.match(/Trop de tentatives[^.]*\.|Un compte existe[^.]*\./)?.[0]);
    await s.ctx.close();
    // Mobile : bouton « Se connecter » visible sans défilement, « Se référencer » en tête de la rangée de liens.
    const mob = await browser.newContext({ locale: "fr-FR", viewport: { width: 390, height: 844 } });
    const mp = await mob.newPage();
    await mp.goto(`${BASE}/experts`);
    const signInBtn = mp.locator('header.public-nav .nav-actions a.btn.mobile-only');
    const box = await signInBtn.boundingBox();
    const signUpBox = await mp.locator('header.public-nav nav a:has-text("Se référencer")').boundingBox();
    check("Mobile : bouton « Se connecter » visible sans défiler, avec la page d'origine", !!box && box.x >= 0 && box.x + box.width <= 390 && (await signInBtn.innerText()) === "Se connecter" && (await signInBtn.getAttribute("href")) === "/connexion?next=%2Fexperts", JSON.stringify(box));
    check("Mobile : « Se référencer » visible sans défiler", !!signUpBox && signUpBox.x >= 0 && signUpBox.x + signUpBox.width <= 390, JSON.stringify(signUpBox));
    await mob.close();
  }

  // 2. Chiffres de l'événement : une règle de présence, coût par couvert, TVA par ligne, collaborations signées.
  {
    const n = (s) => s.replace(/\s+/g, " ");
    const cl = await session();
    await login(cl.page, CLAIRE);
    await cl.page.goto(`${BASE}/organisations/demo-org-dentalys/evenements/demo-ev-passe`);
    const head = n(await cl.page.locator("header.page-hero").innerText());
    const bilan = n(await cl.page.locator("section.bilan").innerText());
    const hHead = head.match(/Hospitalités ([\d ,]+) € TTC/i)?.[1];
    const hBilan = bilan.match(/Hospitalités ([\d ,]+) € TTC/i)?.[1];
    check("Événement passé : en-tête et bilan, mêmes hospitalités (absents exclus)", !!hHead && hHead === hBilan && /bénéficiaires? présents? · consommées/i.test(head), `${head.match(/Hospitalités[^·]*·[^·]*/i)?.[0]} / ${hBilan}`);
    const logi = n(await cl.page.locator('section:has(h2:has-text("Logistique et prestataires"))').innerText());
    check("Événement passé : prix par couvert commandé, coût par présent pour information", logi.includes("par couvert commandé") && /Pour information : [\d ,]+ € TTC par présent/.test(logi), logi.slice(0, 300));
    const applies = await cl.page.locator("form.apply-benefit").allInnerTexts();
    check("Report dans la valeur déclarée : le prix par couvert, plus le coût réel par présent", applies.every((x) => x.includes("prix par couvert") && !x.includes("coût réel")), applies.join(" | ").slice(0, 200));
    // Statistiques : effectif = présents, hospitalités (TTC) et prestataires (HT) jamais additionnés ; « engagé » expliqué.
    await cl.page.goto(`${BASE}/organisations/demo-org-dentalys/statistiques`);
    // Texte lu en minuscules : en-têtes et intitulés sont en capitales par la feuille de style.
    const st = n(await text(cl.page)).toLowerCase();
    const thead = n(await cl.page.locator(".stats-table thead").first().innerText()).toLowerCase();
    // Coût par présent sous chaque total (deux colonnes de moins : le tableau tient dans la page).
    const tbody = n(await cl.page.locator(".stats-table tbody").first().innerText()).toLowerCase();
    check("Statistiques : par présent, HT et TTC séparés", thead.includes("hospitalités (ttc)") && thead.includes("prestataires (ht)") && tbody.includes("par présent") && st.includes("budget engagé (ht)"), thead);
    check("Statistiques : définition d'« engagé » en bas de page", st.includes("engagé : l'expert a accepté la proposition"));
    // TVA par ligne : repas à 10 %, vin à 20 % ; meilleure offre sur le TTC.
    await pgc.query(`insert into "Subscription" ("organizationId", plan, status, "exemptUntil", "updatedAt") values ('demo-sup-belleville', 'prestataire', 'a_activer', '2099-12-31', now()) on conflict ("organizationId") do update set "exemptUntil" = '2099-12-31'`);
    await pgc.query(`insert into "Rfq" (id, "organizationId", category, needs, status, "sentAt", headcount, city) values ('e2e-5b-rfq-tva', 'demo-org-dentalys', 'restauration', 'Dîner 5b avec vins pour 20 personnes.', 'sent', now(), 20, 'Lyon')`);
    await pgc.query(`insert into "RfqSupplier" ("rfqId", "supplierId") values ('e2e-5b-rfq-tva', 'demo-sup-belleville'), ('e2e-5b-rfq-tva', 'demo-sup-tablesdusud')`);
    // Concurrent : moins cher hors taxes, plus cher toutes taxes comprises (tout à 20 %).
    await pgc.query(`insert into "Quote" (id, "rfqId", "supplierId", "amountCents", "vatBp", "updatedAt") values ('e2e-5b-q-tds', 'e2e-5b-rfq-tva', 'demo-sup-tablesdusud', 79000, 2000, now())`);
    const sup = await session();
    await login(sup.page, "ludovic.perrin@demo.kolbase.local");
    await sup.page.goto(`${BASE}/organisations/demo-sup-belleville/devis/e2e-5b-rfq-tva`);
    const card = sup.page.locator("main");
    check("Devis : taux de la ligne proposé selon la catégorie (10 %)", (await card.locator('select[name="line_vat"]').first().inputValue()) === "1000");
    await card.locator('input[name="line_label"]').first().fill("Dîner assis 3 plats");
    await card.locator('input[name="line_qty"]').first().fill("20");
    await card.locator('input[name="line_unit"]').first().fill("35");
    await card.locator('button:has-text("Ajouter une ligne")').click();
    await card.locator('input[name="line_label"]').nth(1).fill("Vins (bouteilles)");
    await card.locator('input[name="line_qty"]').nth(1).fill("10");
    await card.locator('input[name="line_unit"]').nth(1).fill("10");
    await card.locator('select[name="line_vat"]').nth(1).selectOption("2000");
    const totals = n(await card.locator(".quote-totals").innerText());
    await card.locator('button:has-text("Envoyer le devis")').click();
    await until(async () => !!(await q1(`select id from "Quote" where "rfqId" = 'e2e-5b-rfq-tva' and "supplierId" = 'demo-sup-belleville'`)));
    const qb = await q1(`select "amountCents" a, "ttcCents" t, "vatBp" v, lines from "Quote" where "rfqId" = 'e2e-5b-rfq-tva' and "supplierId" = 'demo-sup-belleville'`);
    // 700 € HT à 10 % + 100 € HT à 20 % = 770 + 120 = 890 € TTC.
    check("Devis : chaque ligne à son taux, TTC = somme des lignes", qb?.a === 80000 && qb?.t === 89000 && qb?.v === 1000 && qb?.lines?.[1]?.vatBp === 2000 && /TTC\s*890,00/.test(totals), `${JSON.stringify({ a: qb?.a, t: qb?.t, v: qb?.v })} ${totals}`);
    await sup.ctx.close();
    await cl.page.goto(`${BASE}/organisations/demo-org-dentalys/prestataires/e2e-5b-rfq-tva`);
    const rfq = cl.page.locator("section#rfq-e2e-5b-rfq-tva");
    const best = n(await rfq.locator(".quote.best").innerText().catch(() => ""));
    check("Comparaison : meilleure offre sur le TTC, taux par ligne affichés", best.includes("Traiteur Belleville") && best.includes("890 € TTC") && best.includes("TVA 10 % et 20 %"), best.slice(0, 200));
    // Cartes publiques : collaborations signées seulement (comme les fiches).
    const signedOrg = (await q1(`select count(*)::int n from "Project" where "organizationId" = 'demo-org-dentalys' and status in ('SIGNE', 'TERMINE')`)).n;
    const signedExpert = (await q1(`select count(*)::int n from "ProjectExpert" where "practitionerId" = 'demo-p-martin' and status in ('SIGNE', 'TERMINE')`)).n;
    const anon = await session();
    await anon.page.goto(`${BASE}/experts`);
    const kc = n(await anon.page.locator('a.kol-card[href="/experts/demo-p-martin"]').innerText());
    await anon.page.goto(`${BASE}/structures`);
    const oc = n(await anon.page.locator('a[href="/structures/demo-org-dentalys"]').first().innerText());
    check("Cartes publiques : collaborations signées seulement", kc.includes(`${signedExpert} collaboration`) && oc.includes(`${signedOrg} collaboration`), `${kc.match(/\d+ collaborations?/)?.[0]} (${signedExpert}) / ${oc.match(/\d+ collaborations?/)?.[0]} (${signedOrg})`);
    // Book public : références passées seulement, avis sans le nom du client.
    await pgc.query(`insert into "Rfq" (id, "organizationId", "eventId", category, needs, status, "sentAt", headcount) values ('e2e-5b-rfq-futur', 'demo-org-dentalys', 'demo-ev-soiree-implanto', 'restauration', 'Cocktail futur 5b.', 'awarded', now(), 30)`);
    await pgc.query(`insert into "Quote" (id, "rfqId", "supplierId", "amountCents", "vatBp", status, "updatedAt") values ('e2e-5b-q-futur', 'e2e-5b-rfq-futur', 'demo-sup-belleville', 90000, 1000, 'retained', now())`);
    const past = (await q1(`select count(*)::int n from "Quote" q join "Rfq" r on r.id = q."rfqId" left join "Event" e on e.id = r."eventId" where q."supplierId" = 'demo-sup-belleville' and q.status = 'retained' and coalesce(e."startsAt", r."sentAt", q."createdAt") < now()`)).n;
    await anon.page.goto(`${BASE}/structures/demo-sup-belleville`);
    const book = n(await text(anon.page));
    const done = book.match(/(\d+) Prestations réalisées via KolBase/i)?.[1];
    const reviews = n(await anon.page.locator('section:has(h2:has-text("Avis vérifiés"))').innerText());
    check("Book public : prestations passées seulement", done === String(past), `${done} / ${past}`);
    check("Book public : avis sans le nom du client", !reviews.includes("Dentalys") && reviews.includes("Organisation cliente") && reviews.includes("le nom des clients n'est pas affiché"), reviews.slice(0, 200));
    await pgc.query(`delete from "Quote" where id = 'e2e-5b-q-futur'`);
    await pgc.query(`delete from "Rfq" where id = 'e2e-5b-rfq-futur'`);
    await anon.ctx.close();
    await cl.ctx.close();
    // Revenus : export avec le statut de chaque ligne.
    const ex = await session();
    await login(ex.page, "antoine.martin@demo.kolbase.local");
    const csv = await (await ex.ctx.request.get(`${BASE}/revenus/export?annee=${new Date().getFullYear()}`)).text();
    check("Revenus : export CSV avec une colonne Statut", csv.split("\n")[0].includes("Statut") && /payé|convention signée|Accord|Signé/i.test(csv), csv.split("\n").slice(0, 2).join(" | "));
    await ex.ctx.close();
  }

  // 3. Administration : suspension (facturation en pause, inscrits, statut), gratuité, lancement, e-mailing, pack, motifs.
  {
    const adm = await session();
    await login(adm.page, "anne.chevalier@demo.kolbase.local");
    const subId = "sub_e2e5bsusp";
    stripeState.subscriptions.set(subId, { id: subId, object: "subscription", customer: "cus_e2e5b", status: "active", trial_end: null, current_period_end: Math.floor(Date.now() / 1000) + 20 * 86400, cancel_at_period_end: false, metadata: { orgId: "demo-org-cdra" }, pause_collection: null });
    await pgc.query(`insert into "Subscription" ("organizationId", plan, status, "stripeCustomerId", "stripeSubscriptionId", "updatedAt") values ('demo-org-cdra', 'organisation', 'active', 'cus_e2e5b', $1, now())
      on conflict ("organizationId") do update set status = 'active', "stripeCustomerId" = 'cus_e2e5b', "stripeSubscriptionId" = $1, "exemptUntil" = null, "exemptNote" = null`, [subId]);
    await adm.page.goto(`${BASE}/admin/organisations/demo-org-cdra`);
    const mark = mails.length;
    const card = () => adm.page.locator('section.card:has-text("Collège Dentaire Rhône-Alpes")').first();
    await card().locator('form:has(button:has-text("Suspendre")) input[name="note"]').fill("Vérification de l'identité.");
    await card().locator('button:has-text("Suspendre")').click();
    check("Suspension : la confirmation annonce la pause de la facturation", (await card().locator(".confirm-step").innerText()).includes("facturation de l'abonnement est mise en pause"));
    await card().locator('button:has-text("Confirmer : suspendre")').click();
    await until(async () => (await q1(`select verification from "Organization" where id = 'demo-org-cdra'`)).verification === "SUSPENDED");
    await until(async () => !!stripeState.subscriptions.get(subId).pause_collection);
    const paused = stripeState.subscriptions.get(subId).pause_collection;
    check("Suspension : facturation Stripe en pause, sans date de reprise", paused?.behavior === "void" && !paused.resumes_at, JSON.stringify(paused));
    const smail = await mailSince(mark, "pierre.vidal@demo.kolbase.local", "Collège Dentaire Rhône-Alpes est suspendue");
    check("E-mail de suspension : facturation en pause", !!smail && smail.text.includes("La facturation de votre abonnement est mise en pause"), smail?.text.slice(0, 300));
    await adm.page.goto(`${BASE}/admin/organisations/demo-org-cdra`);
    check("Organisation suspendue : pas de « Refuser »", (await card().locator('button:has-text("Refuser")').count()) === 0 && (await card().locator('button:has-text("Réactiver")').count()) === 1);
    const jl = await session();
    await login(jl.page, "julie.lemoine@demo.kolbase.local");
    await jl.page.goto(`${BASE}/inscriptions`);
    const tile = jl.page.locator('.reg-tile:has-text("Journée scientifique du Collège")');
    check("Inscrit d'une organisation suspendue : « Événement momentanément indisponible », sans lien", (await tile.innerText()).includes("Événement momentanément indisponible") && (await tile.locator('a[href="/evenements/demo-ev-journee-cdra"]').count()) === 0);
    await jl.ctx.close();
    const pv = await session();
    await login(pv.page, "pierre.vidal@demo.kolbase.local");
    await pv.page.goto(`${BASE}/organisations/demo-org-cdra/evenements`);
    check("Organisation suspendue : événement « Masqué (organisation suspendue) »", (await pv.page.locator('a.row-item:has-text("Journée scientifique du Collège")').innerText()).includes("Masqué (organisation suspendue)"));
    await pv.page.goto(`${BASE}/organisations/demo-org-cdra`);
    const home = await text(pv.page);
    check("Motif de suspension : pas de double point", home.includes("Organisation suspendue : Vérification de l'identité. Votre page") && !home.includes(".."), home.match(/Organisation suspendue[^\n]{0,60}/)?.[0]);
    await adm.page.goto(`${BASE}/admin/organisations/demo-org-cdra`);
    await card().locator('button:has-text("Réactiver")').click();
    await until(async () => (await q1(`select verification from "Organization" where id = 'demo-org-cdra'`)).verification === "VERIFIED");
    await until(async () => stripeState.subscriptions.get(subId).pause_collection === null);
    check("Réactivation : la facturation reprend", stripeState.subscriptions.get(subId).pause_collection === null);
    const rmail = await mailSince(mark, "pierre.vidal@demo.kolbase.local", "Collège Dentaire Rhône-Alpes est de nouveau active");
    check("E-mail de réactivation : la facturation reprend", !!rmail && rmail.text.includes("La facturation de votre abonnement reprend"), rmail?.text.slice(-200));
    await pgc.query(`delete from "Subscription" where "organizationId" = 'demo-org-cdra' and "stripeSubscriptionId" = $1`, [subId]);
    await pv.ctx.close();
    // Gratuité : date au plus tôt aujourd'hui ; date passée refusée avec un message.
    await adm.page.goto(`${BASE}/admin?onglet=abonnements`);
    const row = adm.page.locator('tr:has-text("Collège Dentaire Rhône-Alpes")');
    const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
    check("Gratuité : champ date avec un minimum (aujourd'hui)", (await row.locator('input[name="until"]').getAttribute("min")) === today);
    await row.locator('input[name="until"]').evaluate((el) => el.removeAttribute("min"));
    await row.locator('input[name="until"]').fill("2020-01-01");
    await row.locator('button:has-text("offrir")').click();
    await row.locator('[role="alert"]').waitFor({ timeout: 5000 }).catch(() => {});
    check("Gratuité : date passée refusée avec un message", (await row.innerText()).includes("Date passée") && !(await q1(`select "exemptUntil" from "Subscription" where "organizationId" = 'demo-org-cdra'`))?.exemptUntil);
    check("Abonnements : indice de défilement du tableau", (await adm.page.locator(".scroll-hint").count()) === 1);
    // Lancement : TVA et double authentification des administrateurs signalées.
    await adm.page.goto(`${BASE}/admin?onglet=lancement`);
    const launch = (await text(adm.page)).replace(/\s+/g, " ");
    check("Lancement : Facturation à faire tant que STRIPE_TAX_RATE n'est pas défini", /À faire Facturation \(STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_TAX_RATE\)/.test(launch));
    check("Lancement : PLATFORM_ADMIN_2FA=optional signalé", /À faire Double authentification des administrateurs KolBase/.test(launch) && launch.includes("PLATFORM_ADMIN_2FA=optional"));
    // E-mailing : plafond de la lettre atteint jusqu'après l'événement, commande impossible ; la carte de publication n'en parle pas.
    await pgc.query(`update "User" set "notifyPrefs" = "notifyPrefs" || '{"newsletter": true}', "emailVerifiedAt" = coalesce("emailVerifiedAt", now()) where email = 'antoine.martin@demo.kolbase.local'`);
    await pgc.query(`insert into "Event" (id, "organizationId", title, "typeId", "startsAt", format, city, "publishedAt", "updatedAt") values ('e2e-5b-ev-mail', 'demo-org-dentalys', 'Atelier 5b imminent', 'travaux-pratiques', now() + interval '3 hours', 'PRESENTIEL', 'Lyon', now(), now())`);
    await pgc.query(`insert into "NewsletterCampaign" (id, subject, body, recipients, "sentAt", "createdById") select x, 'Lettre 5b', 'Texte', 1, now(), id from "User", (values ('e2e-5b-nl1'), ('e2e-5b-nl2')) v(x) where email = 'anne.chevalier@demo.kolbase.local'`);
    const cl = await session();
    await login(cl.page, CLAIRE);
    await cl.page.goto(`${BASE}/organisations/demo-org-dentalys/evenements/e2e-5b-ev-mail?publie=1`);
    const mailing = cl.page.locator('.service-list li:has-text("E-mailing dédié aux membres KolBase")').first();
    const mt = (await mailing.innerText()).replace(/\s+/g, " ");
    check("E-mailing : plafond atteint, prochain envoi le 1er, indisponible avant l'événement", mt.includes("prochain envoi possible le 1er") && mt.includes("Indisponible avant l'événement") && (await mailing.locator('button:has-text("Commander")').count()) === 0, mt.slice(0, 250));
    const pub = await cl.page.locator("section.published-offer").innerText().catch(() => "");
    check("Carte « Votre événement est en ligne » : ni pack ni e-mailing indisponibles", !pub || (!pub.includes("Pack visibilité") && !/e-mailing/i.test(pub)), pub.slice(0, 200));
    await pgc.query(`delete from "NewsletterCampaign" where id in ('e2e-5b-nl1', 'e2e-5b-nl2')`);
    // Pack : une mise à la une en cours compte comme réalisée ; « Commandes traitées (N) » compte ce qui est affiché.
    await pgc.query(`insert into "ServiceOrder" (id, "organizationId", "eventId", "offerId", label, "priceCents", "orderedById", status, "doneAt", "packLabel", "trackCode", "createdAt", "updatedAt")
      select x.id, 'demo-org-dentalys', 'e2e-5b-ev-mail', x.offer, x.label, x.price, u.id, 'realisee', now(), 'Pack visibilité', x.code, now(), now()
      from "User" u, (values ('e2e-5b-p1', 'svc-newsletter', 'E-mailing dédié aux membres KolBase', 58477, '5bpack1'), ('e2e-5b-p2', 'svc-reseaux', 'Publication sur les réseaux sociaux de KolBase', 24577, '5bpack2'), ('e2e-5b-p3', 'svc-une', 'À la une de la page d''accueil (7 jours)', 15946, '5bpack3')) as x(id, offer, label, price, code)
      where u.email = 'claire.morel@demo.kolbase.local'`);
    await adm.page.goto(`${BASE}/admin?onglet=services`);
    const treated = adm.page.locator('details.older:has(> summary:has-text("Commandes traitées"))');
    await treated.locator("> summary").click();
    const grp = (await treated.locator('li.service-pack-group:has-text("Atelier 5b imminent")').innerText()).replace(/\s+/g, " ");
    check("Pack : mise à la une en cours comptée comme réalisée", grp.includes("Réalisé · mise à la une en cours") && !grp.includes("0 sur 3"), grp.slice(0, 200));
    const shown = await treated.locator("> ul > li").count();
    const label = await treated.locator("> summary").innerText();
    check("« Commandes traitées (N) » : N = commandes affichées", label === `Commandes traitées (${shown})`, `${label} / ${shown}`);
    await pgc.query(`delete from "ServiceOrder" where id in ('e2e-5b-p1', 'e2e-5b-p2', 'e2e-5b-p3')`);
    await pgc.query(`delete from "Event" where id = 'e2e-5b-ev-mail'`).catch(() => {});
    // Société savante sans SIREN : refus avec « SIREN ou RNA », pas de double point ; validation annonçant contrat et abonnement.
    await pgc.query(`insert into "Organization" (id, name, kind, rna, verification, listed, areas, "updatedAt") values ('e2e-5b-ss', 'Société Savante Cinq B', 'SOCIETE_SAVANTE', 'W123456789', 'PENDING', false, '{}', now())`);
    await pgc.query(`insert into "Membership" (id, "userId", "organizationId", role) select 'e2e-5b-ss-m', id, 'e2e-5b-ss', 'ADMIN' from "User" where email = 'claire.morel@demo.kolbase.local'`);
    await adm.page.goto(`${BASE}/admin/organisations/e2e-5b-ss`);
    const ss = () => adm.page.locator('section.card:has-text("Société Savante Cinq B")').first();
    check("Validation : l'admin sait que la note est envoyée à l'organisation", (await ss().innerText()).includes("La note figure telle quelle dans l'e-mail de validation"));
    await ss().locator('input[name="note"][placeholder^="Motif du refus"]').fill("Numéro RNA introuvable au Journal officiel.");
    await ss().locator('button:has-text("Refuser")').click();
    await until(async () => (await q1(`select verification from "Organization" where id = 'e2e-5b-ss'`)).verification === "REJECTED");
    const refus = await waitMail(CLAIRE, "Société Savante Cinq B n'a pas été validée");
    check("E-mail de refus d'une société savante : « SIREN ou RNA »", !!refus && refus.text.includes("(SIREN ou RNA, nom)"), refus?.text.slice(0, 300));
    await cl.page.goto(`${BASE}/organisations/e2e-5b-ss`);
    const ssh = await text(cl.page);
    check("Société savante refusée : « Corriger l'identité (SIREN ou RNA) », motif sans double point", ssh.includes("Corriger l'identité (SIREN ou RNA)") && ssh.includes("Journal officiel.") && !ssh.includes("officiel.."), ssh.match(/KolBase n'a pas validé[^\n]*/)?.[0]);
    await adm.page.goto(`${BASE}/admin/organisations/e2e-5b-ss`);
    await ss().locator('input[name="note"][placeholder^="Note"]').fill("RNA vérifié");
    await ss().locator('button:has-text("Valider")').click();
    await until(async () => (await q1(`select verification from "Organization" where id = 'e2e-5b-ss'`)).verification === "VERIFIED");
    const ok = await waitMail(CLAIRE, "Société Savante Cinq B est validée");
    check("E-mail de validation : contrat de sous-traitance et abonnement annoncés", !!ok && ok.text.includes("contrat de sous-traitance") && /599\s€ HT par mois/.test(ok.text), ok?.text.slice(-300));
    await pgc.query(`delete from "Membership" where id = 'e2e-5b-ss-m'`).catch(() => {});
    await pgc.query(`delete from "Organization" where id = 'e2e-5b-ss'`).catch(() => {});
    await cl.ctx.close();
    await adm.ctx.close();
  }

  // 4. Finitions : états dans le temps, appels complets, mobile, textes du prestataire, accès, autorisations.
  {
    const n = (s) => s.replace(/\s+/g, " ");
    await pgc.query(`insert into "Event" (id, "organizationId", title, "typeId", "startsAt", "durationMinutes", format, city, capacity, "publishedAt", "updatedAt") values
      ('e2e-5b-ev-live', 'demo-org-dentalys', 'Atelier 5b en cours', 'travaux-pratiques', (now() at time zone 'utc') - interval '30 minutes', 120, 'PRESENTIEL', 'Lyon', 40, now() - interval '5 days', now()),
      ('e2e-5b-ev-draft', 'demo-org-dentalys', 'Atelier 5b brouillon', 'travaux-pratiques', now() + interval '20 days', 15, 'PRESENTIEL', 'Lyon', 40, null, now())`);
    const cl = await session();
    await login(cl.page, CLAIRE);
    await cl.page.goto(`${BASE}/organisations/demo-org-dentalys/evenements`);
    const live = cl.page.locator('section[aria-label="Événements en cours"] a.row-item:has-text("Atelier 5b en cours")');
    check("Événement en cours : rangé « En cours », inscriptions closes", (await live.count()) === 1 && (await live.innerText()).includes("En cours · inscriptions closes"));
    await cl.page.goto(`${BASE}/organisations/demo-org-dentalys`);
    check("Accueil de l'organisation : l'événement du jour reste visible", n(await cl.page.locator('section[aria-labelledby="a-venir"]').innerText()).includes("Atelier 5b en cours"));
    await cl.page.goto(`${BASE}/organisations/demo-org-dentalys/evenements/e2e-5b-ev-draft`);
    const draft = await text(cl.page);
    check("Brouillon : pas de « Fermer les inscriptions », durée « 15 min »", !draft.includes("Fermer les inscriptions") && draft.includes("15 min") && !draft.includes("0 h 15"));
    // Appel complet : « Complet » dans Opportunités et sur la page publique ; « Candidater » réservé aux praticiens.
    await pgc.query(`insert into "OpenCall" (id, "organizationId", title, "typeId", status, slots, "createdById") values ('e2e-5b-call', 'demo-org-dentalys', 'Relecture 5b complète', 'advisory', 'open', 1, 'demo-u-julien')`);
    await pgc.query(`insert into "Application" (id, "openCallId", "practitionerId", status, message) values ('e2e-5b-app', 'e2e-5b-call', 'demo-p-martin', 'retained', 'Disponible.')`);
    await cl.page.goto(`${BASE}/appels`);
    check("Appels publics, compte d'organisation : pas de « Candidater »", (await cl.page.locator('article.dossier-card a:has-text("Candidater")').count()) === 0);
    await cl.ctx.close();
    const gi = await session();
    await login(gi.page, "olivier.girard@demo.kolbase.local");
    await gi.page.goto(`${BASE}/opportunites`);
    check("Opportunités : appel aux places pourvues « Complet »", (await gi.page.locator('a.tile:has-text("Relecture 5b complète")').innerText().catch(() => "")).includes("Complet"));
    await gi.ctx.close();
    const anon = await session();
    await anon.page.goto(`${BASE}/structures/demo-org-dentalys`);
    const card = anon.page.locator('article.dossier-card:has-text("Relecture 5b complète")');
    check("Page publique de l'organisation : appel « Complet », sans bouton", (await card.innerText().catch(() => "")).includes("Complet") && (await card.locator("a.btn").count()) === 0);
    await pgc.query(`delete from "Application" where id = 'e2e-5b-app'`);
    await pgc.query(`delete from "OpenCall" where id = 'e2e-5b-call'`);
    // Fiche publique : événement en cours ou passé, ni places restantes ni prix par personne ; JSON-LD sans offre.
    await anon.page.goto(`${BASE}/evenements/e2e-5b-ev-live`);
    const pl = n(await text(anon.page));
    check("Fiche publique, événement en cours : « En cours · inscriptions closes », ni places ni prix", pl.includes("En cours · inscriptions closes") && !pl.includes("restantes") && !pl.includes("par personne"), pl.slice(0, 200));
    await anon.page.goto(`${BASE}/evenements/demo-ev-passe`);
    const pp = n(await text(anon.page));
    const ld = JSON.parse((await anon.page.locator('script[type="application/ld+json"]').first().textContent()) ?? "{}");
    check("Fiche publique, événement passé : ni places restantes, ni prix par personne, JSON-LD sans offre", !pp.includes("restantes") && !pp.includes("par personne") && pp.includes("Événement passé") && !ld.offers, JSON.stringify(ld.offers ?? null));
    // Appel rattaché à un événement : un visiteur peut se connecter pour candidater.
    const ev = await q1(`select c."eventId" id from "OpenCall" c join "Event" e on e.id = c."eventId" where c.status = 'open' and e."publishedAt" is not null and e."startsAt" > now() and (c.deadline is null or c.deadline > now()) limit 1`);
    if (ev) {
      await anon.page.goto(`${BASE}/evenements/${ev.id}`);
      check("Fiche de l'événement : « Se connecter pour candidater » pour un visiteur", (await anon.page.locator('main a:has-text("Se connecter pour candidater")').count()) > 0);
    }
    await anon.ctx.close();
    await pgc.query(`delete from "Event" where id in ('e2e-5b-ev-live', 'e2e-5b-ev-draft')`).catch(() => {});
    // Badge d'un événement terminé : plus de « Présentez ce code ».
    const reg = await q1(`select r.id from "Registration" r where r."eventId" = 'demo-ev-passe' and r."userId" = 'demo-u-lambert'`);
    const il = await session();
    await login(il.page, "ines.lambert@demo.kolbase.local");
    await il.page.goto(`${BASE}/inscriptions/${reg.id}/badge`);
    const badge = await text(il.page);
    check("Badge d'un événement terminé : sans « Présentez ce code »", !badge.includes("Présentez ce code") && (await il.page.locator(".badge-qr").count()) === 0);
    await il.ctx.close();
    // Comparaison des devis à 390 px : pas de débordement, même après « Retenir ».
    const mob = await browser.newContext({ locale: "fr-FR", viewport: { width: 390, height: 844 } });
    const mp = await mob.newPage();
    await login(mp, CLAIRE);
    await mp.goto(`${BASE}/organisations/demo-org-dentalys/prestataires/e2e-5b-rfq-tva`);
    const tva = mp.locator("section#rfq-e2e-5b-rfq-tva");
    await tva.locator('button:has-text("Retenir")').first().click().catch(() => {});
    await tva.locator(".confirm-step").first().waitFor({ timeout: 3000 }).catch(() => {});
    const width = await mp.evaluate(() => document.documentElement.scrollWidth);
    const step = await tva.locator(".confirm-step").first().boundingBox().catch(() => null);
    check("Devis à 390 px : confirmation de « Retenir » sans débordement", width <= 390 && !!step && step.x + step.width <= 390, `${width} ${JSON.stringify(step)}`);
    await mob.close();
    // Prestataire : textes propres, fiche enregistrée en attente de validation (saisie gardée).
    await pgc.query(`insert into "Organization" (id, name, kind, siren, verification, listed, areas, "updatedAt") values ('e2e-5b-sup', 'Traiteur Cinq B', 'PRESTATAIRE', '552100554', 'PENDING', false, '{}', now())`);
    await pgc.query(`insert into "Membership" (id, "userId", "organizationId", role) select 'e2e-5b-sup-m', id, 'e2e-5b-sup', 'ADMIN' from "User" where email = 'hugo.robert@demo.kolbase.local'`);
    const hu = await session();
    await login(hu.page, "hugo.robert@demo.kolbase.local");
    await hu.page.goto(`${BASE}/organisations/e2e-5b-sup/devis?onglet=fiche`);
    const dv = await text(hu.page);
    check("Prestataire en attente : bandeau sans « l'abonnement se règle ensuite »", dv.includes("jusqu'à votre premier devis retenu") && !dv.includes("l'abonnement se règle ensuite"));
    const form = hu.page.locator('form:has(h2:has-text("Catégories et zone"))');
    await form.locator('input[name="categories"][value="restauration"]').check();
    await form.locator('input[name="coverage"]').fill("Lyon et sa région");
    await form.locator('input[name="listed"]').check();
    await form.locator('button:has-text("Enregistrer")').click();
    await form.locator(".notice").waitFor({ timeout: 5000 }).catch(() => {});
    const sup = await q1(`select "supplierCategories" c, coverage, listed from "Organization" where id = 'e2e-5b-sup'`);
    check("Page prestataire en attente : catégories et zone enregistrées, référencement à la validation", (await form.innerText()).includes("Catégories et zone enregistrées") && sup?.coverage === "Lyon et sa région" && sup?.listed === false && (await form.locator('input[name="coverage"]').inputValue()) === "Lyon et sa région", JSON.stringify(sup));
    await hu.page.goto(`${BASE}/organisations/e2e-5b-sup/membres?onglet=organisation`);
    const mem = await text(hu.page);
    check("Prestataire : fiche sans domaines thérapeutiques ni politique de collaboration, textes adaptés", !mem.includes("Domaines thérapeutiques") && !mem.includes("Politique de collaboration") && mem.includes("annuaire des prestataires") && !mem.includes("ni publier d'événements"));
    await hu.ctx.close();
    await pgc.query(`delete from "Membership" where id = 'e2e-5b-sup-m'`).catch(() => {});
    await pgc.query(`delete from "Organization" where id = 'e2e-5b-sup'`).catch(() => {});
    // Accès : « Référencer mon organisation » mène à son organisation ; identité refusée ; Mes revenus non éligible.
    const cm = await session();
    await login(cm.page, CLAIRE);
    await cm.page.goto(`${BASE}/aide`);
    check("Aide, connecté avec une organisation : « Référencer mon organisation » mène à celle-ci", (await cm.page.locator('a:has-text("Référencer mon organisation")').first().getAttribute("href")) === "/organisations/demo-org-dentalys");
    await cm.ctx.close();
    await pgc.query(`update "PractitionerProfile" set listed = false, "rppsVerified" = false, "rppsCheckedAt" = now(), "rppsCheckNote" = 'Numéro introuvable' where id = 'demo-p-simon'`);
    const em = await session();
    await login(em.page, "emma.simon@demo.kolbase.local");
    await em.page.goto(`${BASE}/tableau-de-bord`);
    const home = await text(em.page);
    check("Identité refusée : « Identifiant non vérifié : corrigez-le » au lieu de « Me référencer »", home.includes("Identifiant non vérifié : corrigez-le") && (await em.page.locator('a:has-text("Me référencer")').count()) === 0);
    await em.ctx.close();
    await pgc.query(`update "PractitionerProfile" set profession = 'Assistant(e) dentaire', listed = false where "userId" = (select id from "User" where email = 'romane.lot5b@exemple.fr')`);
    const ro = await session();
    await login(ro.page, "romane.lot5b@exemple.fr", "lot5b-mot-de-passe-2");
    await ro.page.goto(`${BASE}/revenus`);
    check("Mes revenus, profession non éligible : retour à l'accueil avec un message", ro.page.url().includes("/tableau-de-bord?acces=revenus") && (await text(ro.page)).includes("« Mes revenus » est réservé"), ro.page.url());
    await ro.ctx.close();
    // Hospitalité soumise à autorisation, délai dépassé : alerte à la saisie ; tâche et pastille pour la Conformité.
    const pj = await session();
    await login(pj.page, "julien.faure@demo.kolbase.local");
    await pj.page.goto(`${BASE}/organisations/demo-org-dentalys/evenements/nouveau`);
    const soon = new Date(Date.now() + 3 * 864e5).toLocaleString("sv-SE", { timeZone: "Europe/Paris" }).slice(0, 16).replace(" ", "T");
    await pj.page.fill('input[name="startsAt"]', soon);
    await pj.page.check('input[name="benefit_nuitee"]');
    await pj.page.fill('input[name="value_nuitee"]', "400");
    check("Saisie d'une hospitalité soumise à autorisation : délai déjà dépassé signalé", (await text(pj.page)).includes("Délai d'autorisation déjà dépassé pour cette date"));
    await pj.ctx.close();
    await pgc.query(`insert into "Event" (id, "organizationId", title, "typeId", "startsAt", format, city, "publishedAt", "updatedAt") values ('e2e-5b-ev-auth', 'demo-org-dentalys', 'Congrès 5b avec nuitée', 'symposium', now() + interval '10 days', 'PRESENTIEL', 'Lyon', now(), now())`);
    await pgc.query(`insert into "EventBenefit" (id, "eventId", "catalogId", label, "valueCents") values ('e2e-5b-ben', 'e2e-5b-ev-auth', 'nuitee', 'Nuitée', 40000)`);
    await pgc.query(`insert into "Registration" (id, "eventId", "userId", profession) values ('e2e-5b-reg-auth', 'e2e-5b-ev-auth', 'demo-u-durand', 'Chirurgien-dentiste')`);
    await pgc.query(`insert into "RegistrationBenefit" ("registrationId", "benefitId", "valueCents") values ('e2e-5b-reg-auth', 'e2e-5b-ben', 40000)`);
    // Tâche de la conformité (Sophie) : l'administratrice seule n'a plus la rubrique Conformité.
    const co = await session();
    await login(co.page, "sophie.bernard@demo.kolbase.local");
    await co.page.goto(`${BASE}/organisations/demo-org-dentalys`);
    check("Conformité : tâche « Autorisation d'hospitalité à demander »", (await text(co.page)).includes("Autorisation d'hospitalité à demander : Congrès 5b avec nuitée"));
    await co.ctx.close();
    await pgc.query(`delete from "RegistrationBenefit" where "registrationId" = 'e2e-5b-reg-auth'`).catch(() => {});
    await pgc.query(`delete from "Registration" where id = 'e2e-5b-reg-auth'`).catch(() => {});
    await pgc.query(`delete from "Event" where id = 'e2e-5b-ev-auth'`).catch(() => {});
  }

  await pgc.end();
}

// ── Rôles : la conformité réservée au rôle Conformité ; inscriptions et statistiques géographiques ──
{
  const claire = await session();
  await login(claire.page, "claire.morel@demo.kolbase.local");
  await claire.page.goto(`${BASE}/organisations/demo-org-dentalys`);
  check("Administratrice sans rôle Conformité : pas de rubrique Conformité", (await claire.page.locator('aside a[href="/organisations/demo-org-dentalys/conformite"]').count()) === 0);
  await claire.page.goto(`${BASE}/organisations/demo-org-dentalys/conformite`);
  check("Administratrice sans rôle Conformité : espace conformité refusé", claire.page.url().endsWith("/organisations/demo-org-dentalys?acces=refuse"), claire.page.url());
  await claire.page.goto(`${BASE}/organisations/demo-org-dentalys/dossiers/demo-prj-symposium?onglet=conformite`);
  check("Administratrice sans rôle Conformité : pas de bouton de validation", (await claire.page.locator('button:text-is("Valider")').count()) === 0);
  // Menu du compte : « Mes inscriptions » pour un compte sans profil praticien.
  await claire.page.click(".session-chip");
  check("Menu du compte (organisation) : « Mes inscriptions »", (await claire.page.locator('.account-menu a[href="/inscriptions"]').count()) === 1);
  // Statistiques : répartition par région (code postal, ou grande ville) et par ville.
  await claire.page.goto(`${BASE}/organisations/demo-org-dentalys/statistiques`);
  const geo = await claire.page.locator("#geographie").innerText();
  check("Statistiques : répartition par région", geo.includes("Auvergne-Rhône-Alpes") && geo.includes("Experts rémunérés") && geo.includes("Participants aux événements"), geo.slice(0, 200));
  await claire.page.goto(`${BASE}/organisations/demo-org-dentalys/statistiques?geo=villes`);
  check("Statistiques : répartition par ville", (await claire.page.locator("#geographie").innerText()).includes("Lyon"));
  await claire.ctx.close();
  // Administratrice qui tient aussi la conformité (organisation d'une seule personne) : l'espace lui reste ouvert.
  const anne = await session();
  await login(anne.page, "anne.chevalier@demo.kolbase.local");
  await anne.page.goto(`${BASE}/organisations/demo-org-academie/conformite`);
  check("Administratrice avec le rôle Conformité : espace conformité ouvert", anne.page.url().endsWith("/organisations/demo-org-academie/conformite"), anne.page.url());
  await anne.ctx.close();
  // Organisation sans membre Conformité : alerte à l'administrateur (Membres, À faire).
  const pgc = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await pgc.connect();
  await pgc.query(`delete from "Membership" where "organizationId" = 'demo-org-cdra' and role = 'CONFORMITE'`);
  const pierre = await session();
  await login(pierre.page, "pierre.vidal@demo.kolbase.local");
  await pierre.page.goto(`${BASE}/organisations/demo-org-cdra/membres`);
  check("Sans membre Conformité : alerte dans Membres", (await pierre.page.locator("#sans-conformite").count()) === 1);
  await pierre.page.goto(`${BASE}/organisations/demo-org-cdra`);
  check("Sans membre Conformité : action « Attribuer le rôle Conformité »", (await text(pierre.page)).includes("Attribuer le rôle Conformité"));
  await pgc.query(`insert into "Membership" (id, "userId", "organizationId", role) values ('e2e-cdra-conf', 'demo-u-pierre', 'demo-org-cdra', 'CONFORMITE') on conflict do nothing`);
  await pierre.ctx.close();
  await pgc.end();
}

// ── Opportunité publiée depuis l'événement d'un dossier : l'expert retenu rejoint ce dossier ──
{
  const pgc = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await pgc.connect();
  const clean = async () => {
    await pgc.query(`delete from "Message" where "projectExpertId" in (select id from "ProjectExpert" where "projectId" = 'demo-prj-board' and "practitionerId" = 'demo-p-roux')`);
    await pgc.query(`delete from "ProjectExpert" where "projectId" = 'demo-prj-board' and "practitionerId" = 'demo-p-roux'`);
    await pgc.query(`delete from "OpenCall" where id = 'e2e-call-board'`);
  };
  await clean();
  await pgc.query(`insert into "OpenCall" (id, "organizationId", "eventId", title, "typeId", status, slots, "createdById") values ('e2e-call-board', 'demo-org-dentalys', 'demo-ev-board', 'Intervenant supplémentaire au board', 'advisory', 'open', 2, 'demo-u-julien')`);
  await pgc.query(`insert into "Application" (id, "openCallId", "practitionerId", status, message) values ('e2e-app-board', 'e2e-call-board', 'demo-p-roux', 'pending', 'Disponible pour la réunion du board.')`);
  const projects = async () => (await pgc.query(`select count(*)::int n from "Project" where "organizationId" = 'demo-org-dentalys'`)).rows[0].n;
  const before = await projects();
  const jul = await session();
  await login(jul.page, "julien.faure@demo.kolbase.local");
  await jul.page.goto(`${BASE}/organisations/demo-org-dentalys/opportunites/e2e-call-board`);
  check("Opportunité d'un événement de dossier : le retenu rejoindra ce dossier (annoncé)", (await text(jul.page)).includes("ajoute l'expert au dossier « Board implantologie — gamme 2027 »"));
  await jul.page.click('button:has-text("Retenir…")');
  await jul.page.fill('input[name="units"]', "1");
  await jul.page.fill('input[name="fee"]', "1500");
  await Promise.all([jul.page.waitForURL(/\/dossiers\/demo-prj-board/), jul.page.click('button:has-text("Proposer ces honoraires")')]);
  const link = (await pgc.query(`select status, "feeCents" from "ProjectExpert" where "projectId" = 'demo-prj-board' and "practitionerId" = 'demo-p-roux'`)).rows[0];
  check("Candidat retenu : ajouté au dossier de l'événement, sans nouveau dossier", link?.status === "ATT_EXPERTS" && link?.feeCents === 150000 && (await projects()) === before, JSON.stringify(link));
  check("Candidature rattachée au dossier de l'événement", (await pgc.query(`select "projectId" from "Application" where id = 'e2e-app-board'`)).rows[0]?.projectId === "demo-prj-board");
  check("E-mail à l'expert : honoraires proposés", !!(await waitMail("mathieu.roux@demo.kolbase.local", "Candidature retenue : Dentalys Implants vous propose")));
  await clean();
  await jul.ctx.close();
  await pgc.end();
}

// ── Grille de rémunération et volume horaire ──────────────────────────────
{
  const pgc = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await pgc.connect();
  const clean = async () => {
    await pgc.query(`delete from "Message" where "projectExpertId" in (select id from "ProjectExpert" where "projectId" = 'demo-prj-board' and "practitionerId" = 'demo-p-roux')`);
    await pgc.query(`delete from "ProjectExpert" where "projectId" = 'demo-prj-board' and "practitionerId" = 'demo-p-roux'`);
    await pgc.query(`delete from "FeeLevel" where label = 'Formateur e2e'`);
  };
  await clean();
  // La conformité définit un niveau ; l'administratrice sans rôle Conformité n'y a pas accès.
  const sophie = await session();
  await login(sophie.page, "sophie.bernard@demo.kolbase.local");
  await sophie.page.goto(`${BASE}/organisations/demo-org-dentalys/conformite?onglet=parametres`);
  check("Paramètres de conformité : grille de rémunération (niveaux de démonstration)", (await sophie.page.locator("#grille").innerText()).includes("Expert international"));
  await sophie.page.fill('#grille input[name="label"]', "Formateur e2e");
  await sophie.page.fill('#grille input[name="hourly"]', "95");
  await sophie.page.click('#grille button:has-text("Ajouter le niveau")');
  await sophie.page.locator('#grille li:has-text("Formateur e2e")').waitFor({ timeout: 10000 }).catch(() => {});
  check("Grille : niveau ajouté par la conformité", (await pgc.query(`select "hourlyCents" from "FeeLevel" where label = 'Formateur e2e'`)).rows[0]?.hourlyCents === 9500);
  await sophie.page.click('#grille li:has-text("Formateur e2e") button:has-text("Retirer")');
  await sophie.page.locator('#grille li:has-text("Formateur e2e")').waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
  check("Grille : niveau retiré", (await pgc.query(`select count(*)::int n from "FeeLevel" where label = 'Formateur e2e'`)).rows[0].n === 0);
  await sophie.ctx.close();
  // Projets : niveau + heures → honoraires calculés ; le taux réel au-delà du seuil est signalé.
  const jul = await session();
  await login(jul.page, "julien.faure@demo.kolbase.local");
  await jul.page.goto(`${BASE}/organisations/demo-org-dentalys/dossiers/demo-prj-board?onglet=experts&modifier=1`);
  const add = 'form:has(select[name="expertId"])';
  await jul.page.selectOption(`${add} select[name="expertId"]`, "demo-p-roux");
  await jul.page.selectOption(`${add} select[name="level"]`, "demo-fee-nat");
  await jul.page.fill(`${add} input[name="prepHours"]`, "2");
  await jul.page.fill(`${add} input[name="interventionHours"]`, "4");
  await jul.page.fill(`${add} input[name="travelHours"]`, "2,5");
  check("Honoraires calculés : 8,5 h × 150 € = 1 275 €", (await jul.page.inputValue(`${add} input[name="fee"]`)) === "1275");
  await jul.page.fill(`${add} input[name="fee"]`, "2000");
  check("Taux réel au-delà du seuil horaire : signalé", (await jul.page.locator(add).innerText()).includes("convention soumise à autorisation"));
  await jul.page.click(`${add} button:text("Appliquer la grille")`);
  await jul.page.click(`${add} button:has-text("Ajouter et solliciter l'expert")`);
  await jul.page.locator('.notice.ok:has-text("Expert ajouté")').waitFor({ timeout: 10000 }).catch(() => {});
  const link = (await pgc.query(`select id, "feeCents", "hourlyCents", "prepHours", "interventionHours", "travelHours", "feeLevelLabel" from "ProjectExpert" where "projectId" = 'demo-prj-board' and "practitionerId" = 'demo-p-roux'`)).rows[0];
  check("Expert sollicité avec la grille : taux et heures figés", link?.feeCents === 127500 && link?.hourlyCents === 15000 && link?.prepHours === 2 && link?.interventionHours === 4 && link?.travelHours === 2.5 && link?.feeLevelLabel === "Expert national", JSON.stringify(link));
  await jul.page.goto(`${BASE}/organisations/demo-org-dentalys/dossiers/demo-prj-board?onglet=experts`);
  const card = (await text(jul.page)).replace(/\s+/g, " ");
  check("Fiche de l'expert dans le dossier : heures, taux réel et niveau", card.includes("8,5 h · 150 € / h réel") && card.includes("Grille : Expert national (150 € / h)"), card.match(/8,5 h[^\n]{0,60}/)?.[0]);
  await jul.ctx.close();
  // L'expert voit le volume horaire proposé.
  const roux = await session();
  await login(roux.page, "mathieu.roux@demo.kolbase.local");
  await roux.page.goto(`${BASE}/sollicitations/${link.id}`);
  const rx = (await text(roux.page)).replace(/\s+/g, " ");
  check("Sollicitation : volume horaire et taux affichés à l'expert", /volume horaire/i.test(rx) && rx.includes("2,5 h de déplacement"), rx.match(/volume horaire.{0,80}/i)?.[0]);
  await roux.ctx.close();
  // Symposium de démonstration : 15 h au niveau « Expert international ».
  const cl = await session();
  await login(cl.page, "sophie.bernard@demo.kolbase.local");
  await cl.page.goto(`${BASE}/organisations/demo-org-dentalys/dossiers/demo-prj-symposium?onglet=experts`);
  check("Dossier de démonstration : 15 h au taux de 200 €", (await text(cl.page)).replace(/\s+/g, " ").includes("15 h · 200 € / h réel"));
  await cl.ctx.close();
  await clean();
  await pgc.end();
}

// ── Délais internes de la conformité et fiche dossier resserrée ──────────
{
  const pgc = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await pgc.connect();
  // Symposium en examen, soumis il y a vingt jours : examen en retard (5 jours ouvrés par défaut). Les parcours
  // précédents l'ont validé : il est remis « En validation », puis rétabli.
  const symBefore = (await pgc.query(`select status from "Project" where id = 'demo-prj-symposium'`)).rows[0].status;
  await pgc.query(`update "Project" set status = 'EN_VALID', "submittedAt" = now() - interval '20 days', "reviewReminderAt" = null where id = 'demo-prj-symposium'`);
  const so = await session();
  await login(so.page, "sophie.bernard@demo.kolbase.local");
  await so.page.goto(`${BASE}/organisations/demo-org-dentalys/dossiers/demo-prj-symposium`);
  check("Dossier en examen : retard du délai interne signalé", (await text(so.page)).includes("Examen par la conformité en retard de"));
  check("Vue d'ensemble de la conformité : « Examiner le dossier » mène à son onglet", (await so.page.locator('.next-step a[href*="onglet=conformite"]:has-text("Examiner le dossier")').count()) === 1);
  await so.page.goto(`${BASE}/organisations/demo-org-dentalys/dossiers/demo-prj-symposium?onglet=conformite`);
  check("Onglet Conformité : décision visible (Bloquer), retard rappelé", (await so.page.locator('.next-step button:has-text("Bloquer")').count()) === 1 && /examen en retard de/i.test(await so.page.locator(".next-step").innerText()));
  await so.page.goto(`${BASE}/organisations/demo-org-dentalys/conformite`);
  // Cellule « Échéance » de la ligne (la colonne Conflits peut aussi porter une pastille rouge).
  const dueCell = await so.page.locator('section:has(h2:has-text("Dossiers à valider")) tr:has-text("Symposium ADF") td[data-label="Échéance"]').first().innerText().catch(() => "");
  check("À valider : colonne Échéance, retard signalé", /en retard de/i.test(dueCell), dueCell);
  const cron = () => fetch(`${BASE}/api/taches`, { method: "POST", headers: { Authorization: `Bearer ${process.env.CRON_SECRET ?? "secret-des-taches-de-test"}` } }).then((r) => r.json());
  const r1 = await cron();
  check("Tâches planifiées : examen en retard relancé", r1.reviewReminders >= 1 && !!(await waitMail("sophie.bernard@demo.kolbase.local", "Examen en retard : Symposium ADF")), JSON.stringify(r1));
  const r2 = await cron();
  check("Relance d'un examen : une fois par jour", r2.reviewReminders === 0, JSON.stringify(r2));
  await pgc.query(`update "Project" set status = $1, "submittedAt" = now() - interval '2 days', "reviewReminderAt" = null where id = 'demo-prj-symposium'`, [symBefore]);
  await so.ctx.close();
  // Date d'intervention dans dix jours : la soumission (30 jours avant) est en retard ; abandon rangé sous « Autres actions ».
  const jul = await session();
  await login(jul.page, "julien.faure@demo.kolbase.local");
  await jul.page.goto(`${BASE}/organisations/demo-org-dentalys/dossiers/demo-prj-board`);
  const inTen = new Date(Date.now() + 10 * 86400e3).toISOString().slice(0, 10);
  await jul.page.click("#objet details.inline-edit summary");
  await jul.page.fill('#objet input[name="plannedAt"]', inTen);
  await jul.page.click('button:has-text("Mettre à jour l\'objet")');
  await jul.page.locator('.notice.ok:has-text("Objet du dossier enregistré")').waitFor({ timeout: 10000 }).catch(() => {});
  await jul.page.goto(`${BASE}/organisations/demo-org-dentalys/dossiers/demo-prj-board`);
  const t = await text(jul.page);
  check("Intervention prévue : soumission en retard signalée", t.includes("Soumission à la conformité en retard de") && /intervention le /i.test(t));
  check("Fiche dossier : abandon rangé sous « Autres actions »", (await jul.page.locator('.next-step details.more-actions:has-text("Abandonner")').count()) === 1 && !(await jul.page.locator('.next-step details.more-actions').evaluate((d) => d.open)));
  check("Fiche dossier : objet dans la vue d'ensemble, frise compacte", (await jul.page.locator('section:has(h2:has-text("Objet du dossier"))').count()) === 1 && (await jul.page.locator("header.page-hero .pipeline-compact").count()) === 1);
  await pgc.query(`update "Project" set "plannedAt" = null where id = 'demo-prj-board'`);
  await jul.ctx.close();
  await pgc.end();
}

// ── Responsables des dossiers : « Mes dossiers », co-responsables, e-mails ──
{
  const pgc = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await pgc.connect();
  // Rejouable : le symposium n'a que Julien Faure pour responsable ; Claire Morel (administratrice) n'est responsable
  // d'aucun dossier de Dentalys (les parcours précédents lui en ont fait créer).
  await pgc.query(`delete from "ProjectLead" where "projectId" = 'demo-prj-symposium' and "userId" <> 'demo-u-julien'`);
  await pgc.query(`delete from "ProjectLead" where "userId" = 'demo-u-claire' and "projectId" in (select id from "Project" where "organizationId" = 'demo-org-dentalys')`);
  const leadsOf = async (id) => (await pgc.query(`select "userId" from "ProjectLead" where "projectId" = $1 order by "userId"`, [id])).rows.map((r) => r.userId).join();
  const jul = await session();
  await login(jul.page, "julien.faure@demo.kolbase.local");
  await jul.page.goto(`${BASE}/organisations/demo-org-dentalys/dossiers`);
  let t = await text(jul.page);
  check("Liste des dossiers : « Mes dossiers » par défaut pour un responsable", (await jul.page.locator('nav.tabs a.active:has-text("Mes dossiers")').count()) === 1 && t.includes("Board implantologie"));
  check("Liste des dossiers : responsables affichés (co-responsable compris)", t.includes("Responsable : Julien Faure, Marc Lefèvre"));
  const claire = await session();
  await login(claire.page, "claire.morel@demo.kolbase.local");
  await claire.page.goto(`${BASE}/organisations/demo-org-dentalys/dossiers`);
  check("Liste des dossiers : « Tous les dossiers » par défaut pour qui n'est responsable d'aucun", (await claire.page.locator('nav.tabs a.active:has-text("Tous les dossiers")').count()) === 1 && (await text(claire.page)).includes("Symposium ADF"));
  await claire.page.goto(`${BASE}/organisations/demo-org-dentalys/dossiers?vue=mes`);
  check("« Mes dossiers » sans dossier : message et lien vers tous les dossiers", (await text(claire.page)).includes("Aucun dossier en cours dont vous êtes responsable.") && (await claire.page.locator('a:has-text("Voir tous les dossiers")').count()) === 1);
  // Julien ajoute Marc Lefèvre comme co-responsable du symposium : Marc est prévenu et le retrouve dans « Mes dossiers ».
  await jul.page.goto(`${BASE}/organisations/demo-org-dentalys/dossiers/demo-prj-symposium`);
  check("Fiche du dossier : bloc Responsables", (await jul.page.locator("#responsables").innerText()).includes("Julien Faure"));
  await jul.page.selectOption("#lead-add", "demo-u-marc");
  await jul.page.click('#responsables button:has-text("Ajouter")');
  await jul.page.locator('#responsables li:has-text("Marc Lefèvre")').waitFor({ timeout: 10000 }).catch(() => {});
  check("Co-responsable ajouté", (await leadsOf("demo-prj-symposium")) === "demo-u-julien,demo-u-marc");
  check("E-mail au co-responsable désigné", !!(await waitMail("marc.lefevre@demo.kolbase.local", "Vous êtes responsable du dossier")));
  check("Historique : responsable ajouté, avec son nom", (await text(jul.page)).includes("Responsable ajouté : Marc Lefèvre"));
  const marc = await session();
  await login(marc.page, "marc.lefevre@demo.kolbase.local");
  await marc.page.goto(`${BASE}/organisations/demo-org-dentalys/dossiers`);
  t = await text(marc.page);
  check("Co-responsable : le dossier dans « Mes dossiers »", t.includes("Symposium ADF") && t.includes("Board implantologie") && !t.includes("Rédaction d'un guide"));
  // Retrait : Marc n'est plus responsable ; le retirer de l'équipe Projets lui retire aussi ses dossiers.
  await jul.page.click('#responsables li:has-text("Marc Lefèvre") button:has-text("Retirer")');
  await jul.page.locator('#responsables li:has-text("Marc Lefèvre")').waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
  check("Responsable retiré", (await leadsOf("demo-prj-symposium")) === "demo-u-julien");
  // Un membre Conformité seul ne voit pas « Mes dossiers » et ne peut pas se désigner responsable.
  const sophie = await session();
  await login(sophie.page, "sophie.bernard@demo.kolbase.local");
  await sophie.page.goto(`${BASE}/organisations/demo-org-dentalys/dossiers`);
  check("Conformité : pas d'onglet « Mes dossiers »", (await sophie.page.locator('nav.tabs a:has-text("Mes dossiers")').count()) === 0);
  await sophie.page.goto(`${BASE}/organisations/demo-org-dentalys/dossiers/demo-prj-symposium`);
  check("Conformité : responsables affichés, sans gestion", (await sophie.page.locator('#responsables button').count()) === 0);
  for (const s of [jul, claire, marc, sophie]) await s.ctx.close();
  await pgc.end();
}

// ── Photo des experts et projets proposés aux organisations ────────────────
{
  const pgc = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await pgc.connect();
  const q1 = async (sql, params = []) => (await pgc.query(sql, params)).rows[0];
  const sharp = (await import("sharp")).default;
  const ROUX = "mathieu.roux@demo.kolbase.local";
  // Rejouable : l'expert repart sans photo ni proposition.
  await pgc.query(`delete from "PractitionerPhoto" where "practitionerId" = 'demo-p-roux'`);
  await pgc.query(`update "PractitionerProfile" set "photoUpdatedAt" = null, "photoConsentAt" = null where id = 'demo-p-roux'`);
  await pgc.query(`delete from "Project" where title = 'Étude e2e : retraitement endodontique en une séance'`);
  // Photo de téléphone, en portrait : position GPS, marque et modèle dans les métadonnées EXIF.
  const jpeg = await sharp({ create: { width: 1200, height: 1600, channels: 3, background: { r: 30, g: 90, b: 160 } } })
    .jpeg()
    .withExif({ IFD0: { Make: "Phone", Model: "ModeleSecret" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "48/1 51/1 0/1", GPSLongitudeRef: "E", GPSLongitude: "2/1 21/1 0/1" } })
    .toBuffer();
  const exp = await session();
  await login(exp.page, ROUX);
  await exp.page.goto(`${BASE}/compte`);
  check("Photo : encart « Photo » dans Mon compte, initiales en attendant", (await exp.page.locator("#photo").innerText()).includes("Sans photo, vos initiales s'affichent."));
  await exp.page.setInputFiles('#photo input[name="photo"]', { name: "portrait.jpg", mimeType: "image/jpeg", buffer: jpeg });
  await exp.page.click('#photo button:has-text("Ajouter ma photo")');
  await exp.page.locator("#photo .notice.ok").waitFor({ timeout: 15000 }).catch(() => {});
  check("Photo : enregistrée depuis Mon compte", (await exp.page.locator("#photo").innerText()).includes("Photo enregistrée."));
  const thumbRes = await fetch(`${BASE}/experts/demo-p-roux/photo`);
  const tm = await sharp(Buffer.from(await thumbRes.arrayBuffer())).metadata();
  check("Photo publique : vignette WebP carrée servie sans connexion", thumbRes.status === 200 && thumbRes.headers.get("content-type") === "image/webp" && tm.width === 192 && tm.height === 192, `${thumbRes.status} ${tm.width}×${tm.height}`);
  const bigBuf = Buffer.from(await (await fetch(`${BASE}/experts/demo-p-roux/photo?taille=grande`)).arrayBuffer());
  const bm = await sharp(bigBuf).metadata();
  check("Photo grand format : JPEG 800 × 800 sans métadonnées (GPS, appareil)", bm.format === "jpeg" && bm.width === 800 && bm.height === 800 && !bm.exif && !bigBuf.includes("ModeleSecret"));
  const anon = await session();
  await anon.page.goto(`${BASE}/experts`);
  check("Liste publique des experts : la photo remplace les initiales", (await anon.page.locator('a[href="/experts/demo-p-roux"] .avatar.photo img').count()) === 1);
  await exp.page.goto(`${BASE}/tableau-de-bord`);
  check("Barre de l'espace praticien : sa photo", (await exp.page.locator(".session-chip .avatar.photo img").count()) === 1);
  // Réglage « Organisations » : les visiteurs ne la voient plus, un membre d'organisation validée si.
  await pgc.query(`update "PractitionerProfile" set visibility = visibility || '{"photo":"industriels"}' where id = 'demo-p-roux'`);
  check("Photo réservée aux organisations : refusée sans connexion", (await fetch(`${BASE}/experts/demo-p-roux/photo`)).status === 404);
  await anon.page.goto(`${BASE}/experts/demo-p-roux`);
  check("Photo réservée : fiche publique avec les initiales", (await anon.page.locator(".profile-hero .avatar.photo").count()) === 0 && (await anon.page.locator(".profile-hero .avatar").count()) === 1);
  const jul = await session();
  await login(jul.page, "julien.faure@demo.kolbase.local");
  check("Photo réservée : visible d'un membre d'organisation validée", (await jul.page.request.get(`${BASE}/experts/demo-p-roux/photo`)).status() === 200);
  await pgc.query(`update "PractitionerProfile" set visibility = visibility || '{"photo":"public"}' where id = 'demo-p-roux'`);
  // Accord pour la communication des interventions, puis export des données.
  await exp.page.goto(`${BASE}/compte`);
  await exp.page.check('#photo input[name="consent"]');
  await exp.page.click('#photo button:has-text("Enregistrer")');
  await exp.page.locator('#photo .notice.ok:has-text("Accord enregistré")').waitFor({ timeout: 10000 }).catch(() => {});
  check("Photo : accord pour la communication enregistré", !!(await q1(`select "photoConsentAt" from "PractitionerProfile" where id = 'demo-p-roux'`))?.photoConsentAt);
  const dump = await (await exp.page.request.get(`${BASE}/compte/export`)).json().catch(() => null);
  check("Export des données : la photo est jointe", !!dump?.compte?.practitioner?.photo?.image?.startsWith("data:image/jpeg;base64,"));

  // Photo d'un compte d'organisation (sans profil praticien) : visible de lui, de ses collègues et de l'équipe KolBase.
  await pgc.query(`delete from "UserPhoto" where "userId" = 'demo-u-julien'`);
  await pgc.query(`update "User" set "photoUpdatedAt" = null where id = 'demo-u-julien'`);
  await jul.page.goto(`${BASE}/compte`);
  check("Compte d'organisation : encart « Photo » dans Mon compte", (await jul.page.locator("#photo").innerText()).includes("Visible de vous, des membres de vos organisations"));
  await jul.page.setInputFiles('#photo input[name="photo"]', { name: "portrait.jpg", mimeType: "image/jpeg", buffer: jpeg });
  await jul.page.click('#photo button:has-text("Ajouter ma photo")');
  await jul.page.locator("#photo .notice.ok").waitFor({ timeout: 15000 }).catch(() => {});
  check("Compte d'organisation : photo enregistrée", (await jul.page.locator("#photo").innerText()).includes("Photo enregistrée."));
  await jul.page.goto(`${BASE}/compte`);
  check("Compte d'organisation : sa photo dans la barre", (await jul.page.locator(".session-chip .avatar.photo img").count()) === 1);
  const col = await session();
  await login(col.page, "claire.morel@demo.kolbase.local");
  await col.page.goto(`${BASE}/organisations/demo-org-dentalys/membres`);
  check("Membres : la photo du collègue", (await col.page.locator('.member-row:has-text("Julien Faure") .avatar.photo img').count()) === 1);
  const own = await jul.page.request.get(`${BASE}/comptes/demo-u-julien/photo`);
  const julDump = await (await jul.page.request.get(`${BASE}/compte/export`)).json().catch(() => null);
  check("Export des données d'un compte d'organisation : la photo est jointe", !!julDump?.compte?.photo?.image?.startsWith("data:image/jpeg;base64,"));
  check("Photo d'un compte : servie à son titulaire (WebP)", own.status() === 200 && own.headers()["content-type"] === "image/webp");
  check("Photo d'un compte : refusée sans connexion", (await fetch(`${BASE}/comptes/demo-u-julien/photo`)).status === 404);
  check("Photo d'un compte : refusée hors de ses organisations", (await exp.page.request.get(`${BASE}/comptes/demo-u-julien/photo`)).status() === 404);
  await col.ctx.close();

  // Projet proposé à trois organisations : une copie chacune, sans les autres destinataires.
  await pgc.query(`delete from "ExpertProposal" where "practitionerId" = 'demo-p-roux'`);
  await exp.page.goto(`${BASE}/sollicitations`);
  check("Sollicitations : onglet « Mes propositions » et bouton « Proposer un projet »", (await exp.page.locator('.section-nav a:has-text("Mes propositions")').count()) === 1 && (await exp.page.locator('a[href="/propositions/nouvelle"]').count()) >= 1);
  await exp.page.goto(`${BASE}/structures/demo-org-dentalys`);
  await exp.page.click('a:has-text("Proposer un projet")');
  await exp.page.waitForURL(/\/propositions\/nouvelle/);
  check("Page d'une organisation : « Proposer un projet » la présélectionne", await exp.page.locator('label.org-option:has-text("Dentalys Implants") input').isChecked());
  check("Prestataires exclus des destinataires", (await exp.page.locator('label.org-option:has-text("Traiteur Belleville")').count()) === 0);
  await exp.page.fill('input[name="title"]', "Étude e2e : retraitement endodontique en une séance");
  await exp.page.selectOption('select[name="typeId"]', "webinaire");
  await exp.page.fill('textarea[name="description"]', "Webinaire sur le retraitement endodontique en une séance, à partir de vingt cas cliniques suivis à deux ans.");
  await exp.page.fill('textarea[name="audience"]', "Omnipraticiens, 60 minutes");
  await exp.page.fill('input[name="schedule"]', "Premier trimestre 2027");
  await exp.page.fill('textarea[name="logistics"]', "Studio de webinaire avec régie, captation vidéo");
  await exp.page.fill('input[name="fee"]', "2500");
  check("Honoraires au-dessus du repère : signalés à la saisie", (await exp.page.locator(".proposal-form").innerText()).includes("Votre demande dépasse ce repère"));
  await exp.page.fill('input[name="fee"]', "1500");
  await exp.page.check('label.org-option:has-text("OrthoNova") input');
  await exp.page.check('label.org-option:has-text("Collège Dentaire Rhône-Alpes") input');
  await exp.page.check('input[name="attest"]');
  await Promise.all([exp.page.waitForURL(/\/propositions\?envoyee=/, { timeout: 15000 }).catch(() => {}), exp.page.click('button:has-text("Envoyer à 3 organisations")')]);
  const copies = (await pgc.query(`select p.id, p."organizationId" org, p.status, p.description, p."proposalId", x.id link from "Project" p join "ProjectExpert" x on x."projectId" = p.id where p.title = 'Étude e2e : retraitement endodontique en une séance' order by p."organizationId"`)).rows;
  const copyOf = (org) => copies.find((c) => c.org === org);
  check("Proposition : une copie par organisation, en attente de leur réponse", copies.length === 3 && copies.every((c) => c.status === "ATT_IND" && c.proposalId === copies[0].proposalId), JSON.stringify(copies.map((c) => [c.org, c.status])));
  check("Copie : objectif, public, calendrier et besoins logistiques", !!copyOf("demo-org-dentalys")?.description?.includes("Calendrier envisagé : Premier trimestre 2027") && !!copyOf("demo-org-dentalys")?.description?.includes("Besoins logistiques : Studio de webinaire"));
  check("Proposition : besoins logistiques enregistrés", (await q1(`select logistics from "ExpertProposal" where id = $1`, [copies[0]?.proposalId]))?.logistics === "Studio de webinaire avec régie, captation vidéo");
  check("Mes propositions : envoi confirmé, trois réponses attendues", (await text(exp.page)).includes("Proposition envoyée à 3 organisations") && (await exp.page.locator('.proposal-recipients li:has-text("En attente de réponse")').count()) === 3);
  const pm = await waitMail("julien.faure@demo.kolbase.local", "Projet proposé par Dr Mathieu Roux");
  check("E-mail à l'équipe Projets, sans les autres destinataires", !!pm && /1\s500\s€/.test(pm.text) && !pm.text.includes("OrthoNova") && !pm.text.includes("Collège"), pm?.subject ?? "aucun e-mail");
  check("E-mail aussi à OrthoNova et au Collège", !!(await waitMail("thomas.garnier@demo.kolbase.local", "Projet proposé par")) && !!(await waitMail("pierre.vidal@demo.kolbase.local", "Projet proposé par")));
  await exp.page.goto(`${BASE}/propositions/nouvelle`);
  check("Une proposition à la fois par organisation : Dentalys indisponible", await exp.page.locator('label.org-option:has-text("Dentalys Implants") input').isDisabled());
  await exp.page.goto(`${BASE}/sollicitations`);
  check("Propositions en attente : hors des sollicitations reçues", !(await text(exp.page)).includes("Étude e2e : retraitement"));

  // Dentalys accepte : l'expert est prévenu, la photo grand format est proposée (accord donné).
  await jul.page.goto(`${BASE}/organisations/demo-org-dentalys/dossiers`);
  check("Dossiers de l'organisation : « Projet proposé par l'expert »", (await text(jul.page)).includes("Projet proposé par l'expert"));
  check("Mes dossiers : la proposition reçue, sans responsable, dans « À attribuer »", (await jul.page.locator('section[aria-labelledby="a-attribuer"]:has-text("Étude e2e : retraitement")').count()) === 1);
  await jul.page.goto(`${BASE}/organisations/demo-org-dentalys/dossiers/${copyOf("demo-org-dentalys").id}`);
  const dj = await text(jul.page);
  check("Dossier reçu : aucun autre destinataire nommé", !dj.includes("OrthoNova") && !dj.includes("Collège Dentaire"));
  await jul.page.click('button:has-text("Accepter la proposition")');
  await jul.page.waitForTimeout(800);
  check("Proposition acceptée : dossier en accord de principe", (await q1(`select status from "Project" where id = $1`, [copyOf("demo-org-dentalys").id]))?.status === "ACCORD");
  check("Proposition acceptée : qui l'accepte en devient responsable", (await pgc.query(`select "userId" from "ProjectLead" where "projectId" = $1`, [copyOf("demo-org-dentalys").id])).rows.map((r) => r.userId).join() === "demo-u-julien");
  check("E-mail à l'expert : proposition acceptée", !!(await waitMail(ROUX, "Proposition acceptée")));
  await jul.page.goto(`${BASE}/organisations/demo-org-dentalys/dossiers/${copyOf("demo-org-dentalys").id}`);
  await tab(jul.page, "experts");
  check("Expert engagé, accord donné : photo pour vos supports dans sa carte", (await jul.page.locator('.expert-card a[download]:has-text("Photo pour vos supports")').count()) === 1);
  check("Fiche de l'expert : sa photo", (await jul.page.locator(".expert-card .avatar.photo img").count()) === 1);
  // Collège : abonnement non actif, « Accepter » remplacé par la consigne ; puis il décline, avec un motif transmis à l'expert.
  await pgc.query(`update "Subscription" set "exemptUntil" = null where "organizationId" = 'demo-org-cdra'`);
  const pie = await session();
  await login(pie.page, "pierre.vidal@demo.kolbase.local");
  const cdraDossier = `${BASE}/organisations/demo-org-cdra/dossiers/${copyOf("demo-org-cdra").id}`;
  await pie.page.goto(cdraDossier);
  check("Accepter exige l'abonnement : consigne affichée, pas de bouton « Accepter »", (await text(pie.page)).includes("accepter le projet proposé par un expert") && (await pie.page.locator('button:has-text("Accepter la proposition")').count()) === 0);
  await pgc.query(`update "Subscription" set "exemptUntil" = '2099-12-31T23:59:59Z' where "organizationId" = 'demo-org-cdra'`);
  await pie.page.goto(cdraDossier);
  await pie.page.fill('form.transition:has(input[value="decline_proposal"]) input[name="note"]', "Hors de notre programme cette année");
  await pie.page.click('button:has-text("Décliner la proposition")');
  await pie.page.waitForTimeout(800);
  const dm = await waitMail(ROUX, "Proposition déclinée");
  check("Proposition déclinée : e-mail à l'expert avec le motif", !!dm && dm.text.includes("Hors de notre programme cette année"), dm?.text);
  check("Motif dans les échanges de l'expert", !!(await q1(`select id from "Message" where "projectExpertId" = $1 and body = 'Hors de notre programme cette année'`, [copyOf("demo-org-cdra").link])));
  // OrthoNova n'a pas répondu : l'expert retire sa proposition, OrthoNova est prévenue.
  await exp.page.goto(`${BASE}/propositions`);
  const li = exp.page.locator('.proposal-recipients li:has-text("OrthoNova")');
  await li.locator('button:has-text("Retirer")').click();
  await li.locator('button:has-text("Confirmer : retirer la proposition")').click();
  await exp.page.waitForTimeout(800);
  const w = await q1(`select p.status, x."responseNote" from "Project" p join "ProjectExpert" x on x."projectId" = p.id where p.id = $1`, [copyOf("demo-org-orthonova").id]);
  check("Proposition retirée par l'expert : dossier clos", w?.status === "DECLINE" && w?.responseNote === "Proposition retirée par l'expert", JSON.stringify(w));
  check("E-mail à OrthoNova : proposition retirée", !!(await waitMail("thomas.garnier@demo.kolbase.local", "Proposition retirée")));
  await exp.page.goto(`${BASE}/propositions`);
  const mine = await text(exp.page);
  check("Mes propositions : acceptée, déclinée, retirée", mine.includes("Acceptée") && mine.includes("Déclinée") && mine.includes("Retirée"), mine.slice(0, 400));
  await exp.page.goto(`${BASE}/sollicitations`);
  check("Proposition acceptée : suivie dans les sollicitations", (await text(exp.page)).includes("Votre proposition, acceptée"));
  // Limite contre le démarchage : cinq propositions sur 30 jours.
  await pgc.query(`insert into "ExpertProposal" (id, "practitionerId", title, "typeId", description) select 'e2e-quota-' || g, 'demo-p-roux', 'Quota', 'webinaire', 'Quota' from generate_series(1, 4) g`);
  await exp.page.goto(`${BASE}/propositions/nouvelle`);
  check("Cinq propositions en 30 jours : formulaire remplacé par la consigne", (await text(exp.page)).includes("le maximum") && (await exp.page.locator(".proposal-form").count()) === 0);
  await pgc.query(`delete from "ExpertProposal" where id like 'e2e-quota-%'`);

  // Photo inadaptée : retirée par l'équipe KolBase, l'expert est prévenu avec le motif.
  const adm = await session();
  await login(adm.page, "anne.chevalier@demo.kolbase.local");
  await adm.page.goto(`${BASE}/admin?onglet=praticiens`);
  const ph = adm.page.locator('.photo-review li:has-text("Mathieu Roux")');
  await ph.locator('input[name="note"]').fill("Ce n'est pas un portrait");
  await ph.locator('button:has-text("Retirer")').click();
  await ph.locator('button:has-text("Confirmer : retirer cette photo")').click();
  await adm.page.waitForTimeout(800);
  const after = await q1(`select "photoUpdatedAt", "photoConsentAt" from "PractitionerProfile" where id = 'demo-p-roux'`);
  check("Admin : photo retirée (et l'accord avec)", !after?.photoUpdatedAt && !after?.photoConsentAt && (await fetch(`${BASE}/experts/demo-p-roux/photo`)).status === 404);
  const rm = await waitMail(ROUX, "Votre photo a été retirée");
  check("E-mail à l'expert : photo retirée, avec le motif", !!rm && rm.text.includes("Ce n'est pas un portrait"));
  for (const s of [exp, anon, jul, pie, adm]) await s.ctx.close();
  await pgc.end();
}

// ── Bandeau cookies (CNIL : rien avant l'accord, refuser aussi simple qu'accepter, choix par finalité) ─────
{
  const ctx = await browser.newContext({ locale: "fr-FR", consent: false });
  const page = await ctx.newPage();
  const choice = async (c = ctx) => (await c.cookies(BASE)).find((x) => x.name === "kb_consent");
  await page.goto(`${BASE}/`);
  const banner = page.locator(".cookie-banner");
  check("Cookies : bandeau à la première visite", (await banner.isVisible()) && (await banner.innerText()).includes("KolBase utilise des cookies"));
  const refuse = banner.getByRole("button", { name: "Refuser", exact: true });
  const accept = banner.getByRole("button", { name: "Accepter", exact: true });
  check("Cookies : « Refuser » et « Accepter » au même niveau", (await refuse.getAttribute("class")) === (await accept.getAttribute("class")));
  check("Cookies : ni choix ni script tiers avant de répondre", !(await choice()) && (await page.locator('script[src^="http"]').count()) === 0);
  check("Cookies : lien vers la politique", (await banner.getByRole("link", { name: "En savoir plus" }).getAttribute("href")) === "/confidentialite#cookies");
  await refuse.click();
  const refused = await choice();
  const now = Date.now() / 1000;
  check("Cookies : refus enregistré, bandeau fermé", /^1\.\d+\.00$/.test(refused?.value ?? "") && !(await banner.isVisible()), refused?.value);
  check("Cookies : choix conservé six mois", (refused?.expires ?? 0) > now + 180 * 86400 && (refused?.expires ?? 0) < now + 184 * 86400);
  await page.goto(`${BASE}/agenda`);
  check("Cookies : plus de bandeau après le choix", (await page.locator(".cookie-banner").count()) === 0);
  await page.getByRole("button", { name: "Gérer les cookies" }).click();
  const panel = page.locator(".cookie-banner.panel");
  check(
    "Cookies : « Gérer les cookies » rouvre le choix, finalités refusées décochées",
    (await panel.isVisible()) && !(await panel.locator('input[name="mesure"]').isChecked()) && !(await panel.locator('input[name="marketing"]').isChecked()),
  );
  await panel.locator('input[name="mesure"]').check();
  await panel.getByRole("button", { name: "Enregistrer mes choix" }).click();
  check("Cookies : choix par finalité (mesure d'audience seule)", /^1\.\d+\.10$/.test((await choice())?.value ?? ""));
  await page.reload();
  check("Cookies : sans service configuré, aucun script tiers même accepté", (await page.locator('script[src^="http"]').count()) === 0);
  await ctx.close();
  const en = await browser.newContext({ locale: "en-GB", consent: false });
  await en.addCookies([{ name: "kb_lang", value: "en", url: BASE }]);
  const p2 = await en.newPage();
  await p2.goto(`${BASE}/`);
  const b2 = p2.locator(".cookie-banner");
  check("Cookies : bandeau en anglais", (await b2.innerText()).includes("KolBase uses cookies"));
  await b2.getByRole("button", { name: "Accept", exact: true }).click();
  check("Cookies : accord complet enregistré", /^1\.\d+\.11$/.test((await choice(en))?.value ?? ""));
  await en.close();
  const pol = await (await fetch(`${BASE}/confidentialite`)).text();
  check("Politique : cookie de choix et cookies soumis à accord décrits", pol.includes("kb_consent") && pol.includes('id="cookies"') && pol.includes("Aucun service de mesure d"));
}

// ── Navigation : barre latérale repliée, fiches en onglets, événement du dossier ──
{
  const parisInput = (days, hm) => `${new Date(Date.now() + days * 864e5).toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" })}T${hm}`;
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const { ctx, page } = await session();
  await login(page, "claire.morel@demo.kolbase.local");
  await page.goto(`${BASE}/organisations/demo-org-dentalys`);
  check("Barre latérale : repliée par défaut, sans l'en-tête d'espace répété", (await page.locator("aside.sidebar").count()) === 1 && (await page.locator("aside.sidebar.open").count()) === 0 && (await page.locator("aside.sidebar .space-head, aside.sidebar .space-switch").count()) === 0);
  check("Barre latérale repliée : libellés gardés pour les lecteurs d'écran", (await page.locator('aside.sidebar a.side-link:has-text("Dossiers")').count()) === 1);
  await page.click(".side-toggle");
  await page.reload();
  check("Barre latérale : ouverte, choix mémorisé", (await page.locator("aside.sidebar.open").count()) === 1 && (await ctx.cookies()).some((c) => c.name === "kb_nav" && c.value === "1"));
  await page.click(".side-toggle");
  await page.waitForTimeout(300);

  // Fiche dossier : huit onglets, dans l'ordre du circuit ; la messagerie réunit experts et prestataires de l'événement.
  await page.goto(`${BASE}/organisations/demo-org-dentalys/dossiers/demo-prj-board`);
  const tabsText = (await page.locator("nav.dossier-tabs .dossier-tab").allInnerTexts()).map((x) => x.replace(/\d+/g, "").trim());
  check("Dossier : huit onglets, dans l'ordre du circuit", JSON.stringify(tabsText) === JSON.stringify(["Vue d'ensemble", "Experts", "Événement", "Conformité", "Documents", "Budget", "Frais et voyages", "Messagerie"]), JSON.stringify(tabsText));
  check("Vue d'ensemble : un repère par rubrique, chacun mène à son onglet", (await page.locator(".state-grid a.state-tile").count()) === 6 && (await page.locator('.state-grid a.state-tile[href*="onglet=budget"]').count()) === 1);
  await page.goto(`${BASE}/organisations/demo-org-dentalys/dossiers/demo-prj-board?onglet=marketing`);
  check("Ancien onglet Marketing : l'onglet Événement s'ouvre", (await page.locator('.dossier-tab.active:has-text("Événement")').count()) === 1);
  await tab(page, "messagerie");
  const fils = await page.locator(".messenger-list").innerText();
  check("Messagerie : fils des experts et des prestataires consultés pour l'événement", fils.includes("Hélène Durand") && fils.includes("Prestataires"), fils.replace(/\s+/g, " ").slice(0, 200));

  // Onglet Événement : fermé avant l'accord de principe, ouvert ensuite ; publication après la conformité.
  await db.query(`insert into "Project" (id, "organizationId", title, "typeId", status, "updatedAt") values ('e2e-nav-prj', 'demo-org-dentalys', 'Symposium navigation', 'symposium', 'ATT_EXPERTS', now())`);
  const nav = `${BASE}/organisations/demo-org-dentalys/dossiers/e2e-nav-prj`;
  await page.goto(nav);
  check("Onglet Événement : fermé avant l'accord de principe", (await page.locator('.dossier-tab.disabled:has-text("Événement")').getAttribute("title")) === "S'ouvre à l'accord de principe");
  await db.query(`update "Project" set status = 'ACCORD' where id = 'e2e-nav-prj'`);
  await tab(page, "evenement");
  await Promise.all([page.waitForURL(/nouveau\?dossier=e2e-nav-prj/), page.click('a:has-text("Créer l\'événement du dossier")')]);
  await page.uncheck('input[name="internal"]');
  check("Événement d'un dossier non validé : case « Publier » absente, règle annoncée", (await page.locator('input[name="publish"]').count()) === 0 && (await text(page)).includes("se publie une fois le dossier validé par la conformité"));
  await page.fill('input[name="title"]', "Symposium navigation — session");
  await page.fill('input[name="startsAt"]', parisInput(20, "14:00"));
  await Promise.all([page.waitForURL(/\/dossiers\/e2e-nav-prj\?onglet=evenement/), page.click('button:has-text("Créer l\'événement")')]);
  const t = await text(page);
  check("Événement créé depuis le dossier : retour à l'onglet Événement, fiche complète", t.includes("Symposium navigation — session") && t.includes("Logistique et prestataires") && (await page.locator(".event-hero").count()) === 1);
  check("Dossier non validé : « Publier dans l'agenda » remplacé par la règle", (await page.locator('button:has-text("Publier dans l\'agenda")').count()) === 0 && t.includes("se publie une fois le dossier validé par la conformité"));
  check("Événement d'un dossier (industriel) : validé par la conformité avec le dossier", /examiné avec le dossier/i.test(t) && (await page.locator('#validation button:has-text("Soumettre")').count()) === 0);
  // Validation du dossier (directe en base) : la conformité valide aussi son événement, comme le fait l'action « Valider ».
  await db.query(`update "Project" set status = 'VALIDE' where id = 'e2e-nav-prj'`);
  await db.query(`update "Event" set "reviewStatus" = 'approved', "reviewedAt" = now() where "projectId" = 'e2e-nav-prj'`);
  await page.reload();
  await Promise.all([page.waitForURL(/onglet=evenement.*publie=1/), page.click('button:has-text("Publier dans l\'agenda")')]);
  const evNav = (await db.query(`select "publishedAt" from "Event" where "projectId" = 'e2e-nav-prj'`)).rows[0];
  check("Dossier validé : publication depuis l'onglet, on y reste", !!evNav?.publishedAt && page.url().includes("/dossiers/e2e-nav-prj"), page.url());
  await page.goto(`${BASE}/organisations/demo-org-dentalys/evenements`);
  check("Rubrique Événements : l'événement d'un dossier ouvre l'onglet du dossier", (await page.locator('a.row-item[href*="/dossiers/e2e-nav-prj?onglet=evenement"]').count()) === 1);
  await ctx.close();

  // Praticien : la collaboration en onglets, avec l'événement auquel il participe.
  const hd = await session();
  await login(hd.page, "helene.durand@demo.kolbase.local");
  await hd.page.goto(`${BASE}/sollicitations/demo-prj-board-x1`);
  const ptabs = await hd.page.locator("nav.dossier-tabs").innerText();
  check("Praticien : onglets Mission, Messagerie, Documents et convention, Événement", ["Mission", "Messagerie", "Documents et convention", "Événement"].every((k) => ptabs.includes(k)), ptabs.replace(/\s+/g, " "));
  await tab(hd.page, "evenement");
  check("Praticien : l'événement de la collaboration", (await text(hd.page)).includes("Réunion du board implantologie"));
  await tab(hd.page, "messagerie");
  check("Praticien : la messagerie avec l'organisation", (await hd.page.locator('textarea[name="body"]').count()) === 1);
  await hd.ctx.close();
  await db.query(`delete from "Event" where "projectId" = 'e2e-nav-prj'`);
  await db.query(`delete from "Project" where id = 'e2e-nav-prj'`);
  await db.end();
}

// ── Validation des événements par la conformité (industriel) ──────────────
{
  const pgc = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await pgc.connect();
  const q1 = async (sql, args = []) => (await pgc.query(sql, args)).rows[0];
  const until = async (fn, ms = 8000) => {
    for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 150))) if (await fn()) return true;
    return false;
  };
  const parisInput = (days, hm) => `${new Date(Date.now() + days * 864e5).toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" })}T${hm}`;
  const status = async (id) => (await q1(`select "reviewStatus" from "Event" where id = $1`, [id]))?.reviewStatus;
  const title = "Atelier validation conformité e2e";
  const SOPHIE = "sophie.bernard@demo.kolbase.local";
  const JULIEN = "julien.faure@demo.kolbase.local";
  const jul = await session();
  await login(jul.page, JULIEN);
  await jul.page.goto(`${BASE}/organisations/demo-org-dentalys/evenements/nouveau`);
  check("Industriel : pas de publication immédiate, soumission à la conformité proposée", (await jul.page.locator('input[name="publish"]').count()) === 0 && (await jul.page.locator('input[name="submitReview"]').count()) === 1);
  await jul.page.fill('input[name="title"]', title);
  await jul.page.fill('input[name="startsAt"]', parisInput(40, "18:00"));
  await jul.page.fill('input[name="city"]', "Lyon");
  await jul.page.fill('input[name="venue"]', "Espace Confluence");
  await Promise.all([jul.page.waitForURL(/\/evenements\/(?!nouveau)[^/?#]+$/), jul.page.click('button:has-text("Créer l\'événement")')]);
  const evId = jul.page.url().match(/\/evenements\/([^/?#]+)/)[1];
  let tx = (await text(jul.page)).replace(/\s+/g, " ");
  check("Événement créé : à soumettre, publication après validation", /à soumettre/i.test(tx) && tx.includes("Publication possible une fois l'événement validé par la conformité") && (await jul.page.locator('button:has-text("Publier dans l\'agenda")').count()) === 0, tx.match(/validation par la conformité.{0,160}/i)?.[0]);
  await jul.page.click('#validation button:has-text("Soumettre à la conformité")');
  await until(async () => (await status(evId)) === "submitted");
  check("Soumission : la conformité est prévenue par e-mail", !!(await waitMail(SOPHIE, `Événement à valider : ${title}`)));
  await jul.page.reload();
  check("Soumis : en attente, l'équipe Projets ne valide pas", /en attente de la conformité/i.test(await text(jul.page)) && (await jul.page.locator('button:has-text("Valider l\'événement")').count()) === 0);

  const so = await session();
  await login(so.page, SOPHIE);
  await so.page.goto(`${BASE}/organisations/demo-org-dentalys/conformite?onglet=a-valider`);
  check("Conformité : l'événement dans « Événements à valider »", (await so.page.locator(`#evenements a[href*="/evenements/${evId}"]`).count()) === 1);
  await so.page.goto(`${BASE}/organisations/demo-org-dentalys/evenements/${evId}`);
  tx = (await so.page.locator("#validation").innerText()).replace(/\s+/g, " ");
  check("Conformité : points examinés (date, lieu, programme, hospitalités)", tx.includes("Espace Confluence, Lyon") && /à compléter/i.test(tx) && /hospitalités/i.test(tx), tx.slice(0, 240));
  await so.page.click('#validation button:has-text("Demander des modifications")');
  await so.page.locator("#validation .notice.error").waitFor({ timeout: 10000 }).catch(() => {});
  check("Modifications demandées sans commentaire : refusé", (await so.page.locator("#validation").innerText()).includes("Indiquez les modifications attendues"));
  await so.page.fill('#validation textarea[name="note"]', "Ajouter le programme scientifique détaillé.");
  await so.page.click('#validation button:has-text("Demander des modifications")');
  await until(async () => (await status(evId)) === "changes");
  check("Modifications demandées : enregistrées avec le motif", (await q1(`select "reviewNote" from "Event" where id = $1`, [evId]))?.reviewNote === "Ajouter le programme scientifique détaillé.");
  const chMail = await waitMail(JULIEN, `Modifications demandées par la conformité : ${title}`);
  check("E-mail à l'équipe Projets : motif transmis", !!chMail && chMail.text.includes("Ajouter le programme scientifique détaillé."));

  await jul.page.reload();
  check("Équipe Projets : motif affiché, nouvelle soumission possible", (await jul.page.locator("#validation").innerText()).includes("Ajouter le programme scientifique détaillé.") && (await jul.page.locator('#validation button:has-text("Soumettre de nouveau")').count()) === 1);
  await jul.page.click('#validation button:has-text("Soumettre de nouveau")');
  await until(async () => (await status(evId)) === "submitted");

  await so.page.reload();
  await so.page.click('#validation button:has-text("Valider l\'événement")');
  await until(async () => (await status(evId)) === "approved");
  check("Validation : enregistrée, l'équipe Projets prévenue", (await status(evId)) === "approved" && !!(await waitMail(JULIEN, `Événement validé par la conformité : ${title}`)));

  await jul.page.reload();
  await Promise.all([jul.page.waitForURL(/\?publie=1/), jul.page.click('button:has-text("Publier dans l\'agenda")')]);
  check("Validé : publication dans l'agenda", !!(await q1(`select "publishedAt" from "Event" where id = $1`, [evId]))?.publishedAt);
  await jul.page.click("#modifier summary");
  await jul.page.fill('#modifier input[name="startsAt"]', parisInput(41, "18:00"));
  await jul.page.click('button:has-text("Mettre à jour l\'événement")');
  await until(async () => (await status(evId)) === "submitted");
  const ev = await q1(`select "reviewStatus", "reviewChanges", "publishedAt" from "Event" where id = $1`, [evId]);
  check("Date modifiée après validation : renvoyé à la conformité, toujours en ligne", ev?.reviewStatus === "submitted" && ev.reviewChanges.includes("date") && !!ev.publishedAt, JSON.stringify(ev));
  await so.page.reload();
  check("Conformité : changement signalé", (await so.page.locator("#validation").innerText()).includes("Modifié après validation : date"));
  await jul.ctx.close();

  // Réglage de la conformité : validation exigée par défaut pour un industriel, désactivable.
  await so.page.goto(`${BASE}/organisations/demo-org-dentalys/conformite?onglet=parametres`);
  check("Paramètres : validation des événements activée (industriel)", await so.page.isChecked('#validation-evenements input[name="eventReview"]'));
  await so.page.uncheck('#validation-evenements input[name="eventReview"]');
  await so.page.click('#validation-evenements button:has-text("Enregistrer")');
  await until(async () => (await q1(`select "eventReview" from "Organization" where id = 'demo-org-dentalys'`))?.eventReview === false);
  check("Paramètres : validation des événements désactivée", (await q1(`select "eventReview" from "Organization" where id = 'demo-org-dentalys'`))?.eventReview === false);
  await so.ctx.close();
  await pgc.query(`update "Organization" set "eventReview" = true where id = 'demo-org-dentalys'`);
  await pgc.query(`delete from "Event" where id = $1`, [evId]);
  await pgc.end();
}

// ── Prestataires et devis : annuaire en cartes, page d'une demande, ajouter, relancer, version à jour, book ─
{
  const pgc = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await pgc.connect();
  const q1 = async (sql, args = []) => (await pgc.query(sql, args)).rows[0];
  const until = async (fn, ms = 8000) => {
    for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 150))) if (await fn()) return true;
    return false;
  };
  const CLAIRE = "claire.morel@demo.kolbase.local";
  const ORGP = `${BASE}/organisations/demo-org-dentalys/prestataires`;
  const cl = await session();
  await login(cl.page, CLAIRE);
  // Liste rangée par état : chaque demande en une ligne qui mène à sa page.
  await cl.page.goto(ORGP);
  const groups = await cl.page.locator("main section.row-list h2").allInnerTexts();
  check("Demandes rangées par état (à décider, en attente, attribuées)", groups.some((g) => g.startsWith("À décider")) && groups.some((g) => g.startsWith("Attribuées")), groups.join(" | "));
  await Promise.all([cl.page.waitForURL(/\/prestataires\/demo-rfq-board-salle$/), cl.page.click("a.rfq-row#ligne-demo-rfq-board-salle")]);
  check("Ligne de demande : ouvre la page de la demande, étapes affichées", (await cl.page.locator("section#rfq-demo-rfq-board-salle ol.step-trail li").count()) === 5);
  // Annuaire : « Demander un devis » préremplit la catégorie et le prestataire.
  await cl.page.goto(`${ORGP}?onglet=annuaire&cat=restauration`);
  await Promise.all([cl.page.waitForURL(/prestataire=demo-sup-belleville/), cl.page.locator('article.supplier-card:has-text("Traiteur Belleville") a:has-text("Demander un devis")').click()]);
  const pick = await cl.page.locator('.supplier.pick:has-text("Traiteur Belleville")').innerText();
  check("Annuaire : « Demander un devis » présélectionne le prestataire", pick.includes("Sélectionné") && (await cl.page.locator(".rfq-recap").innerText()).includes("Traiteur Belleville"), pick.slice(0, 120));
  // Page publique du prestataire : « Demander un devis » pour un membre d'une organisation cliente.
  await cl.page.goto(`${BASE}/structures/demo-sup-belleville`);
  const ask = await cl.page.locator('.profile-hero a:has-text("Demander un devis")').getAttribute("href");
  check("Book public : « Demander un devis » vers la nouvelle demande", !!ask && ask.includes("onglet=nouvelle") && ask.includes("prestataire=demo-sup-belleville"), ask ?? "");

  // Demande envoyée il y a trois jours à un seul traiteur : en consulter un autre, puis relancer.
  await pgc.query(`insert into "Rfq" (id, "organizationId", category, needs, status, "sentAt", headcount, city, deadline) values ('e2e-pd-rfq', 'demo-org-dentalys', 'restauration', 'Buffet des partenaires pd, 30 personnes.', 'sent', now() - interval '3 days', 30, 'Lyon', now() + interval '10 days')`);
  await pgc.query(`insert into "RfqSupplier" ("rfqId", "supplierId") values ('e2e-pd-rfq', 'demo-sup-belleville')`);
  await cl.page.goto(`${ORGP}/e2e-pd-rfq`);
  const add = cl.page.locator("details.add-supplier");
  await add.locator("summary").click();
  await add.locator('input[name="supplierIds"][value="demo-sup-tablesdusud"]').check();
  await add.locator('button:has-text("Consulter")').click();
  await until(async () => !!(await q1(`select 1 from "RfqSupplier" where "rfqId" = 'e2e-pd-rfq' and "supplierId" = 'demo-sup-tablesdusud'`)));
  check("Demande envoyée : un prestataire de plus consulté", !!(await q1(`select 1 from "RfqSupplier" where "rfqId" = 'e2e-pd-rfq' and "supplierId" = 'demo-sup-tablesdusud'`)));
  await cl.page.reload();
  const remind = cl.page.locator('section#rfq-e2e-pd-rfq form:has(button:has-text("Relancer"))');
  await remind.locator('button:has-text("Relancer")').click();
  await remind.locator('button:has-text("Confirmer")').click();
  await until(async () => (await q1(`select count(*)::int n from "RfqSupplier" where "rfqId" = 'e2e-pd-rfq' and "remindedAt" is not null`))?.n === 2);
  check("Relance : les deux prestataires sans réponse relancés par e-mail", (await q1(`select count(*)::int n from "RfqSupplier" where "rfqId" = 'e2e-pd-rfq' and "remindedAt" is not null`))?.n === 2 && !!(await waitMail("ludovic.perrin@demo.kolbase.local", "Relance : demande de devis de Dentalys Implants")));
  await cl.page.reload();
  check("Relance : plus proposée avant 48 heures", (await cl.page.locator('section#rfq-e2e-pd-rfq button:has-text("Relancer")').count()) === 0);
  // Offre expirée : demander une version à jour (message dans le fil du prestataire).
  await pgc.query(`insert into "Quote" (id, "rfqId", "supplierId", "amountCents", "vatBp", "validUntil", "updatedAt") values ('e2e-pd-q', 'e2e-pd-rfq', 'demo-sup-belleville', 60000, 1000, now() - interval '1 day', now())`);
  await cl.page.reload();
  await cl.page.locator('section#rfq-e2e-pd-rfq .quote:has-text("Traiteur Belleville") button:has-text("Demander une version à jour")').click();
  await until(async () => !!(await q1(`select 1 from "RfqMessage" where "rfqId" = 'e2e-pd-rfq' and "supplierId" = 'demo-sup-belleville' and body like '%version à jour%'`)));
  check("Offre expirée : version à jour demandée au prestataire", !!(await waitMail("ludovic.perrin@demo.kolbase.local", "Message de Dentalys Implants")));
  await cl.ctx.close();

  // Prestataire : la demande à part, son devis lisible ; « Ma page prestataire » à part.
  const sup = await session();
  await login(sup.page, "ludovic.perrin@demo.kolbase.local");
  await sup.page.goto(`${BASE}/organisations/demo-sup-belleville/devis`);
  const todo = await sup.page.locator('section.row-list:has(h2:has-text("Devis envoyés"))').innerText().catch(() => "");
  check("Prestataire : demandes rangées (devis envoyés)", todo.includes("Buffet des partenaires") || todo.includes("Soirée implantologie"), todo.slice(0, 200));
  await sup.page.goto(`${BASE}/organisations/demo-sup-belleville/devis/e2e-pd-rfq`);
  const mine = await sup.page.locator("section.rfq-mine").innerText();
  check("Prestataire : son devis lisible et la demande de version à jour dans les échanges", /600 € HT/.test(mine.replace(/\s+/g, " ")) && (await sup.page.locator("section.rfq-talk").innerText()).includes("version à jour"), mine.slice(0, 200));
  await sup.page.goto(`${BASE}/organisations/demo-sup-belleville/devis?onglet=fiche`);
  check("« Ma page prestataire » : page à part, dans la navigation", sup.page.url().endsWith("/organisations/demo-sup-belleville/page-prestataire") && (await sup.page.locator('a.side-link[href="/organisations/demo-sup-belleville/page-prestataire"]').count()) === 1, sup.page.url());
  await sup.ctx.close();
  await pgc.query(`delete from "Rfq" where id = 'e2e-pd-rfq'`);
  await pgc.end();
}

// ── Filtres des opportunités : publique, praticien, organisation ──────────
{
  const anon = await session();
  await anon.page.goto(`${BASE}/appels?evenement=avec`);
  const pub = await text(anon.page);
  check("Opportunités publiques : filtre « intervenir à un événement » et pastille active", (await anon.page.locator('.active-filters a:has-text("Intervenir à un événement")').count()) === 1 && /\d+ opportunités?/.test(pub));
  await anon.page.locator('.active-filters a:has-text("Intervenir à un événement")').click();
  await anon.page.waitForURL((u) => !u.search.includes("evenement"));
  check("Opportunités publiques : la pastille retire le filtre", (await anon.page.locator(".active-filters").count()) === 0);
  await anon.ctx.close();
  const exp = await session();
  await login(exp.page, "antoine.martin@demo.kolbase.local");
  await exp.page.goto(`${BASE}/opportunites`);
  await Promise.all([exp.page.waitForURL(/candidature=sans/), exp.page.selectOption('select[name="candidature"]', "sans")]);
  check("Opportunités (praticien) : filtre appliqué dès le choix, sans bouton", (await exp.page.locator('.active-filters a:has-text("Sans ma candidature")').count()) === 1);
  await exp.ctx.close();
  const org = await session();
  await login(org.page, "claire.morel@demo.kolbase.local");
  await org.page.goto(`${BASE}/organisations/demo-org-dentalys/opportunites?statut=a-examiner`);
  const rows = await org.page.locator("section.row-list a.row-item").allInnerTexts();
  check("Opportunités (organisation) : « Candidatures à examiner » ne garde que celles qui en ont", rows.length > 0 && rows.every((r) => /à examiner/.test(r)), rows.join(" | ").slice(0, 300));
  await org.ctx.close();
}

// ── Administration KolBase : tableau de bord, navigation, comptes (actions sensibles), journal, exploitation ──
{
  const pgc = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await pgc.connect();
  const q1 = async (sql, args = []) => (await pgc.query(sql, args)).rows[0];
  const adm = await session();
  await login(adm.page, "anne.chevalier@demo.kolbase.local");
  await adm.page.goto(`${BASE}/admin`);
  let t = await text(adm.page);
  check("Admin : tableau de bord (à traiter, activité hors démonstration, journal récent)", t.includes("À traiter") && t.includes("hors données de démonstration") && t.includes("Journal récent"));
  const nav = await adm.page.locator("nav.side-nav a").allInnerTexts();
  check("Admin : navigation latérale de l'administration", ["Tableau de bord", "Organisations", "Comptes", "Identités", "Journal d'activité", "Exploitation"].every((x) => nav.some((n) => n.includes(x))), nav.join(" | "));
  await adm.page.goto(`${BASE}/admin?onglet=praticiens`);
  check("Admin : anciens onglets redirigés vers leur page", adm.page.url().endsWith("/admin/identites"), adm.page.url());

  await adm.page.goto(`${BASE}/admin/comptes?q=nadia+haddad`);
  const rows = await adm.page.locator("section.row-list a.row-item").allInnerTexts();
  check("Comptes : recherche par nom", rows.length === 1 && rows[0].includes("nadia.haddad@demo.kolbase.local"), rows.join(" | "));
  const { id: uid } = await q1(`select id from "User" where email = 'nadia.haddad@demo.kolbase.local'`);
  // Une session ouverte, puis une double authentification (téléphone perdu) à réinitialiser.
  const nadia = await session();
  await login(nadia.page, "nadia.haddad@demo.kolbase.local");
  await pgc.query(`update "User" set "totpSecret" = 'JBSWY3DPEHPK3PXP', "totpEnabledAt" = now(), "recoveryCodes" = '{a,b}' where id = $1`, [uid]);
  await adm.page.goto(`${BASE}/admin/comptes/${uid}`);
  t = await text(adm.page);
  check("Fiche compte : identité, organisations, actions", t.includes("Identité et sécurité") && t.includes("Dentalys Implants") && t.includes("Actions de l'équipe KolBase"));
  const reset = adm.page.locator('form:has(input[aria-label="Motif de la réinitialisation"])');
  await reset.locator('input[name="note"]').fill("Téléphone perdu, identité vérifiée par téléphone");
  await reset.locator('button:has-text("Réinitialiser la double authentification")').click();
  await Promise.all([adm.page.waitForURL(/fait=2fa/), reset.locator('button:has-text("Confirmer : réinitialiser")').click()]);
  const after2fa = await q1(`select "totpEnabledAt", array_length("recoveryCodes", 1) n, (select count(*)::int from "Session" where "userId" = $1) s from "User" where id = $1`, [uid]);
  check("Double authentification réinitialisée : secret, codes et sessions effacés", after2fa.totpEnabledAt === null && !after2fa.n && after2fa.s === 0, JSON.stringify(after2fa));
  const m2fa = await waitMail("nadia.haddad@demo.kolbase.local", "Sécurité de votre compte KolBase");
  check("E-mail : réinitialisation annoncée, avec le motif", !!m2fa && m2fa.text.includes("Téléphone perdu"));
  await nadia.page.goto(`${BASE}/compte`);
  check("Session fermée : reconnexion demandée", nadia.page.url().includes("/connexion"), nadia.page.url());

  const off = adm.page.locator('form:has(input[aria-label="Motif de la désactivation"])');
  check("Désactivation : motif obligatoire", (await off.locator('input[name="note"][required]').count()) === 1);
  await off.locator('input[name="note"]').fill("Usage contraire aux conditions d'utilisation");
  await off.locator('button:has-text("Désactiver le compte")').click();
  await Promise.all([adm.page.waitForURL(/fait=desactive/), off.locator('button:has-text("Confirmer : désactiver")').click()]);
  check("Compte désactivé : état affiché", (await text(adm.page)).includes("Compte désactivé le"));
  check("E-mail : désactivation annoncée, avec le motif", !!(await waitMail("nadia.haddad@demo.kolbase.local", "Votre compte KolBase est désactivé")));
  await login(nadia.page, "nadia.haddad@demo.kolbase.local");
  check("Compte désactivé : connexion refusée", nadia.page.url().includes("/connexion") && (await text(nadia.page)).includes("Ce compte a été désactivé par l'équipe KolBase"));
  const sent = mails.length;
  await nadia.page.goto(`${BASE}/mot-de-passe-oublie`);
  await nadia.page.fill('input[name="email"]', "nadia.haddad@demo.kolbase.local");
  await nadia.page.click('button:has-text("Recevoir le lien")');
  await nadia.page.waitForTimeout(1200);
  check("Compte désactivé : aucun lien de réinitialisation", !mails.slice(sent).some((m) => m.to === "nadia.haddad@demo.kolbase.local"));
  await adm.page.goto(`${BASE}/admin/comptes?etat=desactives`);
  check("Comptes : filtre « Désactivés »", (await adm.page.locator("section.row-list a.row-item").allInnerTexts()).some((r) => r.includes("nadia.haddad")));

  await adm.page.goto(`${BASE}/admin/comptes/${uid}`);
  await Promise.all([adm.page.waitForURL(/fait=reactive/), adm.page.click('button:has-text("Réactiver le compte")')]);
  await login(nadia.page, "nadia.haddad@demo.kolbase.local");
  check("Compte réactivé : connexion de nouveau possible", !nadia.page.url().includes("/connexion"), nadia.page.url());
  await nadia.ctx.close();

  await adm.page.goto(`${BASE}/admin/journal?periode=24h&objet=${uid}`);
  t = await text(adm.page);
  check("Journal : décisions de KolBase sur le compte", ["Double authentification réinitialisée par KolBase", "Compte désactivé par KolBase", "Compte réactivé par KolBase", "Connexion refusée (compte désactivé)"].every((x) => t.includes(x)));
  await adm.page.goto(`${BASE}/admin/journal?domaine=securite&periode=24h`);
  check("Journal : filtre « Sécurité »", (await text(adm.page)).includes("Connexion refusée (compte désactivé)"));
  const { id: anneId } = await q1(`select id from "User" where email = 'anne.chevalier@demo.kolbase.local'`);
  await adm.page.goto(`${BASE}/admin/comptes/${anneId}`);
  t = await text(adm.page);
  check("Fiche de son propre compte : aucune action sensible", t.includes("Votre propre compte se gère depuis") && !t.includes("Désactiver le compte"));

  await adm.page.goto(`${BASE}/admin/organisations/demo-org-dentalys`);
  t = await text(adm.page);
  check("Fiche organisation : décision, activité, membres, journal", t.includes("Activité et abonnement") && t.includes("Membres (") && t.includes("Nadia Haddad") && t.includes("Journal de l'organisation"));
  await adm.page.goto(`${BASE}/admin/organisations?famille=prestataires`);
  const sup = await adm.page.locator("section.row-list a.row-item").allInnerTexts();
  check("Organisations : filtre par famille", sup.length > 0 && sup.some((r) => r.includes("Traiteur Belleville")) && !sup.some((r) => r.includes("Dentalys")), String(sup.length));
  await adm.page.goto(`${BASE}/admin/exploitation`);
  t = await text(adm.page);
  check("Exploitation : lancement, tâches, sécurité, Stripe", t.includes("Avant l'ouverture au public") && t.includes("Tâches planifiées") && t.includes("Sécurité et comptes") && t.includes("Notifications Stripe"));
  await adm.ctx.close();

  const claire = await session();
  await login(claire.page, "claire.morel@demo.kolbase.local");
  const denied = await claire.page.goto(`${BASE}/admin/comptes/${uid}`);
  check("Administration : fiche d'un compte inaccessible sans droit", denied?.status() === 404, String(denied?.status()));
  await claire.ctx.close();
  await pgc.end();
}

// ── Données de démonstration signalées, prestataire présenté par sa catégorie ──────────────
{
  const v = await session();
  await v.page.goto(`${BASE}/experts/demo-p-durand`);
  check("Démonstration : fiche d'expert fictif signalée", (await text(v.page)).includes("Profil fictif, présenté pour la démonstration de KolBase"));
  await v.page.goto(`${BASE}/evenements/demo-ev-live-surgery`);
  check("Démonstration : événement fictif signalé", (await text(v.page)).includes("Événement fictif, présenté pour la démonstration de KolBase"));
  await v.page.goto(`${BASE}/experts`);
  check("Démonstration : étiquette sur les cartes d'experts", /démonstration/i.test(await v.page.locator('a.kol-card[href="/experts/demo-p-durand"]').innerText()));
  await v.page.goto(`${BASE}/evenements`);
  check("Démonstration : étiquette sur les cartes de l'agenda", (await v.page.locator("article.event-card .demo-tag").count()) > 0);
  await v.page.goto(`${BASE}/structures/demo-sup-belleville`);
  const tag = (await v.page.locator(".profile-hero .sector-tag").innerText()).trim();
  check("Prestataire : présenté par sa catégorie", /^restauration et traiteur$/i.test(tag) && (await v.page.title()).includes("Restauration et traiteur"), `${tag} | ${await v.page.title()}`);
  check("Démonstration : organisation fictive signalée", (await text(v.page)).includes("Organisation fictive, présentée pour la démonstration de KolBase"));
  await v.page.goto(`${BASE}/structures/straumann`);
  check("Organisation réelle : pas de mention de démonstration", !(await text(v.page)).includes("présentée pour la démonstration"));
  await v.ctx.close();
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
