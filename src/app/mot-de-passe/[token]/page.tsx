import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { ResetPasswordForm } from "@/components/AuthForms";
import { findToken } from "@/lib/tokens";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: `${t("Nouveau mot de passe")} — KolBase`, robots: { index: false } };
}

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [found, { t }] = await Promise.all([findToken(token, "RESET_PASSWORD"), getT()]);
  return (
    <>
      <SiteHeader variant="public" />
      <main className="narrow">
        {found ? (
          <ResetPasswordForm token={token} email={found.user.email} />
        ) : (
          <section className="card form">
            <h1>{t("Lien expiré")}</h1>
            <p className="muted">{t("Ce lien de réinitialisation n'est plus valable : il sert une seule fois et expire au bout d'une heure.")}</p>
            <Link className="btn" href="/mot-de-passe-oublie">{t("Demander un nouveau lien")}</Link>
          </section>
        )}
      </main>
    </>
  );
}
