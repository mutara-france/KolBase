import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { db } from "@/lib/db";
import { requirePlatformAdmin } from "@/lib/platform";
import { ORG_KIND_LABEL, VERIFICATION_LABEL } from "@/lib/org-roles";
import { formatDate } from "@/lib/events";
import { normalize } from "@/lib/search";
import { recheckSiren, reviewOrganization, reviewRpps } from "@/lib/admin-actions";
import { missingLegal } from "@/lib/legal";
import { mailEnabled } from "@/lib/mail";
import { storageEnabled } from "@/lib/storage";
import { orcidOAuth } from "@/lib/orcid";
import { signatureApiUrl, signatureEnabled, signatureSandbox, webhookSecret } from "@/lib/yousign";
import { Avatar } from "@/components/Avatar";
import { logoSrc } from "@/lib/logos";

export const metadata = { title: "Administration — KolBase" };
export const dynamic = "force-dynamic";

const TONE = { PENDING: "wait", VERIFIED: "ok", REJECTED: "bad" } as const;
/** Messageries grand public : un administrateur d'entreprise s'inscrit d'ordinaire avec l'adresse de la société. */
const PERSONAL_MAIL = /@(gmail|googlemail|hotmail|outlook|live|msn|yahoo|ymail|icloud|me|aol|gmx|laposte|orange|wanadoo|free|sfr|neuf|bbox|protonmail|proton)\./i;

/** Administration de la plateforme : validation des organisations (SIREN) et des praticiens (RPPS). */
export default async function Page({ searchParams }: { searchParams: Promise<{ onglet?: string }> }) {
  await requirePlatformAdmin();
  const o = (await searchParams).onglet;
  const onglet = o === "praticiens" || o === "lancement" ? o : "organisations";

  const [orgs, rppsQueue, rppsDone] = await Promise.all([
    db.organization.findMany({
      include: { members: { where: { role: "ADMIN" }, include: { user: { select: { email: true, firstName: true, lastName: true } } }, take: 3, orderBy: { createdAt: "asc" } } },
      orderBy: { createdAt: "desc" },
    }),
    db.practitionerProfile.findMany({
      where: { rpps: { not: null }, rppsVerified: false, rppsCheckedAt: null },
      include: { user: { select: { email: true, firstName: true, lastName: true } } },
      orderBy: { updatedAt: "asc" },
    }),
    db.practitionerProfile.findMany({
      where: { rppsCheckedAt: { not: null } },
      include: { user: { select: { firstName: true, lastName: true } } },
      orderBy: { rppsCheckedAt: "desc" },
      take: 20,
    }),
  ]);
  const pending = orgs.filter((o) => o.verification === "PENDING");
  // Plusieurs organisations sur un même SIREN : doublon ou tentative d'usurpation, à examiner.
  const bySiren = new Map<string, typeof orgs>();
  for (const o of orgs) if (o.siren) bySiren.set(o.siren, [...(bySiren.get(o.siren) ?? []), o]);
  const groups = [
    ["À valider", pending],
    ["Refusées", orgs.filter((o) => o.verification === "REJECTED")],
    ["Validées", orgs.filter((o) => o.verification === "VERIFIED")],
  ] as const;

  return (
    <>
      <SiteHeader />
      <main className="stack">
        <h1>Administration KolBase</h1>
        <nav className="tabs">
          <Link href="?onglet=organisations" className={onglet === "organisations" ? "active" : ""}>Organisations ({pending.length} à valider)</Link>
          <Link href="?onglet=praticiens" className={onglet === "praticiens" ? "active" : ""}>RPPS ({rppsQueue.length} à vérifier)</Link>
          <Link href="?onglet=lancement" className={onglet === "lancement" ? "active" : ""}>Lancement</Link>
        </nav>

        {onglet === "organisations" &&
          groups.map(([title, list]) => (
            <section key={title} className="stack">
              <h2>{title} ({list.length})</h2>
              {list.length === 0 && <p className="muted">Aucune.</p>}
              {list.map((o) => {
                const mismatch = o.legalName && !normalize(o.legalName).includes(normalize(o.name)) && !normalize(o.name).includes(normalize(o.legalName));
                const twins = o.siren ? (bySiren.get(o.siren) ?? []).filter((x) => x.id !== o.id) : [];
                return (
                  <section key={o.id} className="card stack-sm">
                    <div className="actions spread">
                      <span className="actions" style={{ alignItems: "center" }}>
                        <Avatar name={o.name} size={44} square src={logoSrc(o)} />
                        <span>
                        <strong>{o.name}</strong> <span className={`pill ${TONE[o.verification]}`}>{VERIFICATION_LABEL[o.verification]}</span>
                        <br />
                        <span className="muted">{ORG_KIND_LABEL[o.kind]} · créée le {formatDate(o.createdAt)}{o.headquarters ? ` · ${o.headquarters}` : ""}</span>
                        </span>
                      </span>
                    </div>
                    <dl className="facts">
                      <dt>SIREN</dt>
                      <dd>
                        {o.siren ? (
                          <>
                            {o.siren}{" "}
                            <a href={`https://annuaire-entreprises.data.gouv.fr/entreprise/${o.siren}`} target="_blank" rel="noreferrer">
                              Annuaire des entreprises <ExternalLink size={12} />
                            </a>
                          </>
                        ) : (
                          <span className="muted">non renseigné</span>
                        )}
                      </dd>
                      <dt>Répertoire</dt>
                      <dd>
                        {!o.siren ? "—" : !o.sirenCheckedAt ? "non contrôlé (répertoire indisponible)" : o.legalName ? `${o.legalName}${o.sirenActive === false ? " — FERMÉE" : o.sirenActive ? " — active" : ""}` : "SIREN introuvable"}
                        {mismatch && <span className="pill wait" style={{ marginLeft: 8 }}>Nom différent de la raison sociale</span>}
                      </dd>
                      {twins.length > 0 && (
                        <>
                          <dt>Même SIREN</dt>
                          <dd><span className="pill bad">Doublon possible</span> {twins.map((t) => `${t.name} (${VERIFICATION_LABEL[t.verification].toLowerCase()})`).join(", ")}</dd>
                        </>
                      )}
                      <dt>Administrateurs</dt>
                      <dd>
                        {o.members.map((m) => `${m.user.firstName} ${m.user.lastName} <${m.user.email}>`).join(", ") || "—"}
                        {o.members.some((m) => PERSONAL_MAIL.test(m.user.email)) && <span className="pill wait" style={{ marginLeft: 8 }}>Adresse personnelle</span>}
                      </dd>
                      {o.contactEmail && (<><dt>Contact</dt><dd>{o.contactEmail}</dd></>)}
                      {o.verificationNote && (<><dt>Note</dt><dd>{o.verificationNote}</dd></>)}
                    </dl>
                    <div className="actions wrap">
                      {o.verification !== "VERIFIED" && (
                        <form action={reviewOrganization} className="inline wrap">
                          <input type="hidden" name="orgId" value={o.id} />
                          <input name="note" placeholder="Note (facultatif pour valider, obligatoire pour refuser)" style={{ minWidth: 320 }} />
                          <button className="btn small" name="decision" value="verify">Valider</button>
                          {o.verification !== "REJECTED" && <button className="btn ghost small" name="decision" value="reject">Refuser</button>}
                        </form>
                      )}
                      {o.verification === "VERIFIED" && (
                        <form action={reviewOrganization} className="inline wrap">
                          <input type="hidden" name="orgId" value={o.id} />
                          <input name="note" placeholder="Motif de la suspension" />
                          <button className="btn ghost small" name="decision" value="suspend">Suspendre</button>
                        </form>
                      )}
                      {o.siren && (
                        <form action={recheckSiren}>
                          <input type="hidden" name="orgId" value={o.id} />
                          <button className="link">Relancer le contrôle du SIREN</button>
                        </form>
                      )}
                    </div>
                  </section>
                );
              })}
            </section>
          ))}

        {onglet === "lancement" && <LaunchChecklist demoOrgs={orgs.filter((x) => x.id.startsWith("demo-")).length} />}

        {onglet === "praticiens" && (
          <>
            <p className="muted">
              Contrôlez chaque numéro sur l&apos;<a href="https://annuaire.sante.fr/" target="_blank" rel="noreferrer">Annuaire Santé <ExternalLink size={12} /></a> :
              le nom, la profession et la situation d&apos;exercice doivent correspondre. Le badge « Identité vérifiée » s&apos;affiche dès la validation.
            </p>
            {rppsQueue.length === 0 && <p className="muted">Aucun RPPS en attente.</p>}
            {rppsQueue.map((p) => (
              <section key={p.id} className="card actions spread">
                <span>
                  <strong>{p.user.firstName} {p.user.lastName}</strong> · {p.profession}{p.city ? ` · ${p.city}` : ""}{p.listed ? " · expert référencé" : ""}
                  <br />
                  <span className="muted">RPPS <span className="mono">{p.rpps}</span> · {p.user.email}</span>
                </span>
                <form action={reviewRpps} className="inline wrap">
                  <input type="hidden" name="practitionerId" value={p.id} />
                  <input type="hidden" name="rpps" value={p.rpps ?? ""} />
                  <input name="note" placeholder="Motif (obligatoire pour refuser)" />
                  <button className="btn small" name="decision" value="verify">Valider</button>
                  <button className="btn ghost small" name="decision" value="reject">Refuser</button>
                </form>
              </section>
            ))}
            {rppsDone.length > 0 && (
              <section className="card">
                <h2>Derniers contrôles</h2>
                <ul className="pub-list">
                  {rppsDone.map((p) => (
                    <li key={p.id}>
                      <strong>{p.user.firstName} {p.user.lastName}</strong>
                      <span className="text-xs">
                        RPPS {p.rpps} · {p.rppsVerified ? "validé" : `refusé${p.rppsCheckNote ? ` : ${p.rppsCheckNote}` : ""}`} le {formatDate(p.rppsCheckedAt!)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </main>
    </>
  );
}

/** État de la configuration en production (lecture seule) : ce qui reste à faire avant l'ouverture. */
function LaunchChecklist({ demoOrgs }: { demoOrgs: number }) {
  const legalGaps = missingLegal();
  const esign = signatureEnabled();
  const esignDetail = !esign
    ? "Non configurée : les conventions se signent sur papier puis se déposent dans le dossier."
    : [
        signatureSandbox() ? `Environnement de test (${signatureApiUrl()}) : les signatures n'ont pas de valeur juridique.` : "Yousign, environnement de production.",
        webhookSecret()
          ? `Webhook signé configuré (${process.env.APP_URL ?? "<APP_URL>"}/api/signature/webhook).`
          : `YOUSIGN_WEBHOOK_SECRET absent : déclarer le webhook ${process.env.APP_URL ?? "<APP_URL>"}/api/signature/webhook chez Yousign, sinon le statut se met à jour à la main depuis chaque dossier.`,
      ].join(" ");
  const items: { ok: boolean; optional?: boolean; label: string; detail: string }[] = [
    { ok: !!process.env.APP_URL, label: "Adresse du site (APP_URL)", detail: process.env.APP_URL || "Non définie : les liens des e-mails et du plan du site sont incomplets." },
    { ok: mailEnabled(), label: "Envoi d'e-mails (SMTP_URL, MAIL_FROM)", detail: mailEnabled() ? `Expéditeur : ${process.env.MAIL_FROM ?? "par défaut"}` : "Non configuré : aucun e-mail n'est envoyé (mot de passe oublié, notifications)." },
    { ok: storageEnabled(), label: "Stockage des documents (S3_*)", detail: storageEnabled() ? `Compartiment : ${process.env.S3_BUCKET}` : "Non configuré : le dépôt de documents est désactivé." },
    { ok: esign && !!webhookSecret() && !signatureSandbox(), optional: !esign, label: "Signature électronique (YOUSIGN_*, facultatif)", detail: esignDetail },
    { ok: !!orcidOAuth(), optional: true, label: "Connexion ORCID (facultatif)", detail: orcidOAuth() ? "Active." : "Non configurée : l'iD ORCID se saisit à la main." },
    { ok: legalGaps.length === 0, label: "Textes légaux (src/lib/legal.ts)", detail: legalGaps.length ? `À compléter : ${legalGaps.join(", ")}.` : "Complets." },
    { ok: process.env.SEED_DEMO !== "1", label: "Rechargement de la démo (SEED_DEMO)", detail: process.env.SEED_DEMO === "1" ? "Actif : la démo est rechargée à chaque déploiement. Passer à 0 avant l'ouverture." : "Désactivé." },
    { ok: demoOrgs === 0, label: "Données de démonstration", detail: demoOrgs ? `${demoOrgs} organisations fictives présentes : npm run db:purge-demo -- --confirmer (shell Render).` : "Aucune." },
  ];
  return (
    <section className="card stack-sm">
      <h2>Avant l&apos;ouverture au public</h2>
      <ul className="pub-list">
        {items.map((i) => (
          <li key={i.label}>
            <strong>
              <span className={`pill ${i.ok ? "ok" : i.optional ? "done" : "wait"}`}>{i.ok ? "OK" : i.optional ? "Facultatif" : "À faire"}</span> {i.label}
            </strong>
            <span className="text-xs">{i.detail}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
