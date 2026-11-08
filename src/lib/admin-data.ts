import "server-only";
import { db } from "@/lib/db";
import { platformAdminEmails } from "@/lib/platform";
import { DEMO_EMAIL_DOMAIN, realOrganization, realPractitioner } from "@/lib/demo";
import { missingLegal } from "@/lib/legal";
import { mailEnabled } from "@/lib/mail";
import { storageEnabled } from "@/lib/storage";
import { orcidOAuth } from "@/lib/orcid";
import { signatureApiUrl, signatureEnabled, signatureSandbox, webhookSecret } from "@/lib/yousign";
import { aiEnabled } from "@/lib/ai";
import { asInterval, exempt, monthlyCents, planFor } from "@/lib/billing-plans";
import { stripeEnabled } from "@/lib/billing";
import { adminTwoFactorRequired } from "@/lib/two-factor";
import { TASK_NAME, taskHealth } from "@/lib/task-health";

/** Comptes réels : ni fictifs (démonstration), ni anonymisés après suppression. */
export const realUser = { AND: [{ email: { not: { endsWith: DEMO_EMAIL_DOMAIN } } }, { email: { not: { endsWith: "@kolbase.invalid" } } }] };

/** Identités à vérifier : numéro saisi, ni validé ni refusé. */
export const identityQueueWhere = { OR: [{ rpps: { not: null } }, { licenseNumber: { not: null } }], rppsVerified: false, rppsCheckedAt: null };

/** Tâches planifiées : état de la dernière exécution (null si le service cron n'est pas configuré). */
export async function tasksState() {
  return process.env.CRON_SECRET ? taskHealth(await db.taskRun.findUnique({ where: { name: TASK_NAME } })) : null;
}

/** Pastilles de la navigation de l'administration : ce qui attend une décision de KolBase. */
export async function adminCounts() {
  const [orgs, identities, services, reports] = await Promise.all([
    db.organization.count({ where: { verification: "PENDING" } }),
    db.practitionerProfile.count({ where: identityQueueWhere }),
    db.serviceOrder.count({ where: { status: "demandee" } }),
    db.report.count({ where: { status: "open" } }),
  ]);
  return { orgs, identities, services, reports };
}

export type LaunchItem = { ok: boolean; optional?: boolean; label: string; detail: string };

/** Configuration de la production (lecture seule) : ce qui reste à faire avant l'ouverture au public. */
export async function launchItems(tasks: { ok: boolean; detail: string } | null): Promise<LaunchItem[]> {
  const [demoOrgs, admins] = await Promise.all([
    db.organization.count({ where: { id: { startsWith: "demo-" } } }),
    db.user.findMany({ where: { email: { in: platformAdminEmails() } }, select: { email: true, emailVerifiedAt: true } }),
  ]);
  const unconfirmed = admins.filter((a) => !a.emailVerifiedAt).map((a) => a.email);
  const missing = platformAdminEmails().filter((e) => !admins.some((a) => a.email.toLowerCase() === e));
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
  return [
    {
      ok: missing.length === 0 && unconfirmed.length === 0,
      label: "Administrateurs KolBase (PLATFORM_ADMIN_EMAILS)",
      detail: [
        missing.length ? `Sans compte : ${missing.join(", ")} (à créer sans tarder : une adresse listée et libre pourrait être prise).` : "",
        unconfirmed.length ? `Adresse à confirmer : ${unconfirmed.join(", ")} (exigé dès que les e-mails sont configurés).` : "",
      ].filter(Boolean).join(" ") || "Comptes créés et adresses confirmées.",
    },
    { ok: !!process.env.APP_URL, label: "Adresse du site (APP_URL)", detail: process.env.APP_URL || "Non définie : les liens des e-mails et du plan du site sont incomplets." },
    { ok: mailEnabled(), label: "Envoi d'e-mails (SMTP_URL, MAIL_FROM)", detail: mailEnabled() ? `Expéditeur : ${process.env.MAIL_FROM ?? "par défaut"}` : "Non configuré : aucun e-mail n'est envoyé (mot de passe oublié, notifications)." },
    { ok: storageEnabled(), label: "Stockage des documents (S3_*)", detail: storageEnabled() ? `Compartiment : ${process.env.S3_BUCKET}` : "Non configuré : le dépôt de documents est désactivé." },
    { ok: esign && !!webhookSecret() && !signatureSandbox(), optional: !esign, label: "Signature électronique (YOUSIGN_*, facultatif)", detail: esignDetail },
    {
      ok: !!tasks?.ok,
      label: "Tâches planifiées (CRON_SECRET, service cron kolbase-taches)",
      detail: tasks
        ? `${tasks.detail}${process.env.HEARTBEAT_URL ? " Surveillance externe active (HEARTBEAT_URL)." : " HEARTBEAT_URL non définie : aucune alerte si le cron s'arrête (voir docs/exploitation.md)."}`
        : "Non configurées : synchroniser le Blueprint Render (service cron) ; ni rappels ni envois après les événements.",
    },
    // Facturation : en alerte tant que la TVA (STRIPE_TAX_RATE) n'est pas appliquée aux abonnements.
    { ok: stripeEnabled() && !!process.env.STRIPE_WEBHOOK_SECRET && !!process.env.STRIPE_TAX_RATE, label: "Facturation (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_TAX_RATE)", detail: stripeEnabled() ? (process.env.STRIPE_WEBHOOK_SECRET ? `Active${process.env.STRIPE_TAX_RATE ? ", TVA appliquée" : " (STRIPE_TAX_RATE à définir pour la TVA)"}. Notifications : <APP_URL>/api/stripe/webhook.` : "Clé définie mais secret des notifications manquant : déclarer <APP_URL>/api/stripe/webhook chez Stripe.") : "Inactive : abonnements non facturés, toutes les fonctions accessibles." },
    {
      ok: adminTwoFactorRequired(),
      label: "Double authentification des administrateurs KolBase (PLATFORM_ADMIN_2FA)",
      detail: adminTwoFactorRequired() ? "Exigée." : "PLATFORM_ADMIN_2FA=optional : la double authentification n'est pas exigée des administrateurs KolBase (réservé aux environnements de test). Retirer la variable avant l'ouverture.",
    },
    { ok: aiEnabled(), optional: true, label: "Assistant d'IA (ANTHROPIC_API_KEY, facultatif)", detail: aiEnabled() ? `Actif (modèle ${process.env.ANTHROPIC_MODEL ?? "par défaut"}).` : "Non configuré : brouillons, suggestion d'experts (sans résumé) et relecture assistée indisponibles." },
    { ok: !!orcidOAuth(), optional: true, label: "Connexion ORCID (facultatif)", detail: orcidOAuth() ? "Active." : "Non configurée : l'iD ORCID se saisit à la main." },
    { ok: legalGaps.length === 0, label: "Textes légaux (src/lib/legal.ts)", detail: legalGaps.length ? `À compléter : ${legalGaps.join(", ")}.` : "Complets." },
    { ok: process.env.SEED_DEMO !== "1", label: "Rechargement de la démo (SEED_DEMO)", detail: process.env.SEED_DEMO === "1" ? "Actif : la démo est rechargée à chaque déploiement. Passer à 0 avant l'ouverture." : "Désactivé." },
    { ok: demoOrgs === 0, label: "Données de démonstration", detail: demoOrgs ? `${demoOrgs} organisations fictives présentes : npm run db:purge-demo -- --confirmer (shell Render).` : "Aucune." },
  ];
}

const DAY = 864e5;

/** Indicateurs du tableau de bord : 30 derniers jours, hors données de démonstration. */
export async function dashboardFigures(now = new Date()) {
  const since = new Date(now.getTime() - 30 * DAY);
  const realEventOrg = { organization: realOrganization };
  const [users, newUsers, experts, newExperts, orgs, suppliers, upcoming, registrations, projects, rfqs, services, demo, subs] = await Promise.all([
    db.user.count({ where: realUser }),
    db.user.count({ where: { ...realUser, createdAt: { gte: since } } }),
    db.practitionerProfile.count({ where: { listed: true, ...realPractitioner } }),
    db.practitionerProfile.count({ where: { listed: true, listedAt: { gte: since }, ...realPractitioner } }),
    db.organization.count({ where: { verification: "VERIFIED", ...realOrganization } }),
    db.organization.count({ where: { verification: "VERIFIED", kind: "PRESTATAIRE", ...realOrganization } }),
    db.event.count({ where: { publishedAt: { not: null }, cancelledAt: null, internal: false, startsAt: { gte: now }, ...realEventOrg } }),
    db.registration.count({ where: { createdAt: { gte: since }, cancelledAt: null, event: realEventOrg } }),
    db.project.count({ where: { createdAt: { gte: since }, ...realEventOrg } }),
    db.rfq.count({ where: { sentAt: { gte: since }, ...realEventOrg } }),
    db.serviceOrder.count({ where: { createdAt: { gte: since }, ...realEventOrg } }),
    Promise.all([db.organization.count({ where: { id: { startsWith: "demo-" } } }), db.user.count({ where: { email: { endsWith: DEMO_EMAIL_DOMAIN } } })]),
    db.organization.findMany({ where: { verification: { in: ["VERIFIED", "SUSPENDED"] }, subscription: { isNot: null } }, select: { kind: true, subscription: true } }),
  ]);
  const paying = subs.filter((o) => ["essai", "active", "impayee"].includes(o.subscription?.status ?? "") && !exempt(o.subscription, now));
  // Revenu mensuel récurrent : une formule annuelle compte pour un douzième ; les essais ne comptent pas.
  const mrr = paying.filter((o) => o.subscription!.status !== "essai").reduce((s, o) => s + monthlyCents(planFor(o.kind), asInterval(o.subscription!.interval)), 0);
  const unpaid = paying.filter((o) => o.subscription!.status === "impayee").length;
  return { users, newUsers, experts, newExperts, orgs, suppliers, upcoming, registrations, projects, rfqs, services, demoOrgs: demo[0], demoUsers: demo[1], paying: paying.length, mrr, unpaid };
}
