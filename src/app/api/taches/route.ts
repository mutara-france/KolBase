import { timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { runDueTasks } from "@/lib/scheduled-tasks";
import { TASK_NAME } from "@/lib/task-health";
import { errorText } from "@/lib/redact";
import { reportError } from "@/lib/monitoring";

/**
 * Tâches planifiées (appelées toutes les heures par le service cron de Render) :
 * POST avec l'en-tête « Authorization: Bearer <CRON_SECRET> ».
 * Chaque exécution est enregistrée (TaskRun, affiché dans /admin). Un échec répond 500 : le service cron échoue
 * aussi (curl -f), ce que Render peut signaler. Après une réussite, HEARTBEAT_URL (facultatif) est appelée : un
 * service de surveillance externe alerte quand ces appels cessent (cron arrêté, application injoignable).
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ error: "CRON_SECRET non configuré." }, { status: 503 });
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return Response.json({ error: "Non autorisé." }, { status: 401 });

  const startedAt = new Date();
  await db.taskRun.upsert({ where: { name: TASK_NAME }, create: { name: TASK_NAME, startedAt }, update: { startedAt } });
  try {
    const result = await runDueTasks(startedAt);
    await db.taskRun.update({ where: { name: TASK_NAME }, data: { okAt: new Date(), error: null, result } });
    console.log("[tâches planifiées]", JSON.stringify(result));
    await heartbeat();
    return Response.json(result);
  } catch (e) {
    await db.taskRun.update({ where: { name: TASK_NAME }, data: { error: errorText(e).slice(0, 500) } }).catch(() => {});
    await reportError(e, { path: "/api/taches", method: "POST", routePath: "/api/taches", routeType: "route" });
    return Response.json({ error: "Tâches planifiées en échec (détail dans les journaux)." }, { status: 500 });
  }
}

async function heartbeat() {
  const url = process.env.HEARTBEAT_URL;
  if (!url) return;
  await fetch(url, { signal: AbortSignal.timeout(5000) }).catch((e) => console.warn("[tâches planifiées] battement non transmis", errorText(e)));
}
