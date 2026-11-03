import { timingSafeEqual } from "node:crypto";
import { runDueTasks } from "@/lib/scheduled-tasks";

/**
 * Tâches planifiées (appelées toutes les heures par le service cron de Render) :
 * POST avec l'en-tête « Authorization: Bearer <CRON_SECRET> ».
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ error: "CRON_SECRET non configuré." }, { status: 503 });
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return Response.json({ error: "Non autorisé." }, { status: 401 });
  const result = await runDueTasks();
  console.log("[tâches planifiées]", JSON.stringify(result));
  return Response.json(result);
}
