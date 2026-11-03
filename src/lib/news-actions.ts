"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/auth";
import { requirePlatformAdmin } from "@/lib/platform";
import { str } from "@/lib/form";
import { sniffLogo } from "@/lib/logos";
import { ARTICLE_CATEGORIES, slugify } from "@/lib/article-format";

export type FormState = { error?: string; ok?: string } | undefined;
const COVER_MAX = 1.5 * 1024 * 1024;

function refresh(slug?: string) {
  revalidatePath("/actualites");
  if (slug) revalidatePath(`/actualites/${slug}`);
  revalidatePath("/");
  revalidatePath("/admin");
}

/** Création ou modification d'une actualité (brouillon tant qu'elle n'est pas publiée). */
export async function saveArticle(_: FormState, form: FormData): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const id = str(form, "id");
  const title = str(form, "title").slice(0, 160);
  const excerpt = str(form, "excerpt").slice(0, 400);
  const body = str(form, "body").slice(0, 40000);
  const category = (ARTICLE_CATEGORIES as readonly string[]).includes(str(form, "category")) ? str(form, "category") : "Plateforme";
  if (!title || !excerpt || !body) return { error: "Titre, chapô et texte sont obligatoires." };
  let slug = slugify(str(form, "slug") || title);
  const clash = await db.article.findFirst({ where: { slug, ...(id ? { NOT: { id } } : {}) }, select: { id: true } });
  if (clash) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
  const file = form.get("cover");
  let cover: { coverData: Uint8Array<ArrayBuffer>; coverType: string } | null = null;
  if (file instanceof File && file.size > 0) {
    if (file.size > COVER_MAX) return { error: "Image trop lourde (1,5 Mo au plus)." };
    const bytes = new Uint8Array(await file.arrayBuffer());
    const type = sniffLogo(bytes);
    if (!type) return { error: "Image au format PNG, JPEG ou WebP." };
    cover = { coverData: bytes, coverType: type };
  }
  const data = { title, excerpt, body, category, slug, ...(cover ?? {}), ...(form.get("removeCover") === "1" && !cover ? { coverData: null, coverType: null } : {}) };
  const a = id ? await db.article.update({ where: { id }, data }) : await db.article.create({ data: { ...data, authorId: admin.id } });
  await audit(admin.id, id ? "news.update" : "news.create", "Article", a.id);
  refresh(a.slug);
  if (!id) redirect(`/admin/actualites/${a.id}?cree=1`);
  return { ok: "Enregistré." };
}

/** Publication (date du jour) ou retour en brouillon. */
export async function setArticlePublished(form: FormData) {
  const admin = await requirePlatformAdmin();
  const id = str(form, "id");
  const publish = form.get("publish") === "1";
  const a = await db.article.update({ where: { id }, data: { publishedAt: publish ? new Date() : null } });
  await audit(admin.id, publish ? "news.publish" : "news.unpublish", "Article", id);
  refresh(a.slug);
}

export async function deleteArticle(form: FormData) {
  const admin = await requirePlatformAdmin();
  const id = str(form, "id");
  const a = await db.article.delete({ where: { id } });
  await audit(admin.id, "news.delete", "Article", id, { title: a.title });
  refresh(a.slug);
  redirect("/admin?onglet=actualites");
}
