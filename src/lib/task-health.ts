/**
 * État des tâches planifiées (module pur, testé) : le service cron kolbase-taches appelle /api/taches toutes les heures ;
 * sans réussite depuis deux heures, quelque chose s'est arrêté (service cron, APP_URL, CRON_SECRET, erreur).
 */
export const TASK_NAME = "taches-horaires";
export const STALE_AFTER_MS = 2 * 3600 * 1000;

export type TaskRunState = { startedAt: Date; okAt: Date | null; error: string | null } | null;

const ago = (ms: number) => {
  const min = Math.round(ms / 60000);
  return min < 90 ? `${min} min` : `${Math.round(min / 60)} h`;
};

export function taskHealth(run: TaskRunState, now = new Date()): { ok: boolean; detail: string } {
  if (!run) return { ok: false, detail: "Jamais exécutées : vérifier le service cron kolbase-taches sur Render (APP_URL, CRON_SECRET) et ses journaux." };
  const failedLast = !!run.error && (!run.okAt || run.okAt < run.startedAt);
  if (failedLast) return { ok: false, detail: `Dernière exécution en échec, il y a ${ago(now.getTime() - run.startedAt.getTime())} : ${run.error}` };
  if (!run.okAt) return { ok: false, detail: `En cours depuis ${ago(now.getTime() - run.startedAt.getTime())}, sans réussite enregistrée.` };
  const since = now.getTime() - run.okAt.getTime();
  if (since > STALE_AFTER_MS) return { ok: false, detail: `Aucune réussite depuis ${ago(since)} : le service cron kolbase-taches ne tourne plus ? (Render › kolbase-taches › journaux)` };
  return { ok: true, detail: `Dernière réussite il y a ${ago(since)} (toutes les heures : rappels, attestations, bilans, purge des données expirées).` };
}
