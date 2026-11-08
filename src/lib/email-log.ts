import "server-only";
import { db } from "@/lib/db";

/** Statuts d'un envoi (administration). */
export const EMAIL_STATUS: Record<string, { label: string; tone: string }> = {
  sent: { label: "Envoyé", tone: "ok" },
  failed: { label: "En échec", tone: "bad" },
  not_configured: { label: "Non envoyé (SMTP absent)", tone: "wait" },
  reserved: { label: "Adresse de démonstration", tone: "done" },
};

/** Durée de conservation du journal des e-mails (politique de confidentialité). */
export const EMAIL_LOG_DAYS = 90;

/**
 * Trace d'un envoi (sans le contenu, qui peut porter un lien de connexion) : destinataire, objet, statut. Une erreur
 * d'écriture est journalisée, jamais propagée : l'envoi d'un e-mail n'en dépend pas.
 */
export async function logEmail(to: string, subject: string, status: "sent" | "failed" | "not_configured" | "reserved", error?: string) {
  try {
    await db.emailLog.create({ data: { to: to.trim().toLowerCase().slice(0, 320), subject: subject.slice(0, 300), status, error: error?.slice(0, 500) ?? null } });
  } catch (e) {
    console.error("[journal des e-mails] écriture impossible", e instanceof Error ? e.message : e);
  }
}

export async function purgeEmailLog(now = new Date()) {
  return (await db.emailLog.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - EMAIL_LOG_DAYS * 86400e3) } } })).count;
}
