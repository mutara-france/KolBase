import Link from "next/link";
import { BadgeCheck, Lock, Mail, Scale, ShieldCheck } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { publicPage } from "@/lib/seo";
import { getT } from "@/lib/i18n/server";
import { LEGAL, legal } from "@/lib/legal";
import { appUrl } from "@/lib/ics";
import { jsonLd } from "@/lib/jsonld";

export async function generateMetadata() {
  const { t } = await getT();
  return publicPage({
    title: t("Qui sommes-nous — KolBase"),
    description: t("KolBase, fondée par Kévin Peyrotte : la plateforme qui met en relation les chirurgiens-dentistes et les organisations du secteur dentaire."),
    path: "/qui-sommes-nous",
  });
}
export const dynamic = "force-dynamic";

/** Le fondateur : nom, photo (public/equipe), fonction. */
const FOUNDER = { name: "Kévin Peyrotte", photo: "/equipe/kevin-peyrotte.webp" };

/** Qui sommes-nous : la plateforme, son fondateur, ce qui la guide. Les informations sur la société éditrice restent dans les mentions légales. */
export default async function Page() {
  const { t } = await getT();
  const contact = legal("contactEmail");
  const base = appUrl();
  const principles = [
    { icon: BadgeCheck, title: t("Des identités vérifiées"), text: t("Chaque expert référencé est contrôlé par son numéro RPPS ou l'identifiant de son pays d'exercice avant d'afficher le badge « Identité vérifiée ».") },
    { icon: Scale, title: t("La conformité intégrée"), text: t("Validation interne, Ordre, conventions, hospitalités, Transparence Santé : KolBase prépare les pièces et garde la trace de chaque étape.") },
    { icon: ShieldCheck, title: t("Une plateforme neutre"), text: t("KolBase n'est partie à aucune convention entre ses utilisateurs et ne fait la promotion d'aucun produit de santé.") },
    { icon: Lock, title: t("Des données protégées"), text: t("Serveurs dans l'Union européenne, double authentification, et vos données restent les vôtres : vous pouvez les télécharger ou les supprimer depuis « Mon compte ».") },
  ];
  const structured = {
    "@context": "https://schema.org",
    "@type": "AboutPage",
    url: `${base}/qui-sommes-nous`,
    mainEntity: {
      "@type": "Organization",
      name: "KolBase",
      url: base,
      logo: `${base}/brand/kolbase-logo-outremer.svg`,
      founder: { "@type": "Person", name: FOUNDER.name, jobTitle: "Fondateur et CEO", image: `${base}${FOUNDER.photo}` },
      ...(LEGAL.contactEmail ? { email: LEGAL.contactEmail } : {}),
    },
  };
  return (
    <>
      <SiteHeader variant="public" />
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(structured)} />
      <main className="landing">
        <section className="public-section about-hero">
          <div className="eyebrow help-eyebrow">{t("Qui sommes-nous")}</div>
          <h1 className="section-h2">{t("Une plateforme née du secteur dentaire, pensée pour lui")}</h1>
          <p className="help-lead">{t("KolBase met en relation les chirurgiens-dentistes et les organisations du secteur (industriels, sociétés savantes, associations, organismes de formation, prestataires) et prend en charge ce qui entoure leurs collaborations : sollicitations, conformité, conventions, hospitalités et déclarations.")}</p>
        </section>

        <section className="public-section pt-0" aria-labelledby="fondateur">
          <div className="about-founder">
            <figure className="about-photo">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={FOUNDER.photo} alt={FOUNDER.name} width={720} height={900} />
            </figure>
            <div className="about-founder-text">
              <span className="kicker">{t("Le fondateur")}</span>
              <h2 id="fondateur">{FOUNDER.name}</h2>
              <p className="about-role">{t("Fondateur et CEO de KolBase")}</p>
              <p>{t("Kévin Peyrotte a fondé KolBase après une expérience côté industriel dans le secteur dentaire. Il connaît de l'intérieur le travail des équipes qui organisent congrès, formations et collaborations avec les praticiens, et les règles qui encadrent chacune de ces relations.")}</p>
              <p>{t("Avec KolBase, il réunit au même endroit ce qu'il faut pour trouver le bon praticien, monter la collaboration et en respecter les règles, aussi simplement pour les praticiens que pour les organisations.")}</p>
            </div>
          </div>
        </section>

        <section className="public-section pt-0" aria-labelledby="principes">
          <h2 id="principes" className="section-h2 mb-4">{t("Ce qui nous guide")}</h2>
          <div className="about-principles">
            {principles.map((p) => (
              <article key={p.title} className="help-card">
                <span className="help-icon" aria-hidden><p.icon size={20} /></span>
                <h3>{p.title}</h3>
                <p>{p.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="public-section pt-0">
          <div className="help-contact">
            <div>
              <h2>{t("Une question, un projet de collaboration ?")}</h2>
              <p>{t("Écrivez-nous : nous vous répondons par e-mail.")}</p>
            </div>
            <div className="help-contact-links">
              <a className="btn" href={`mailto:${contact}`}><Mail size={16} aria-hidden /> {contact}</a>
              <Link className="btn secondary" href="/aide">{t("Bien démarrer sur KolBase")}</Link>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
