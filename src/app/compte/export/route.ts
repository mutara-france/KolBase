import { audit, requireUser } from "@/lib/auth";
import { exportAccount } from "@/lib/account";

/** Téléchargement des données personnelles du compte (JSON). */
export async function GET() {
  const user = await requireUser();
  const data = await exportAccount(user.id);
  await audit(user.id, "user.export", "User", user.id);
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="kolbase-mes-donnees-${new Date().toISOString().slice(0, 10)}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
