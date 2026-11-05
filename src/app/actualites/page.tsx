import { SiteHeader } from "@/components/SiteHeader";
import { NewsCard } from "@/components/News";
import { NewsletterCta } from "@/components/NewsletterCta";
import { publishedArticles } from "@/lib/news";
import { fmtDate } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: `${t("Actualités")} — KolBase`, description: t("Nouveautés de KolBase, réglementation des liens d'intérêts, événements et conseils pratiques.") };
}

export default async function Page() {
  const [articles, { t, locale }] = await Promise.all([publishedArticles(), getT()]);
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
            {articles.length === 0 ? <p className="muted">{t("Aucune actualité pour l'instant.")}</p> : (
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
