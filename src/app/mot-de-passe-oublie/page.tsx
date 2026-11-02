import { SiteHeader } from "@/components/SiteHeader";
import { ForgotPasswordForm } from "@/components/AuthForms";

export const metadata = { title: "Mot de passe oublié — KolBase" };

export default function Page() {
  return (
    <>
      <SiteHeader variant="public" />
      <main className="narrow"><ForgotPasswordForm /></main>
    </>
  );
}
