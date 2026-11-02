import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { ResetPasswordForm } from "@/components/AuthForms";
import { findToken } from "@/lib/tokens";

export const metadata = { title: "Nouveau mot de passe — KolBase", robots: { index: false } };

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await findToken(token, "RESET_PASSWORD");
  return (
    <>
      <SiteHeader variant="public" />
      <main className="narrow">
        {t ? (
          <ResetPasswordForm token={token} email={t.user.email} />
        ) : (
          <section className="card form">
            <h1>Lien expiré</h1>
            <p className="muted">Ce lien de réinitialisation n&apos;est plus valable : il sert une seule fois et expire au bout d&apos;une heure.</p>
            <Link className="btn" href="/mot-de-passe-oublie">Demander un nouveau lien</Link>
          </section>
        )}
      </main>
    </>
  );
}
