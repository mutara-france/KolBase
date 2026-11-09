import Link from "next/link";
import type { Metadata } from "next";
import { Download } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { NewsCard } from "@/components/News";
import { appUrl } from "@/lib/ics";
import { JsonLd } from "@/components/JsonLd";
import { db } from "@/lib/db";
import { BAROMETRE_PDF } from "@/lib/etudes";
import { fmtDate } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

// L'étude n'existe qu'en français : la page qui la présente aussi, comme les textes légaux.
const PDF = BAROMETRE_PDF;
const TITLE = "Baromètre des collaborations dentaires 2022-2025";
const DESCRIPTION = "Étude KolBase : 134 583 déclarations Transparence Santé au bénéfice de chirurgiens-dentistes, de 2022 à 2025, lues sous l'angle de la profession. 65 pages, en accès libre.";

export const metadata: Metadata = {
  title: `${TITLE} — KolBase`,
  description: DESCRIPTION,
  alternates: { canonical: "/barometre" },
  openGraph: { type: "article", siteName: "KolBase", url: "/barometre", title: TITLE, description: DESCRIPTION },
};

// Chiffres de la synthèse (page 4 de l'étude), dans le même ordre.
const FIGURES: [string, string, string][] = [
  ["1 sur 3", "Un praticien sur trois concerné", "14 826 chirurgiens-dentistes en exercice sur 47 636 ont au moins un lien déclaré en 2025. Chez les médecins, c'est un sur deux."],
  ["1 sur 2", "Une population qui change", "Plus d'un praticien concerné en 2024 sur deux ne l'est plus en 2025."],
  ["1 %", "137 praticiens, près de la moitié de la valeur", "Le premier pour cent des praticiens ayant reçu une valeur en reçoit 49 % en 2025."],
  ["1 sur 4", "Une praticienne sur quatre parmi les intervenants", "Les praticiennes forment 52 % de la profession, mais 26 % des intervenants."],
  ["2 sur 3", "Dix entreprises, deux euros sur trois", "Sur 172 entreprises déclarantes en 2025, les dix premières portent 68 % de la valeur reçue par les praticiens."],
  ["1 500 €", "Un contrat d'intervenant, sans hausse depuis 2022", "Montant médian en 2022 comme en 2025 : 7 % de moins en euros constants."],
  ["×7,5", "Les study clubs se multiplient", "145 conventions de study club en 2022, 1 082 en 2025, pour 75 sessions."],
  ["1 sur 40", "Moins de participations en centre de santé", "2,4 % des praticiens de centre de santé conviés à un événement en 2025, contre 4,5 % en cabinet de groupe."],
];

const CHAPTERS: [string, string[]][] = [
  ["Partie 1 · Les praticiens et la collaboration", ["Qui est concerné : régions, spécialités, lieux d'exercice", "Les intervenants : profil, cercles d'experts, renouvellement", "Ce qui est déclaré : avantages, conventions, montants de référence", "Pour les praticiens : vos déclarations, les seuils d'autorisation"]],
  ["Partie 2 · Les industriels : stratégies, tendances, innovations", ["Le paysage des entreprises : classement, groupes, métiers", "Les événements : formats, thèmes, calendrier", "Quatre ans de mouvements : six trajectoires d'entreprises", "Les structures du secteur : congrès, sociétés savantes, universités", "Demain : neuf forces d'ici 2030 et sept recommandations"]],
];

export default async function Page() {
  const [{ t, locale }, articles] = await Promise.all([
    getT(),
    db.article.findMany({ where: { category: "Études", publishedAt: { not: null, lte: new Date() } }, select: { id: true, slug: true, title: true, category: true, excerpt: true, coverType: true, publishedAt: true, updatedAt: true, body: true }, orderBy: { publishedAt: "desc" }, take: 3 }),
  ]);
  const base = appUrl();
  const structured = {
    "@context": "https://schema.org",
    "@type": "Report",
    name: TITLE,
    description: DESCRIPTION,
    inLanguage: "fr-FR",
    datePublished: "2026-10",
    numberOfPages: 65,
    url: `${base}/barometre`,
    encoding: { "@type": "MediaObject", contentUrl: `${base}${PDF}`, encodingFormat: "application/pdf" },
    author: { "@type": "Organization", name: "KolBase", url: base },
    publisher: { "@type": "Organization", name: "KolBase", url: base, logo: { "@type": "ImageObject", url: `${base}/brand/kolbase-logo-outremer.svg` } },
  };
  const download = (label: string, cls = "btn") => (
    <a className={`${cls} etude-download`} href={PDF} download>
      <Download size={17} aria-hidden /> {label}
    </a>
  );
  return (
    <>
      <SiteHeader variant="public" />
      <JsonLd data={structured} />
      <main className="landing">
        <section className="home-hero etude-hero" aria-labelledby="etude-titre">
          <div className="home-wrap etude-hero-inner">
            <div className="home-hero-text">
              <p className="home-pill">Étude KolBase · octobre 2026 · accès libre</p>
              <h1 id="etude-titre" className="home-title">Baromètre des collaborations dentaires <em>2022 — 2025</em></h1>
              <p className="home-lede">134 583 déclarations Transparence Santé au bénéfice de chirurgiens-dentistes, lues sous l&apos;angle de la profession : qui collabore avec l&apos;industrie, pour quoi, pour quels montants, et sept recommandations pour 2030.</p>
              <div className="etude-actions">
                {download("Télécharger l'étude (PDF, 65 pages)", "btn etude-btn")}
                <a className="etude-link" href="#essentiel">L&apos;essentiel en huit chiffres ↓</a>
              </div>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="etude-cover" src="/etudes/barometre-2022-2025/pdf-couverture.webp" alt="Couverture du Baromètre des collaborations dentaires 2022-2025" width={500} height={550} />
          </div>
        </section>

        <section className="home-section" id="essentiel" aria-labelledby="etude-essentiel">
          <div className="home-wrap">
            <span className="kicker">Synthèse</span>
            <h2 id="etude-essentiel" className="etude-h2">L&apos;essentiel en huit chiffres</h2>
            <p className="etude-intro">Quatre constats côté praticiens, quatre côté industriels. L&apos;étude complète les détaille page par page, avec 48 entreprises citées par leur nom.</p>
            <ul className="etude-figures">
              {FIGURES.map(([n, title, text]) => (
                <li key={n}>
                  <strong>{n}</strong>
                  <b>{title}</b>
                  <span>{text}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="home-section tinted" aria-labelledby="etude-sommaire">
          <div className="home-wrap etude-split">
            <div>
              <span className="kicker">Au sommaire</span>
              <h2 id="etude-sommaire" className="etude-h2">Deux parties, huit chapitres</h2>
              <p className="etude-intro">Pour les organisations qui préparent leurs collaborations, et pour les praticiens qui s&apos;interrogent sur leur place dans ces échanges. Le baromètre décrit, il ne juge pas : aucun praticien n&apos;est nommé.</p>
              {download("Télécharger l'étude")}
            </div>
            <div className="etude-chapters">
              {CHAPTERS.map(([part, items]) => (
                <div key={part}>
                  <h3>{part}</h3>
                  <ol>{items.map((i) => <li key={i}>{i}</li>)}</ol>
                </div>
              ))}
            </div>
          </div>
        </section>

        {articles.length > 0 && (
          <section className="home-section" aria-labelledby="etude-articles">
            <div className="home-wrap">
              <h2 id="etude-articles" className="etude-h2">À lire sur le baromètre</h2>
              <div className="news-grid">
                {articles.map((a) => <NewsCard key={a.id} a={{ ...a, category: t(a.category) }} dateLabel={fmtDate(locale, a.publishedAt!, { day: "numeric", month: "long", year: "numeric" })} minutesLabel={t("{n} min de lecture")} />)}
              </div>
            </div>
          </section>
        )}

        <section className="home-section" aria-labelledby="etude-methode">
          <div className="home-wrap"><div className="etude-method">
            <h2 id="etude-methode" className="etude-h2">Méthode</h2>
            <p>Base publique Transparence Santé (data.gouv.fr), extraction du 28 octobre 2026 : 134 583 déclarations datées de 2022 à 2025 au bénéfice de chirurgiens-dentistes, et 8 381 au bénéfice de structures du secteur, rapprochées de l&apos;Annuaire santé (RPPS) et des effectifs de la DREES. Seuls des agrégats sont publiés ; aucun montant n&apos;est rapporté à moins de dix praticiens. Le baromètre sera actualisé avec les déclarations 2026.</p>
            <p>Presse et entreprises citées : <a href="mailto:contact@kolbase.io">contact@kolbase.io</a>. Les autres publications de KolBase sont dans les <Link href="/actualites">actualités</Link>.</p>
          </div></div>
        </section>
      </main>
    </>
  );
}
