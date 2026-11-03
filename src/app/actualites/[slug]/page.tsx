import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { ArticleBody, NewsCard } from "@/components/News";
import { NewsletterCta } from "@/components/NewsletterCta";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { isPlatformAdmin } from "@/lib/platform";
import { coverSrc, publishedArticles } from "@/lib/news";
import { readingMinutes } from "@/lib/article-format";
import { fmtDate } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const a = await db.article.findFirst({ where: { slug, publishedAt: { not: null, lte: new Date() } }, select: { title: true, excerpt: true } });
  return a ? { title: `${a.title} — KolBase`, description: a.excerpt.slice(0, 160) } : { title: "Actualité — KolBase", robots: { index: false } };
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getCurrentUser();
  const admin = !!user && isPlatformAdmin(user);
  // Un brouillon s'affiche seulement pour l'équipe KolBase (aperçu avant publication).
  const a = await db.article.findFirst({ where: { slug, ...(admin ? {} : { publishedAt: { not: null, lte: new Date() } }) } });
  if (!a) notFound();
  const { t, locale } = await getT();
  const others = (await publishedArticles(4)).filter((x) => x.id !== a.id).slice(0, 3);
  const src = coverSrc(a);
  return (
    <>
      <SiteHeader variant="public" />
      <main className="landing">
        <article className="article">
          <p className="muted"><Link href="/actualites">← {t("Toutes les actualités")}</Link></p>
          {!a.publishedAt && <p className="notice warn">{t("Brouillon : visible de l'équipe KolBase seulement.")} <Link href={`/admin/actualites/${a.id}`}>{t("Modifier")}</Link></p>}
          <span className="eyebrow-sm">{a.category}{a.publishedAt ? ` · ${fmtDate(locale, a.publishedAt, { day: "numeric", month: "long", year: "numeric" })}` : ""} · {t("{n} min de lecture", { n: readingMinutes(a.body) })}</span>
          <h1>{a.title}</h1>
          <p className="lead">{a.excerpt}</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {src && <img className="article-cover" src={src} alt="" />}
          <ArticleBody body={a.body} />
          {a.publishedAt && <NewsletterCta next={`/actualites/${a.slug}`} />}
          {admin && a.publishedAt && <p className="hint"><Link href={`/admin/actualites/${a.id}`}>{t("Modifier")}</Link></p>}
        </article>
        {others.length > 0 && (
          <section className="home-section">
            <div className="home-wrap">
              <h2>{t("À lire aussi")}</h2>
              <div className="news-grid">
                {others.map((o) => <NewsCard key={o.id} a={o} dateLabel={fmtDate(locale, o.publishedAt!, { day: "numeric", month: "long", year: "numeric" })} minutesLabel={t("{n} min de lecture")} />)}
              </div>
            </div>
          </section>
        )}
      </main>
    </>
  );
}
