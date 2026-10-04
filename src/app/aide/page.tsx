import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { StatCard } from "@/components/PublicCards";
import { publicCounts } from "@/lib/public-data";

export const metadata = { title: "Aide — Kolbase" };
export const dynamic = "force-dynamic";

const FAQ: [string, string][] = [
  ["Qui peut s'inscrire ?", "Tout professionnel de santé du secteur dentaire, ainsi que les membres d'organisations (industriels, sociétés savantes, associations, organismes de formation)."],
  ["Faut-il être référencé pour s'inscrire à un événement ?", "Non. Un compte suffit. Le référencement comme expert est un choix distinct, activable depuis « Mon compte »."],
  ["Que deviennent les avantages acceptés à un événement ?", "Chaque prestation acceptée (repas, nuitée, transport…) est valorisée, fait l'objet d'une convention d'hospitalité et est publiée sur Transparence Santé."],
  ["Comment une organisation sollicite-t-elle un expert ?", "Depuis l'annuaire ou une opportunité : elle ouvre un dossier, propose des honoraires vérifiés face aux références de juste contrepartie, puis le dossier suit le circuit de conformité."],
  ["Mes données sont-elles publiques ?", "Seuls les experts référencés apparaissent sur le site public, avec des informations limitées. Coordonnées et tarifs sont réservés aux membres connectés."],
  ["Combien coûte Kolbase ?", "Le référencement est gratuit pour les praticiens et les organisations."],
];

export default async function Page() {
  const n = await publicCounts();
  return (
    <>
      <SiteHeader variant="public" />
      <main className="landing">
        <section className="public-section">
          <div className="eyebrow mb-1">Aide</div>
          <h1 className="section-h2">Bien démarrer sur Kolbase</h1>
          <div className="stats-row mt-4">
            <StatCard label="Experts référencés" value={n.experts} />
            <StatCard label="Événements à venir" value={n.events} electric />
            <StatCard label="Appels ouverts" value={n.calls} />
          </div>
          <div className="grid-2">
            <div className="card">
              <h2>Vous êtes praticien</h2>
              <ol className="plain">
                <li>Créez votre compte et complétez « Mon compte ».</li>
                <li>Inscrivez-vous aux événements et choisissez les prestations acceptées.</li>
                <li>Référencez-vous comme expert pour recevoir des sollicitations et candidater.</li>
              </ol>
              <Link href="/inscription" className="btn mt-3">Créer mon compte</Link>
            </div>
            <div className="card">
              <h2>Vous représentez une organisation</h2>
              <ol className="plain">
                <li>Créez votre organisation et invitez vos équipes avec leurs rôles.</li>
                <li>Publiez événements et opportunités, sollicitez les experts.</li>
                <li>Suivez la conformité : validation, Ordre, conventions, hospitalités.</li>
              </ol>
              <Link href="/inscription" className="btn mt-3">Référencer mon organisation</Link>
            </div>
          </div>
        </section>
        <section className="public-section pt-0">
          <div className="eyebrow mb-1">Questions fréquentes</div>
          <h2 className="section-h2 mb-4">FAQ</h2>
          <div className="stack">
            {FAQ.map(([q, a]) => (
              <details key={q} className="card faq"><summary>{q}</summary><p className="mt-2">{a}</p></details>
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
