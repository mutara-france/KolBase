import { SiteHeader } from "@/components/SiteHeader";
import { NewsCard } from "@/components/News";
import { NewsletterCta } from "@/components/NewsletterCta";
import { EtudePromo } from "@/components/EtudePromo";
import { NewsCategories } from "@/components/NewsCategories";
import { ARTICLE_CATEGORIES } from "@/lib/article-format";
import { publishedArticles, publishedCountsByCategory } from "@/lib/news";
import { fmtDate } from "@/lib/i18n";
import { publicPage } from "@/lib/seo";
import { getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const { t } = await getT();
  return publicPage({ title: `${t("Actualités")} — KolBase`, description: t("Nouveautés de KolBase, réglementation des liens d'intérêts, événements et conseils pratiques."), path: "/actualites" });
}

export default async function Page({ searchParams }: { searchParams: Promise<{ rubrique?: string }> }) {
  // Rubrique choisie dans l'adresse ; une valeur inconnue revient à « toutes ».
  const wanted = (await searchParams).rubrique;
  const category = wanted && (ARTICLE_CATEGORIES as readonly string[]).includes(wanted) ? wanted : null;
  const [articles, counts, { t, locale }] = await Promise.all([publishedArticles(undefined, category ?? undefined), publishedCountsByCategory(), getT()]);
  return (
    <>
      <SiteHeader variant="public" />
      <main className="landing">
        <section className="page-band">
          <div className="page-band-inner">
            <span className="kicker">{t("Actualités")}</span>
            <h1>{t("Les nouvelles de KolBase")}</h1>
            <p className="lead">{t("Nouveautés de la plateforme, réglementation des liens d'intérêts, événements et conseils pratiques.")}</p>
          </div>
        </section>
        <section className="home-section">
          <div className="home-wrap">
            <EtudePromo />
            <NewsCategories counts={counts} current={category} t={t} allLabel={t("Toutes")} ariaLabel={t("Rubriques")} />
            {articles.length === 0 ? <p className="muted">{category ? t("Aucune actualité dans cette rubrique pour l'instant.") : t("Aucune actualité pour l'instant.")}</p> : (
              <div className="news-grid">
                {articles.map((a) => <NewsCard key={a.id} a={{ ...a, category: t(a.category) }} dateLabel={fmtDate(locale, a.publishedAt!, { day: "numeric", month: "long", year: "numeric" })} minutesLabel={t("{n} min de lecture")} />)}
              </div>
            )}
            <NewsletterCta />
          </div>
        </section>
      </main>
    </>
  );
}
