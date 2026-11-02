import { SiteHeader } from "@/components/SiteHeader";
import { ForgotPasswordForm } from "@/components/AuthForms";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: `${t("Mot de passe oublié")} — KolBase` };
}

export default function Page() {
  return (
    <>
      <SiteHeader variant="public" />
      <main className="narrow"><ForgotPasswordForm /></main>
    </>
  );
}
