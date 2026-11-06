import Link from "next/link";
import { Building2, ChevronDown, Mail, Newspaper, Stethoscope, Truck } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { publicPage } from "@/lib/seo";
import { getT } from "@/lib/i18n/server";
import { getCurrentUser } from "@/lib/auth";
import { orgJoinHref } from "@/lib/nav";
import { legal } from "@/lib/legal";

export async function generateMetadata() {
  const { t } = await getT();
  return publicPage({ title: t("Aide — KolBase"), description: t("Questions fréquentes sur KolBase : inscription, référencement des experts, événements, dossiers et conformité."), path: "/aide" });
}
export const dynamic = "force-dynamic";

/** Question (et son ancre), réponse, lien éventuel (libellé, adresse). */
type Faq = { id: string; q: string; a: string; link?: [string, string] };

/** Questions fréquentes, par thème : chaque thème et chaque question ont une ancre (lien direct depuis un e-mail ou une page). */
const FAQ: { id: string; title: string; items: Faq[] }[] = [
  {
    id: "compte",
    title: "Compte et inscription",
    items: [
      { id: "qui-peut-s-inscrire", q: "Qui peut s'inscrire ?", a: "Tout professionnel de santé du secteur dentaire, ainsi que les membres d'organisations (industriels, sociétés savantes, associations, organismes de formation)." },
      { id: "etre-reference", q: "Faut-il être référencé pour s'inscrire à un événement ?", a: "Non. Un compte suffit. Le référencement comme expert est un choix distinct, activable depuis « Mon compte »." },
      { id: "devenir-expert", q: "Comment devenir expert référencé ?", a: "Depuis « Mon compte », rubrique Référencement. Il est ouvert aux chirurgiens-dentistes, orthodontistes, chirurgiens oraux et stomatologues. L'équipe KolBase vérifie votre numéro RPPS (ou l'identifiant de votre pays d'exercice) avant d'afficher le badge « Identité vérifiée »." },
      { id: "hors-de-france", q: "J'exerce hors de France : puis-je être référencé ?", a: "Oui. Indiquez votre pays d'exercice et l'identifiant de ce pays (INAMI en Belgique, NPI aux États-Unis, numéro d'Ordre ailleurs) ; il est contrôlé de la même façon que le RPPS." },
      { id: "securite", q: "Comment protéger mon compte ?", a: "Activez la double authentification dans « Mon compte », rubrique Sécurité : un code à six chiffres donné par une application, et dix codes de secours. Une organisation peut l'exiger de tous ses membres." },
    ],
  },
  {
    id: "collaborations",
    title: "Collaborations et conformité",
    items: [
      { id: "solliciter", q: "Comment une organisation sollicite-t-elle un expert ?", a: "Depuis l'annuaire ou une opportunité : elle ouvre un dossier, propose des honoraires comparés à un repère indicatif, puis le dossier suit le circuit de conformité." },
      { id: "qui-voit-les-dossiers", q: "Qui voit les dossiers d'une organisation ?", a: "Les membres Administrateur, Projets et Conformité voient tous les dossiers de l'organisation. Chaque dossier a un ou plusieurs responsables, qui le retrouvent dans « Mes dossiers » et en reçoivent les e-mails." },
      { id: "conformite", q: "Comment un dossier passe-t-il la conformité ?", a: "L'équipe Projets le soumet à la conformité, qui le valide ou le bloque ; la personne qui a monté le dossier ne le valide pas elle-même. Selon les montants, la convention relève de la déclaration ou de l'autorisation de l'Ordre : KolBase prépare les pièces et garde la trace de chaque étape." },
    ],
  },
  {
    id: "evenements",
    title: "Événements et hospitalités",
    items: [
      { id: "avantages", q: "Que deviennent les avantages acceptés à un événement ?", a: "Chaque prestation acceptée (repas, nuitée, transport…) est valorisée et fait l'objet d'une convention d'hospitalité ; l'organisation la déclare ensuite sur Transparence Santé, à partir de l'export préparé par KolBase." },
      { id: "attestation", q: "Comment obtenir mon attestation de présence ?", a: "Une fois votre présence pointée, l'attestation est disponible dans « Mes inscriptions » ; elle vous est aussi envoyée par e-mail après l'événement, avec un questionnaire." },
    ],
  },
  {
    id: "donnees",
    title: "Données et tarifs",
    items: [
      { id: "donnees-publiques", q: "Mes données sont-elles publiques ?", a: "Seuls les experts référencés apparaissent sur le site public, avec des informations limitées. Coordonnées et tarifs sont réservés aux membres connectés." },
      { id: "exporter-supprimer", q: "Comment récupérer ou supprimer mes données ?", a: "Depuis « Mon compte » : « Télécharger mes données » fournit l'ensemble de vos données ; la suppression du compte efface le reste, sauf ce que des conventions ou déclarations passées obligent à conserver." },
      { id: "tarifs", q: "Combien coûte KolBase ?", a: "Rien pour les praticiens. Pour une organisation, la création de l'espace, l'équipe, l'annuaire des experts et les brouillons sont gratuits ; l'abonnement (599 € HT par mois, ou 5 990 € HT par an) commence à la première action qui engage un tiers : sollicitation envoyée, événement ou opportunité publiés, demande de devis envoyée. Le premier mois est offert. Les sociétés savantes, associations et organismes de formation publient leurs événements gratuitement. Pour un prestataire, le référencement est gratuit ; l'abonnement (249 € HT par mois, premier mois offert) n'est demandé qu'après un premier devis retenu, pour répondre à de nouvelles demandes.", link: ["Conditions de vente", "/conditions-de-vente"] },
    ],
  },
];

export default async function Page() {
  const [{ t }, user] = await Promise.all([getT(), getCurrentUser()]);
  // Prestataire : sa structure s'il en a une, sinon la création (après l'inscription pour un visiteur).
  const supplier = user?.memberships.find((m) => m.organization.kind === "PRESTATAIRE");
  const supplierHref = supplier ? `/organisations/${supplier.organizationId}` : user ? "/organisations/nouvelle" : "/inscription?profil=organisation";
  const contact = legal("contactEmail");
  const start = [
    {
      icon: Stethoscope,
      title: t("Vous êtes praticien"),
      steps: [t("Créez votre compte et complétez « Mon compte »."), t("Inscrivez-vous aux événements et choisissez les prestations acceptées."), t("Référencez-vous comme expert pour recevoir des sollicitations et candidater.")],
      cta: user ? [t("Compléter mon compte"), "/compte"] : [t("Créer mon compte"), "/inscription"],
      note: t("Gratuit pour les praticiens."),
    },
    {
      icon: Building2,
      title: t("Vous représentez une organisation"),
      steps: [t("Créez votre organisation et invitez vos équipes avec leurs rôles."), t("Publiez événements et opportunités, sollicitez les experts."), t("Suivez la conformité : validation, Ordre, conventions, hospitalités.")],
      cta: [t("Référencer mon organisation"), orgJoinHref(user, "organisation")],
      note: t("Gratuit jusqu'à votre première action qui engage un tiers, puis sur abonnement (premier mois offert)."),
    },
    {
      icon: Truck,
      title: t("Vous êtes prestataire"),
      steps: [t("Référencez votre structure avec toutes vos prestations (salle, traiteur, hébergement, transport, audiovisuel…) et complétez votre book."), t("Recevez les demandes de devis des organisations et répondez-y depuis KolBase."), t("Suivez vos devis, vos prestations et les avis laissés par vos clients.")],
      cta: [t("Référencer ma structure"), supplierHref],
      note: t("Référencement gratuit ; abonnement demandé après un premier devis retenu."),
    },
  ];
  return (
    <>
      <SiteHeader variant="public" />
      <main className="landing">
        <section className="public-section help-hero">
          <div className="eyebrow help-eyebrow">{t("Aide")}</div>
          <h1 className="section-h2">{t("Bien démarrer sur KolBase")}</h1>
          <p className="help-lead">{t("Les premiers pas selon votre profil, puis les réponses aux questions les plus fréquentes.")}</p>
          <nav className="chips" aria-label={t("Thèmes de l'aide")}>
            {FAQ.map((g) => <a key={g.id} href={`#${g.id}`} className="chip">{t(g.title)}</a>)}
          </nav>
        </section>

        <section className="public-section pt-0" aria-labelledby="demarrer">
          <h2 id="demarrer" className="sr-only">{t("Premiers pas")}</h2>
          <div className="help-start">
            {start.map((c) => (
              <article key={c.title} className="help-card">
                <span className="help-icon" aria-hidden><c.icon size={20} /></span>
                <h3>{c.title}</h3>
                <ol className="help-steps">{c.steps.map((s) => <li key={s}>{s}</li>)}</ol>
                <div className="help-card-foot">
                  <Link href={c.cta[1]} className="btn">{c.cta[0]}</Link>
                  <p className="hint">{c.note}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="public-section pt-0" aria-labelledby="faq">
          <h2 id="faq" className="section-h2 mb-4">{t("Questions fréquentes")}</h2>
          <div className="help-faq">
            {FAQ.map((g) => (
              <section key={g.id} id={g.id} className="help-group" aria-labelledby={`${g.id}-titre`}>
                <h3 id={`${g.id}-titre`} className="help-group-title">{t(g.title)}</h3>
                <div className="help-items">
                  {g.items.map((f) => (
                    <details key={f.id} id={f.id} className="faq">
                      <summary>
                        <span>{t(f.q)}</span>
                        <ChevronDown size={18} aria-hidden className="faq-chevron" />
                      </summary>
                      <p>{t(f.a)}{f.link && <> <Link href={f.link[1]}>{t(f.link[0])}</Link></>}</p>
                    </details>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </section>

        <section className="public-section pt-0">
          <div className="help-contact">
            <div>
              <h2>{t("Vous ne trouvez pas la réponse ?")}</h2>
              <p>{t("Écrivez-nous : nous vous répondons par e-mail.")}</p>
            </div>
            <div className="help-contact-links">
              <a className="btn" href={`mailto:${contact}`}><Mail size={16} aria-hidden /> {contact}</a>
              <Link className="btn secondary" href="/actualites"><Newspaper size={16} aria-hidden /> {t("Guides et réglementation")}</Link>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
