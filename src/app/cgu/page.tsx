import { LegalPage } from "@/components/LegalPage";

export const metadata = { title: "Conditions d'utilisation — Kolbase" };

export default function Page() {
  return (
    <LegalPage
      title="Conditions générales d'utilisation"
      updated="octobre 2026"
      sections={[
        ["Objet", <p key="o">Les présentes conditions encadrent l&apos;utilisation de Kolbase par les professionnels de santé et les organisations du secteur dentaire.</p>],
        ["Comptes", <p key="c">Chaque compte est personnel. L&apos;utilisateur garantit l&apos;exactitude des informations fournies, notamment sa profession et son numéro RPPS, et préserve la confidentialité de ses identifiants.</p>],
        ["Praticiens référencés", <p key="p">Le référencement comme expert est volontaire et révocable. Le praticien s&apos;engage à déclarer ses liens d&apos;intérêts et à ne pas accepter d&apos;avantage en dehors du cadre conventionnel.</p>],
        ["Organisations", <p key="org">Les organisations restent seules responsables du respect de leurs obligations réglementaires : conventionnement, déclaration ou autorisation ordinale, publication sur Transparence Santé, juste contrepartie. Les outils de Kolbase (contrôle de juste contrepartie, modèles de convention, exports) sont des aides et ne valent pas conseil juridique.</p>],
        ["Contenus et messages", <p key="m">Les utilisateurs s&apos;interdisent tout contenu illicite, promotionnel non conforme ou contraire à la déontologie. Kolbase peut suspendre un compte en cas de manquement.</p>],
        ["Responsabilité", <p key="r">Kolbase fournit un service de mise en relation et de gestion. Il n&apos;est pas partie aux conventions conclues entre utilisateurs.</p>],
        ["Droit applicable", <p key="d">Droit français. [Juridiction compétente et modalités de modification des CGU à compléter.]</p>],
      ]}
    />
  );
}
