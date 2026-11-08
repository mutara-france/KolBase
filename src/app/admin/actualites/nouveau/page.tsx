import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { ArticleForm } from "@/components/ArticleForm";
import { requirePlatformAdmin } from "@/lib/platform";
import { ARTICLE_CATEGORIES } from "@/lib/article-format";

export const metadata = { title: "Nouvelle actualité — KolBase" };

export default async function Page() {
  await requirePlatformAdmin();
  return (
    <>
      <SiteHeader />
      <main className="narrow stack">
        <p className="muted"><Link href="/admin">Administration</Link> › <Link href="/admin/actualites">Actualités</Link></p>
        <h1>Nouvelle actualité</h1>
        <ArticleForm a={{ title: "", slug: "", category: "Plateforme", excerpt: "", body: "", cover: null }} categories={ARTICLE_CATEGORIES} />
      </main>
    </>
  );
}
