import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { ArticleForm } from "@/components/ArticleForm";
import { db } from "@/lib/db";
import { requirePlatformAdmin } from "@/lib/platform";
import { ARTICLE_CATEGORIES } from "@/lib/article-format";
import { coverSrc } from "@/lib/news";
import { deleteArticle, setArticlePublished } from "@/lib/news-actions";
import { formatDate } from "@/lib/events";
import { ConfirmButton } from "@/components/ConfirmButton";

export const metadata = { title: "Actualité — KolBase" };

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ cree?: string }> }) {
  await requirePlatformAdmin();
  const { id } = await params;
  const { cree } = await searchParams;
  const a = await db.article.findUnique({ where: { id } });
  if (!a) notFound();
  return (
    <>
      <SiteHeader />
      <main className="narrow stack">
        <p className="muted"><Link href="/admin">Administration</Link> › <Link href="/admin/actualites">Actualités</Link></p>
        <div className="actions spread">
          <h1>{a.title}</h1>
          <span className={`pill ${a.publishedAt ? "ok" : "wait"}`}>{a.publishedAt ? `Publiée le ${formatDate(a.publishedAt)}` : "Brouillon"}</span>
        </div>
        {/* Message de création, tant que l'article est un brouillon (plus après « Enregistrer et publier »). */}
        {cree && !a.publishedAt && <p className="notice ok">Brouillon créé. Relisez-le avec l&apos;aperçu, puis publiez-le.</p>}
        <div className="actions">
          <Link className="btn ghost small" href={`/actualites/${a.slug}`} target="_blank">{a.publishedAt ? "Voir en ligne" : "Aperçu"}</Link>
          {/* La publication se fait depuis le formulaire (« Enregistrer et publier ») : ce qui est à l'écran est publié. */}
          {a.publishedAt && (
            <form action={setArticlePublished}>
              <input type="hidden" name="id" value={a.id} />
              <input type="hidden" name="publish" value="0" />
              <button className="btn ghost small">Repasser en brouillon</button>
            </form>
          )}
          <form action={deleteArticle}>
            <input type="hidden" name="id" value={a.id} />
            <ConfirmButton className="link danger" confirm="supprimer définitivement l'actualité" summary={<>« {a.title} »{a.publishedAt ? " est en ligne : elle disparaîtra de la rubrique Actualités et de l'accueil." : " (brouillon)."} La suppression est définitive.</>}>
              Supprimer
            </ConfirmButton>
          </form>
        </div>
        <ArticleForm a={{ id: a.id, title: a.title, slug: a.slug, category: a.category, excerpt: a.excerpt, body: a.body, cover: coverSrc(a), published: !!a.publishedAt }} categories={ARTICLE_CATEGORIES} />
      </main>
    </>
  );
}
