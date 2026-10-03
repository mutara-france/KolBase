import { SiteHeader } from "@/components/SiteHeader";
import { NewOrgForm } from "@/components/OrgForms";
import { requireUser } from "@/lib/auth";
import { ORG_KIND_LABEL } from "@/lib/orgs";

export const metadata = { title: "Créer une organisation — Kolbase" };

export default async function Page() {
  await requireUser();
  const kinds = Object.entries(ORG_KIND_LABEL).map(([value, label]) => ({ value, label }));
  return (
    <>
      <SiteHeader />
      <main className="narrow"><NewOrgForm kinds={kinds} /></main>
    </>
  );
}
