import Link from "next/link";
import { Newspaper } from "lucide-react";
import { parseArticle, readingMinutes, type Inline } from "@/lib/article-format";
import { coverSrc, type NewsCardData } from "@/lib/news";

const Parts = ({ parts }: { parts: Inline[] }) => (
  <>
    {parts.map((p, i) =>
      p.href ? (
        p.href.startsWith("/") ? <Link key={i} href={p.href}>{p.text}</Link> : <a key={i} href={p.href} target="_blank" rel="noopener noreferrer">{p.text}</a>
      ) : p.bold ? <strong key={i}>{p.text}</strong> : <span key={i}>{p.text}</span>,
    )}
  </>
);

/** Corps d'une actualité, rendu bloc par bloc (aucun HTML brut). */
export function ArticleBody({ body }: { body: string }) {
  return (
    <div className="article-body">
      {parseArticle(body).map((b, i) =>
        b.kind === "h2" ? <h2 key={i}>{b.text}</h2>
          : b.kind === "ul" ? <ul key={i}>{b.items.map((it, j) => <li key={j}><Parts parts={it} /></li>)}</ul>
          : <p key={i}><Parts parts={b.parts} /></p>,
      )}
    </div>
  );
}

/** Carte d'actualité (liste, page d'accueil). */
export function NewsCard({ a, dateLabel, minutesLabel }: { a: NewsCardData; dateLabel: string; minutesLabel: string }) {
  const src = coverSrc(a);
  return (
    <Link href={`/actualites/${a.slug}`} className="card news-card">
      <div className="news-cover">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {src ? <img src={src} alt="" loading="lazy" /> : <Newspaper size={34} aria-hidden />}
      </div>
      <div className="news-text">
        <span className="eyebrow-sm">{a.category} · {dateLabel} · {minutesLabel.replace("{n}", String(readingMinutes(a.body)))}</span>
        <strong>{a.title}</strong>
        <p>{a.excerpt}</p>
      </div>
    </Link>
  );
}
