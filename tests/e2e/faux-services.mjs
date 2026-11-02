// Faux services externes pour les parcours : répertoire des entreprises et ORCID (OAuth + API publique).
// L'application doit être lancée avec SIREN_API_URL=http://localhost:3998, ORCID_BASE_URL=http://localhost:3997,
// ORCID_PUB_API_URL=http://localhost:3997/v3.0, ORCID_CLIENT_ID et ORCID_CLIENT_SECRET définis,
// SMTP_URL=smtp://localhost:2525 et MAIL_DELIVER_RESERVED=1 (les comptes de démo sont en .local).
import http from "node:http";
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
  siren.listen(3998);
  orcid.listen(3997);
  smtp.listen(2525);
  return () => { siren.close(); orcid.close(); smtp.close(); };
}
