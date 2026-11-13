// Faux services externes pour les parcours : répertoire des entreprises, fichiers Google partagés par lien et ORCID
// (OAuth + API publique). L'application doit être lancée avec SIREN_API_URL=http://localhost:3998,
// GOOGLE_FILES_URL=http://localhost:3998, ORCID_BASE_URL=http://localhost:3997,
// ORCID_PUB_API_URL=http://localhost:3997/v3.0, ORCID_CLIENT_ID et ORCID_CLIENT_SECRET définis,
// SMTP_URL=smtp://localhost:2525 et MAIL_DELIVER_RESERVED=1 (les comptes de démo sont en .local),
// S3_ENDPOINT=http://localhost:3996, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY et S3_FORCE_PATH_STYLE=1,
// YOUSIGN_API_KEY=test, YOUSIGN_API_URL=http://localhost:3995 et YOUSIGN_WEBHOOK_SECRET=test.
import http from "node:http";
import { createHmac, randomUUID } from "node:crypto";
import { SMTPServer } from "smtp-server";
import { simpleParser } from "mailparser";

/** E-mails reçus par le faux serveur SMTP (port 2525) : { to, subject, text, attachments }. */
export const mails = [];

const json = (res, body, status = 200) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};

export const ENTREPRISES = {
  "542051180": { siren: "542051180", nom_complet: "IMPLANTS EXPRESS SAS", etat_administratif: "A", siege: { libelle_commune: "LYON" } },
  "732829320": { siren: "732829320", nom_complet: "ANCIENNE SOCIETE", etat_administratif: "C", siege: { libelle_commune: "PARIS" } },
};
export const ORCID_ID = "0000-0002-1825-0097";
/** Objets reçus par le faux stockage S3 (port 3996, adressage par chemin /compartiment/clé). */
export const objects = new Map();

/** Fichiers « partagés par lien » du faux Google (GOOGLE_FILES_URL=http://localhost:3998) : identifiant → contenu CSV. */
export const googleFiles = new Map();

export function startFakes() {
  const siren = http.createServer((req, res) => {
    const asked = new URL(req.url, "http://x");
    if (asked.pathname === "/download") {
      // Fichier inconnu : comme Google pour un fichier non partagé, une page de connexion (HTML) à la place du CSV.
      const body = googleFiles.get(asked.searchParams.get("id"));
      res.writeHead(200, { "Content-Type": body ? "text/csv" : "text/html; charset=utf-8" });
      return res.end(body ?? "<html><body>Connexion</body></html>");
    }
    const q = asked.searchParams.get("q") ?? "";
    json(res, { results: ENTREPRISES[q] ? [ENTREPRISES[q]] : [], total_results: ENTREPRISES[q] ? 1 : 0 });
  });
  const orcid = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/oauth/authorize") {
      const back = new URL(url.searchParams.get("redirect_uri"));
      back.searchParams.set("code", "code-de-test");
      back.searchParams.set("state", url.searchParams.get("state") ?? "");
      res.writeHead(302, { Location: back.toString() });
      return res.end();
    }
    if (url.pathname === "/oauth/token" && req.method === "POST") return json(res, { access_token: "jeton", orcid: ORCID_ID, name: "Test" });
    if (url.pathname === `/v3.0/${ORCID_ID}/works`)
      return json(res, {
        group: [{ "work-summary": [{ title: { title: { value: "Publication importée depuis ORCID (test)" } }, "journal-title": { value: "Revue de test" }, "publication-date": { year: { value: "2025" } }, "external-ids": { "external-id": [{ "external-id-type": "doi", "external-id-value": "10.1234/kolbase-test" }] } }] }],
      });
    json(res, { error: "introuvable" }, 404);
  });
  const smtp = new SMTPServer({
    authOptional: true,
    disabledCommands: ["STARTTLS"],
    logger: false,
    onData(stream, session, done) {
      simpleParser(stream).then((m) => {
        const attachments = (m.attachments ?? []).map((a) => ({ filename: a.filename, contentType: a.contentType, content: a.content.toString("utf8") }));
        for (const to of session.envelope.rcptTo) mails.push({ to: to.address, subject: m.subject ?? "", text: m.text ?? "", attachments });
        done();
      }, done);
    },
  });
  const s3 = http.createServer((req, res) => {
    const key = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (req.method === "PUT") {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        objects.set(key, { body: Buffer.concat(chunks), type: req.headers["content-type"] });
        res.writeHead(200, { ETag: '"etag"' });
        res.end();
      });
      return;
    }
    const o = objects.get(key);
    if (req.method === "DELETE") { objects.delete(key); res.writeHead(204); return res.end(); }
    if (!o) { res.writeHead(404, { "Content-Type": "application/xml" }); return res.end("<Error><Code>NoSuchKey</Code></Error>"); }
    res.writeHead(200, { "Content-Type": o.type ?? "application/octet-stream", "Content-Length": o.body.length });
    res.end(o.body);
  });
  s3.listen(3996);
  siren.listen(3998);
  orcid.listen(3997);
  smtp.listen(2525);
  const stopYousign = startFakeYousign();
  const stopAi = startFakeAnthropic();
  const stopStripe = startFakeStripe();
  return () => { siren.close(); orcid.close(); smtp.close(); s3.close(); stopYousign(); stopAi(); stopStripe(); };
}

/** Requêtes reçues par le faux service d'IA (corps JSON), pour vérifier ce qui est transmis. */
export const aiRequests = [];

/** Faux service d'IA (API Messages, port 3994) : vérifie l'en-tête et le corps, renvoie un brouillon reconnaissable. */
export function startFakeAnthropic(port = 3994) {
  const server = http.createServer((req, res) => {
    const c = [];
    req.on("data", (x) => c.push(x));
    req.on("end", () => {
      if (req.method !== "POST" || new URL(req.url, "http://x").pathname !== "/v1/messages") return json(res, { error: { message: "not found" } }, 404);
      if (req.headers["x-api-key"] !== "test" || !req.headers["anthropic-version"]) return json(res, { error: { message: "unauthorized" } }, 401);
      const b = JSON.parse(Buffer.concat(c).toString() || "{}");
      if (!b.model || !b.max_tokens || !Array.isArray(b.messages) || !b.system) return json(res, { error: { message: "invalid request" } }, 400);
      aiRequests.push(b);
      const prompt = String(b.messages[0]?.content ?? "");
      const text = prompt.includes("programme scientifique")
        ? "PROPOSITION IA\n18:00 – 18:15  Accueil des participants\n18:15 – 19:00  Cas cliniques — [intervenant à confirmer]\n19:00 – 19:30  Échanges avec la salle"
        : `PROPOSITION IA — ${prompt.split("\n")[0].slice(0, 80)}`;
      json(res, { id: "msg_test", type: "message", role: "assistant", model: b.model, content: [{ type: "text", text }], stop_reason: "end_turn" });
    });
  });
  server.listen(port);
  return () => server.close();
}

/**
 * Demandes reçues par le faux Yousign (API v3) : id → { body, status, documents, signers, pdf, completed_at, decline_information }.
 * Le test modifie `status` pour simuler la signature, un refus ou une expiration.
 */
export const signatureRequests = new Map();
export const YOUSIGN_KEY = "test";

/** Faux Yousign (port 3995 par défaut) : création, dépôt du PDF, signataires, activation, annulation, statut, téléchargement. */
export function startFakeYousign(port = 3995) {
  const read = (req) => new Promise((resolve) => { const c = []; req.on("data", (x) => c.push(x)); req.on("end", () => resolve(Buffer.concat(c))); });
  const server = http.createServer(async (req, res) => {
    const body = await read(req);
    if (req.headers.authorization !== `Bearer ${YOUSIGN_KEY}`) return json(res, { detail: "Unauthorized" }, 401);
    const path = new URL(req.url, "http://x").pathname;
    const m = path.match(/^\/signature_requests(?:\/([^/]+))?(?:\/(documents|signers|activate|cancel))?(?:\/([^/]+))?(?:\/(download))?$/);
    if (!m) return json(res, { detail: "Not found" }, 404);
    const [, id, sub, docId, dl] = m;
    if (!id && req.method === "POST") {
      const b = JSON.parse(body.toString() || "{}");
      if (!b.name || b.delivery_mode !== "email") return json(res, { detail: "name et delivery_mode requis" }, 400);
      const sr = { id: randomUUID(), body: b, status: "draft", documents: [], signers: [], pdf: null, completed_at: null, decline_information: null };
      signatureRequests.set(sr.id, sr);
      return json(res, { id: sr.id, status: sr.status }, 201);
    }
    const sr = signatureRequests.get(id);
    if (!sr) return json(res, { detail: "Signature request not found" }, 404);
    if (sub === "documents" && !docId && req.method === "POST") {
      if (!String(req.headers["content-type"]).startsWith("multipart/form-data") || !body.includes('name="nature"') || !body.includes("signable_document"))
        return json(res, { detail: "file et nature requis" }, 400);
      const start = body.indexOf("%PDF-"), end = body.lastIndexOf("%%EOF");
      if (start < 0 || end < 0) return json(res, { detail: "PDF invalide" }, 400);
      sr.pdf = body.subarray(start, end + 5);
      const doc = { id: randomUUID(), nature: "signable_document" };
      sr.documents.push(doc);
      return json(res, doc, 201);
    }
    if (sub === "signers" && req.method === "POST") {
      const b = JSON.parse(body.toString());
      const ok = b.info?.email && b.info?.first_name && b.info?.last_name && b.info?.locale && b.signature_level && (b.fields ?? []).every((f) => sr.documents.some((d) => d.id === f.document_id) && f.page >= 1 && f.x >= 0 && f.y >= 0);
      if (!ok) return json(res, { detail: "Signataire invalide" }, 400);
      const signer = { id: randomUUID(), status: "initiated", ...b };
      sr.signers.push(signer);
      return json(res, { id: signer.id, status: signer.status }, 201);
    }
    if (sub === "activate" && req.method === "POST") {
      if (sr.status !== "draft" || !sr.documents.length || !sr.signers.length) return json(res, { detail: "Activation impossible" }, 400);
      sr.status = "ongoing";
      return json(res, { id: sr.id, status: sr.status }, 201);
    }
    // Annulation : seule une demande en cours (ou en approbation) s'annule, avec une raison reconnue.
    if (sub === "cancel" && req.method === "POST") {
      const b = JSON.parse(body.toString() || "{}");
      if (!["ongoing", "approval"].includes(sr.status)) return json(res, { detail: "Only ongoing or approval signature requests can be canceled" }, 400);
      if (!["contractualization_aborted", "errors_in_document", "other"].includes(b.reason) || (b.reason === "other" && !b.custom_note)) return json(res, { detail: "reason invalide" }, 400);
      sr.status = "canceled";
      sr.cancelation = b;
      return json(res, { id: sr.id, status: sr.status }, 201);
    }
    if (sub === "documents" && docId && dl && req.method === "GET") {
      if (!sr.documents.some((d) => d.id === docId)) return json(res, { detail: "Document not found" }, 404);
      const signed = Buffer.concat([sr.pdf, Buffer.from(`\n% Signé électroniquement (faux Yousign) ${sr.id}\n`)]);
      res.writeHead(200, { "Content-Type": "application/pdf", "Content-Length": signed.length });
      return res.end(signed);
    }
    if (!sub && req.method === "GET")
      return json(res, { id: sr.id, status: sr.status, completed_at: sr.completed_at, decline_information: sr.decline_information, documents: sr.documents, signers: sr.signers.map((s) => ({ id: s.id, status: s.status })) });
    json(res, { detail: "Method not allowed" }, 405);
  });
  server.listen(port);
  return () => server.close();
}

/**
 * Faux Stripe (port 3993) : clients, sessions de paiement (page « Payer » qui crée l'abonnement en essai et
 * prévient l'application par une notification signée), abonnements et leurs lignes (options), produits, portail,
 * lignes de facture.
 */
export const stripeState = { customers: new Map(), sessions: new Map(), subscriptions: new Map(), products: new Map(), invoiceItems: [], webhooks: [] };
export const STRIPE_WEBHOOK_SECRET = "whsec_test";
const APP = process.env.BASE ?? "http://localhost:3000";

/** Envoie une notification Stripe signée à l'application (même `id` = rejeu d'un événement déjà reçu). */
export async function stripeWebhook(type, object, id = `evt_${randomUUID().slice(0, 8)}`) {
  const payload = JSON.stringify({ id, type, data: { object } });
  const t = Math.floor(Date.now() / 1000);
  const sig = createHmac("sha256", STRIPE_WEBHOOK_SECRET).update(`${t}.${payload}`).digest("hex");
  const r = await fetch(`${APP}/api/stripe/webhook`, { method: "POST", headers: { "Content-Type": "application/json", "Stripe-Signature": `t=${t},v1=${sig}` }, body: payload });
  stripeState.webhooks.push({ id, type, status: r.status, body: await r.json().catch(() => null) });
  return r.status;
}

export function startFakeStripe(port = 3993) {
  const read = (req) => new Promise((resolve) => { const c = []; req.on("data", (x) => c.push(x)); req.on("end", () => resolve(Buffer.concat(c).toString())); });
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    const form = new URLSearchParams(await read(req));
    const get = (k) => form.get(k);
    // Pages « navigateur » : paiement et portail.
    let m = url.pathname.match(/^\/pay\/(cs_[a-z0-9]+)$/);
    if (m) {
      const s = stripeState.sessions.get(m[1]);
      if (!s) return json(res, { error: "session" }, 404);
      const now = Math.floor(Date.now() / 1000);
      const trial = Number(s.trialDays || 0);
      const year = s.interval === "year";
      const sub = { id: `sub_${randomUUID().slice(0, 10).replace(/-/g, "")}`, object: "subscription", customer: s.customer, status: trial ? "trialing" : "active", trial_end: trial ? now + trial * 86400 : null, current_period_end: now + (trial || (year ? 365 : 30)) * 86400, cancel_at_period_end: false, metadata: { orgId: s.metadata.orgId }, amount: s.amount, items: { data: [{ id: `si_${randomUUID().slice(0, 8)}`, price: { product: "prod_abonnement", unit_amount: s.amount, recurring: { interval: s.interval } } }] } };
      stripeState.subscriptions.set(sub.id, sub);
      s.subscription = sub.id;
      s.status = "complete";
      await stripeWebhook("checkout.session.completed", { id: s.id, object: "checkout.session", customer: s.customer, subscription: sub.id, metadata: s.metadata });
      res.writeHead(302, { Location: s.success_url.replace("{CHECKOUT_SESSION_ID}", s.id) });
      return res.end();
    }
    if (url.pathname === "/portal") { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); return res.end(`<h1>Portail Stripe (test)</h1><a href="${url.searchParams.get("back")}">Retour</a>`); }
    if (req.headers.authorization !== "Bearer test") return json(res, { error: { message: "clé invalide" } }, 401);
    if (req.method === "POST" && url.pathname === "/v1/customers") {
      const c = { id: `cus_${randomUUID().slice(0, 10).replace(/-/g, "")}`, email: get("email"), name: get("name"), metadata: { orgId: get("metadata[orgId]") } };
      stripeState.customers.set(c.id, c);
      return json(res, c);
    }
    if (req.method === "POST" && url.pathname === "/v1/checkout/sessions") {
      const id = `cs_${randomUUID().slice(0, 12).replace(/-/g, "")}`;
      const s = {
        id, customer: get("customer"), mode: get("mode"), success_url: get("success_url"), cancel_url: get("cancel_url"),
        metadata: { orgId: get("metadata[orgId]") }, trialDays: get("subscription_data[trial_period_days]"),
        amount: Number(get("line_items[0][price_data][unit_amount]")), interval: get("line_items[0][price_data][recurring][interval]"), methods: form.getAll("payment_method_types[0]").concat(form.getAll("payment_method_types[1]")),
        url: `http://localhost:${port}/pay/${id}`,
      };
      stripeState.sessions.set(id, s);
      return json(res, { id, url: s.url, object: "checkout.session" });
    }
    m = url.pathname.match(/^\/v1\/checkout\/sessions\/(cs_[a-z0-9]+)$/);
    if (req.method === "GET" && m) {
      const s = stripeState.sessions.get(m[1]);
      if (!s) return json(res, { error: { message: "introuvable" } }, 404);
      const sub = s.subscription ? stripeState.subscriptions.get(s.subscription) : null;
      return json(res, { id: s.id, metadata: s.metadata, status: s.status ?? "open", subscription: url.searchParams.get("expand[0]") === "subscription" ? sub : s.subscription ?? null });
    }
    m = url.pathname.match(/^\/v1\/subscriptions\/(sub_[a-z0-9]+)$/);
    if (req.method === "GET" && m) {
      const sub = stripeState.subscriptions.get(m[1]);
      return sub ? json(res, sub) : json(res, { error: { message: "introuvable" } }, 404);
    }
    // Mise en pause de la facturation (gratuité) : pause_collection[behavior] (+ resumes_at), ou "" pour reprendre.
    if (req.method === "POST" && m) {
      const sub = stripeState.subscriptions.get(m[1]);
      if (!sub) return json(res, { error: { message: "introuvable" } }, 404);
      // Option ajoutée (ligne de plus, sur un produit existant) ou retirée (ligne supprimée), avec la règle de prorata.
      if (form.has("items[0][price_data][product]")) {
        const product = form.get("items[0][price_data][product]");
        if (!stripeState.products.has(product)) return json(res, { error: { message: `No such product: '${product}'` } }, 400);
        if (form.get("items[0][price_data][recurring][interval]") !== sub.items.data[0].price.recurring.interval) return json(res, { error: { message: "périodicité différente de l'abonnement" } }, 400);
        sub.items.data.push({ id: `si_${randomUUID().slice(0, 8)}`, price: { product, unit_amount: Number(form.get("items[0][price_data][unit_amount]")), recurring: { interval: form.get("items[0][price_data][recurring][interval]") } } });
        sub.lastProration = form.get("proration_behavior");
      } else if (form.get("items[0][deleted]") === "true") {
        const at = sub.items.data.findIndex((i) => i.id === form.get("items[0][id]"));
        if (at < 0) return json(res, { error: { message: "ligne introuvable" } }, 400);
        sub.items.data.splice(at, 1);
        sub.lastProration = form.get("proration_behavior");
      }
      if (form.get("pause_collection") === "") sub.pause_collection = null;
      else if (form.has("pause_collection[behavior]")) {
        const behavior = form.get("pause_collection[behavior]");
        if (!["void", "keep_as_draft", "mark_uncollectible"].includes(behavior)) return json(res, { error: { message: "behavior invalide" } }, 400);
        sub.pause_collection = { behavior, resumes_at: form.has("pause_collection[resumes_at]") ? Number(form.get("pause_collection[resumes_at]")) : null };
      }
      return json(res, sub);
    }
    m = url.pathname.match(/^\/v1\/products\/([a-z0-9_]+)$/);
    if (req.method === "GET" && m) return stripeState.products.has(m[1]) ? json(res, stripeState.products.get(m[1])) : json(res, { error: { message: `No such product: '${m[1]}'` } }, 404);
    if (req.method === "POST" && url.pathname === "/v1/products") {
      if (stripeState.products.has(get("id"))) return json(res, { error: { message: "Product already exists." } }, 400);
      const product = { id: get("id"), object: "product", name: get("name") };
      stripeState.products.set(product.id, product);
      return json(res, product);
    }
    if (req.method === "POST" && url.pathname === "/v1/billing_portal/sessions") return json(res, { url: `http://localhost:${port}/portal?back=${encodeURIComponent(get("return_url"))}` });
    if (req.method === "POST" && url.pathname === "/v1/invoiceitems") {
      const it = { id: `ii_${randomUUID().slice(0, 8)}`, customer: get("customer"), amount: Number(get("amount")), currency: get("currency"), description: get("description"), metadata: Object.fromEntries([...form.entries()].filter(([k]) => k.startsWith("metadata[")).map(([k, v]) => [k.slice(9, -1), v])) };
      stripeState.invoiceItems.push(it);
      return json(res, it);
    }
    json(res, { error: { message: `non simulé : ${req.method} ${url.pathname}` } }, 404);
  });
  server.listen(port);
  return () => server.close();
}
