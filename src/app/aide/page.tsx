import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { publicPage } from "@/lib/seo";
import { getT } from "@/lib/i18n/server";
import { getCurrentUser } from "@/lib/auth";
import { orgJoinHref } from "@/lib/nav";

export async function generateMetadata() {
  const { t } = await getT();
  return publicPage({ title: t("Aide — KolBase"), description: t("Questions fréquentes sur KolBase : inscription, référencement des experts, événements, dossiers et conformité."), path: "/aide" });
}
export const dynamic = "force-dynamic";

/** Question, réponse, et lien éventuel (libellé, adresse). */
const FAQ: [string, string, [string, string]?][] = [
  ["Qui peut s'inscrire ?", "Tout professionnel de santé du secteur dentaire, ainsi que les membres d'organisations (industriels, sociétés savantes, associations, organismes de formation)."],
  ["Faut-il être référencé pour s'inscrire à un événement ?", "Non. Un compte suffit. Le référencement comme expert est un choix distinct, activable depuis « Mon compte »."],
  ["Que deviennent les avantages acceptés à un événement ?", "Chaque prestation acceptée (repas, nuitée, transport…) est valorisée et fait l'objet d'une convention d'hospitalité ; l'organisation la déclare ensuite sur Transparence Santé, à partir de l'export préparé par KolBase."],
  ["Comment une organisation sollicite-t-elle un expert ?", "Depuis l'annuaire ou une opportunité : elle ouvre un dossier, propose des honoraires comparés à un repère indicatif, puis le dossier suit le circuit de conformité."],
  ["Mes données sont-elles publiques ?", "Seuls les experts référencés apparaissent sur le site public, avec des informations limitées. Coordonnées et tarifs sont réservés aux membres connectés."],
  ["Combien coûte KolBase ?", "Rien pour les praticiens. Pour une organisation, la création de l'espace, l'équipe, l'annuaire des experts et les brouillons sont gratuits ; l'abonnement (599 € HT par mois, ou 5 990 € HT par an) commence à la première action qui engage un tiers : sollicitation envoyée, événement ou opportunité publiés, demande de devis envoyée. Le premier mois est offert. Les sociétés savantes, associations et organismes de formation publient leurs événements gratuitement. Pour un prestataire, le référencement est gratuit ; l'abonnement (249 € HT par mois, premier mois offert) n'est demandé qu'après un premier devis retenu, pour répondre à de nouvelles demandes.", ["Conditions de vente", "/conditions-de-vente"]],
];

export default async function Page() {
  const [{ t }, user] = await Promise.all([getT(), getCurrentUser()]);
  return (
    <>
      <SiteHeader variant="public" />
      <main className="landing">
        <section className="public-section">
          <div className="eyebrow mb-1">{t("Aide")}</div>
          <h1 className="section-h2">{t("Bien démarrer sur KolBase")}</h1>
          <div className="grid-2">
            <div className="card">
              <h2>{t("Vous êtes praticien")}</h2>
              <ol className="plain">
                <li>{t("Créez votre compte et complétez « Mon compte ».")}</li>
                <li>{t("Inscrivez-vous aux événements et choisissez les prestations acceptées.")}</li>
                <li>{t("Référencez-vous comme expert pour recevoir des sollicitations et candidater.")}</li>
              </ol>
              <Link href="/inscription" className="btn mt-3">{t("Créer mon compte")}</Link>
            </div>
            <div className="card">
              <h2>{t("Vous représentez une organisation")}</h2>
              <ol className="plain">
                <li>{t("Créez votre organisation et invitez vos équipes avec leurs rôles.")}</li>
                <li>{t("Publiez événements et opportunités, sollicitez les experts.")}</li>
                <li>{t("Suivez la conformité : validation, Ordre, conventions, hospitalités.")}</li>
              </ol>
              <Link href={orgJoinHref(user, "organisation")} className="btn mt-3">{t("Référencer mon organisation")}</Link>
              <p className="hint mt-2">{t("Gratuit jusqu'à votre première action qui engage un tiers, puis sur abonnement (premier mois offert).")}</p>
              <p className="hint">{t("Publier vos événements est gratuit pour les sociétés savantes, associations et organismes de formation.")}</p>
            </div>
          </div>
        </section>
        <section className="public-section pt-0">
          <h2 className="section-h2 mb-4">{t("Questions fréquentes")}</h2>
          <div className="stack">
            {FAQ.map(([q, a, link]) => (
              <details key={q} className="card faq"><summary>{t(q)}</summary><p className="mt-2">{t(a)}{link && <> <Link href={link[1]}>{t(link[0])}</Link></>}</p></details>
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
