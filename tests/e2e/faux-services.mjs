// Faux services externes pour les parcours : répertoire des entreprises et ORCID (OAuth + API publique).
// L'application doit être lancée avec SIREN_API_URL=http://localhost:3998, ORCID_BASE_URL=http://localhost:3997,
// ORCID_PUB_API_URL=http://localhost:3997/v3.0, ORCID_CLIENT_ID et ORCID_CLIENT_SECRET définis,
// SMTP_URL=smtp://localhost:2525 et MAIL_DELIVER_RESERVED=1 (les comptes de démo sont en .local),
// S3_ENDPOINT=http://localhost:3996, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY et S3_FORCE_PATH_STYLE=1,
// YOUSIGN_API_KEY=test, YOUSIGN_API_URL=http://localhost:3995 et YOUSIGN_WEBHOOK_SECRET=test.
import http from "node:http";
import { randomUUID } from "node:crypto";
import { SMTPServer } from "smtp-server";
import { simpleParser } from "mailparser";

/** E-mails reçus par le faux serveur SMTP (port 2525) : { to, subject, text }. */
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

export function startFakes() {
  const siren = http.createServer((req, res) => {
    const q = new URL(req.url, "http://x").searchParams.get("q") ?? "";
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
        for (const to of session.envelope.rcptTo) mails.push({ to: to.address, subject: m.subject ?? "", text: m.text ?? "" });
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
  return () => { siren.close(); orcid.close(); smtp.close(); s3.close(); stopYousign(); };
}

/**
 * Demandes reçues par le faux Yousign (API v3) : id → { body, status, documents, signers, pdf, completed_at, decline_information }.
 * Le test modifie `status` pour simuler la signature, un refus ou une expiration.
 */
export const signatureRequests = new Map();
export const YOUSIGN_KEY = "test";

/** Faux Yousign (port 3995 par défaut) : création, dépôt du PDF, signataires, activation, statut, téléchargement. */
export function startFakeYousign(port = 3995) {
  const read = (req) => new Promise((resolve) => { const c = []; req.on("data", (x) => c.push(x)); req.on("end", () => resolve(Buffer.concat(c))); });
  const server = http.createServer(async (req, res) => {
    const body = await read(req);
    if (req.headers.authorization !== `Bearer ${YOUSIGN_KEY}`) return json(res, { detail: "Unauthorized" }, 401);
    const path = new URL(req.url, "http://x").pathname;
    const m = path.match(/^\/signature_requests(?:\/([^/]+))?(?:\/(documents|signers|activate))?(?:\/([^/]+))?(?:\/(download))?$/);
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
