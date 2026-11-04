import { SiteHeader } from "@/components/SiteHeader";
import { NewOrgForm } from "@/components/OrgForms";
import { requireUser } from "@/lib/auth";
import { ORG_KIND_LABEL } from "@/lib/orgs";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: `${t("Créer une organisation")} — KolBase` };
}

/** Création d'une organisation : page traduite (l'espace organisation reste en français, sa navigation exceptée). */
export default async function Page() {
  await requireUser();
  const { t } = await getT();
  const kinds = Object.entries(ORG_KIND_LABEL).map(([value, label]) => ({ value, label: t(label) }));
  return (
    <>
      <SiteHeader />
      <main className="narrow"><NewOrgForm kinds={kinds} /></main>
    </>
  );
}
