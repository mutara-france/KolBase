import "server-only";
import { sendMail, mailEnabled } from "@/lib/mail";
import { platformAdminEmails } from "@/lib/platform";
import { createThrottle } from "@/lib/alert-throttle";
import { maskEmails, redactPath } from "@/lib/redact";

const allow = createThrottle();

/**
 * Erreur serveur : journal structuré (lisible dans les logs Render) et alerte e-mail aux administrateurs de la
 * plateforme (PLATFORM_ADMIN_EMAILS), limitée pour ne pas les noyer. Ne lève jamais d'exception.
 */
export async function reportError(err: unknown, where: { path?: string; method?: string; routePath?: string; routeType?: string }) {
  try {
    const e = err instanceof Error ? err : new Error(String(err));
    const digest = (err as { digest?: string })?.digest;
    // Ni jeton (chemin d'un lien de réinitialisation, d'invitation…) ni adresse e-mail dans le journal et l'alerte.
    where = { ...where, path: where.path && redactPath(where.path) };
    const message = maskEmails(e.message);
    const stack = e.stack && maskEmails(e.stack.split("\n").slice(0, 6).join(" | "));
    console.error(JSON.stringify({ level: "error", at: new Date().toISOString(), message, digest, ...where, stack }));
    const to = platformAdminEmails();
    if (!mailEnabled() || to.length === 0) return;
    const key = `${where.routePath ?? where.path}:${message}`.slice(0, 300);
    if (!allow(key)) return;
    for (const email of to)
      await sendMail({
        to: email,
        subject: `[KolBase] Erreur sur ${where.routePath ?? where.path ?? "une page"}`,
        text: `Une erreur serveur s'est produite.\n\nPage : ${where.method ?? ""} ${where.path ?? "?"}\nRoute : ${where.routePath ?? "?"} (${where.routeType ?? "?"})\nMessage : ${message}${digest ? `\nRéférence : ${digest}` : ""}\n\nDétail dans les journaux du service (Render › kolbase-web › Logs). Alerte limitée à une par erreur toutes les 30 minutes.`,
      });
  } catch (inner) {
    console.error("[surveillance en échec]", inner);
  }
}
