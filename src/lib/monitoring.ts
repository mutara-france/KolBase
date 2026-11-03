import "server-only";
import { sendMail, mailEnabled } from "@/lib/mail";
import { platformAdminEmails } from "@/lib/platform";
import { createThrottle } from "@/lib/alert-throttle";

const allow = createThrottle();

/**
 * Erreur serveur : journal structuré (lisible dans les logs Render) et alerte e-mail aux administrateurs de la
 * plateforme (PLATFORM_ADMIN_EMAILS), limitée pour ne pas les noyer. Ne lève jamais d'exception.
 */
export async function reportError(err: unknown, where: { path?: string; method?: string; routePath?: string; routeType?: string }) {
  try {
    const e = err instanceof Error ? err : new Error(String(err));
    const digest = (err as { digest?: string })?.digest;
    console.error(JSON.stringify({ level: "error", at: new Date().toISOString(), message: e.message, digest, ...where, stack: e.stack?.split("\n").slice(0, 6).join(" | ") }));
    const to = platformAdminEmails();
    if (!mailEnabled() || to.length === 0) return;
    const key = `${where.routePath ?? where.path}:${e.message}`.slice(0, 300);
    if (!allow(key)) return;
    for (const email of to)
      await sendMail({
        to: email,
        subject: `[KolBase] Erreur sur ${where.routePath ?? where.path ?? "une page"}`,
        text: `Une erreur serveur s'est produite.\n\nPage : ${where.method ?? ""} ${where.path ?? "?"}\nRoute : ${where.routePath ?? "?"} (${where.routeType ?? "?"})\nMessage : ${e.message}${digest ? `\nRéférence : ${digest}` : ""}\n\nDétail dans les journaux du service (Render › kolbase-web › Logs). Alerte limitée à une par erreur toutes les 30 minutes.`,
      });
  } catch (inner) {
    console.error("[surveillance en échec]", inner);
  }
}
