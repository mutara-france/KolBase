"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/auth";
import { requirePlatformAdmin } from "@/lib/platform";
import { str } from "@/lib/form";
import { sourceDownload } from "@/lib/market";
import { IMPORT_STALE_MS, runMarketImport } from "@/lib/market-import";

export type ActionState = { error?: string; ok?: string } | undefined;

/**
 * Mise à jour de la base publique Transparence Santé, lancée par un administrateur KolBase : le fichier partagé par
 * lien est lu après la réponse (plusieurs dizaines de Mo : une à deux minutes) ; la page en montre l'avancement.
 */
export async function startMarketImport(_: ActionState, form: FormData): Promise<ActionState> {
  const admin = await requirePlatformAdmin();
  const link = str(form, "link", 600);
  if (!sourceDownload(link)) return { error: "Lien refusé : collez le lien de partage d'un fichier CSV sur Google Drive (drive.google.com/file/d/…) ou d'une feuille Google Sheets (docs.google.com/spreadsheets/d/…)." };
  // Un import resté « en cours » trop longtemps a été interrompu (redémarrage du service) : il est clos.
  await db.marketImport.updateMany({ where: { status: "en_cours", createdAt: { lt: new Date(Date.now() - IMPORT_STALE_MS) } }, data: { status: "echec", error: "lecture interrompue", finishedAt: new Date() } });
  if (await db.marketImport.findFirst({ where: { status: "en_cours" }, select: { id: true } })) return { error: "Une mise à jour est déjà en cours : attendez qu'elle se termine." };
  const imp = await db.marketImport.create({ data: { sourceUrl: link, startedById: admin.id } });
  await audit(admin.id, "market.import", "MarketImport", imp.id, { link });
  after(async () => {
    await runMarketImport(imp.id);
    revalidatePath("/admin/base-publique");
  });
  revalidatePath("/admin/base-publique");
  return { ok: "Mise à jour lancée : la lecture du fichier prend une à deux minutes. Les organisations gardent les données actuelles jusqu'à la fin." };
}
