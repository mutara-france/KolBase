"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/auth";
import { requireMembership } from "@/lib/orgs";
import { requirePlatformAdmin } from "@/lib/platform";
import { STATS_ROLES } from "@/lib/org-roles";
import { orgHasAddon } from "@/lib/billing";
import { dayOrNull, MAX_NAME, str } from "@/lib/form";
import { errorText } from "@/lib/redact";
import { feedUrl } from "@/lib/feed";
import { refreshSource } from "@/lib/watch";
import { getT } from "@/lib/i18n/server";

export type ActionState = { error?: string; ok?: string } | undefined;

/** Source de veille ajoutée par un administrateur KolBase : le flux est lu une première fois avant d'être retenu. */
export async function addWatchSource(_: ActionState, form: FormData): Promise<ActionState> {
  const admin = await requirePlatformAdmin();
  const name = str(form, "name", MAX_NAME);
  const url = feedUrl(str(form, "url", 600));
  if (!name) return { error: "Indiquez le nom de la source." };
  if (!url) return { error: "Adresse refusée : indiquez l'adresse https du flux RSS ou Atom d'un site public." };
  if (await db.watchSource.findUnique({ where: { url: url.toString() } })) return { error: "Cette source est déjà relevée." };
  const source = await db.watchSource.create({ data: { name, url: url.toString() } });
  const first = await refreshSource(source);
  const after = await db.watchSource.findUnique({ where: { id: source.id }, select: { error: true } });
  if (after?.error) {
    // Flux illisible : la source n'est pas gardée (elle échouerait à chaque relevé).
    await db.watchSource.delete({ where: { id: source.id } });
    return { error: `Flux illisible (${errorText(after.error)}) : vérifiez l'adresse du flux RSS ou Atom.` };
  }
  await audit(admin.id, "admin.watch_source_add", "WatchSource", source.id, { name, url: url.toString() });
  revalidatePath("/admin/veille");
  return { ok: `${name} : ${first.read} publication${first.read > 1 ? "s" : ""} lue${first.read > 1 ? "s" : ""}. La source est relevée toutes les six heures.` };
}

/** Source mise en pause ou relancée (ses publications restent), ou supprimée avec ses publications. */
export async function updateWatchSource(form: FormData) {
  const admin = await requirePlatformAdmin();
  const source = await db.watchSource.findUnique({ where: { id: str(form, "sourceId") } });
  if (!source) return;
  const op = str(form, "op");
  if (op === "delete") await db.watchSource.delete({ where: { id: source.id } });
  else await db.watchSource.update({ where: { id: source.id }, data: { active: op === "resume" } });
  await audit(admin.id, `admin.watch_source_${op === "delete" ? "delete" : op === "resume" ? "resume" : "pause"}`, "WatchSource", source.id, { name: source.name });
  revalidatePath("/admin/veille");
}

/** Membre autorisé (rôles des statistiques) d'une organisation qui dispose de l'option ; sinon null. */
async function access(orgId: string) {
  const m = await requireMembership(orgId, STATS_ROLES);
  return (await orgHasAddon(orgId, "intelligence")) ? m : null;
}

/**
 * Publication ajoutée à la main à la veille de l'organisation (publication d'un réseau social, article hors des
 * sources relevées) : lien, titre et date, visibles de cette organisation seulement. KolBase n'ouvre pas le lien.
 */
export async function addWatchPin(_: ActionState, form: FormData): Promise<ActionState> {
  const { t } = await getT();
  const orgId = str(form, "orgId");
  const m = await access(orgId);
  if (!m) return { error: t("Cette page fait partie de l'option KolBase Intelligence.") };
  const title = str(form, "title", 240);
  let url: URL | null = null;
  try {
    url = new URL(str(form, "url", 600));
  } catch {
    url = null;
  }
  if (!url || url.protocol !== "https:") return { error: t("Indiquez l'adresse complète de la publication (https://…).") };
  if (!title) return { error: t("Indiquez un titre : c'est lui qui est rapproché de vos concurrents suivis.") };
  const day = dayOrNull(str(form, "date"));
  if (day === undefined || (day && day > new Date())) return { error: t("Date invalide.") };
  if ((await db.watchItem.count({ where: { organizationId: orgId } })) >= 500) return { error: t("Vous avez atteint 500 publications ajoutées : retirez-en pour en ajouter d'autres.") };
  await db.watchItem.create({ data: { organizationId: orgId, title, url: url.toString(), summary: str(form, "note", 300) || null, publishedAt: day ?? new Date() } });
  await audit(m.user.id, "intelligence.pin_add", "Organization", orgId, { url: url.toString() });
  revalidatePath(`/organisations/${orgId}/intelligence`);
  return { ok: t("Publication ajoutée à votre veille.") };
}

/** Publication ajoutée à la main, retirée par l'organisation. */
export async function removeWatchPin(form: FormData) {
  const orgId = str(form, "orgId");
  const m = await access(orgId);
  if (!m) return;
  await db.watchItem.deleteMany({ where: { id: str(form, "itemId"), organizationId: orgId } });
  revalidatePath(`/organisations/${orgId}/intelligence`);
}
