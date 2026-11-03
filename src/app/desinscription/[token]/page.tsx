import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { db } from "@/lib/db";
import { unsubscribe } from "@/lib/service-actions";
import { getT } from "@/lib/i18n/server";

export const metadata = { title: "Désinscription — KolBase", robots: { index: false } };

/** Désinscription de la lettre d'information depuis le lien de l'e-mail (sans connexion). */
export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(token)) notFound();
  const u = await db.user.findUnique({ where: { unsubscribeToken: token }, select: { email: true, notifyPrefs: true } });
  if (!u) notFound();
  const { t } = await getT();
  const subscribed = !!(u.notifyPrefs && typeof u.notifyPrefs === "object" && (u.notifyPrefs as Record<string, unknown>).newsletter === true);
  return (
    <>
      <SiteHeader variant="public" />
      <main className="narrow stack landing">
        <section className="card stack-sm">
          <h1>{t("Lettre d'information")}</h1>
          {subscribed ? (
            <>
              <p>{t("Ne plus recevoir la lettre d'information de KolBase à l'adresse {email} ?", { email: u.email })}</p>
              <form action={unsubscribe}><input type="hidden" name="token" value={token} /><button className="btn">{t("Me désinscrire")}</button></form>
            </>
          ) : (
            <p className="notice ok">{t("C'est fait : vous ne recevrez plus la lettre d'information. Vous pouvez vous réinscrire depuis « Mon compte ».")}</p>
          )}
        </section>
      </main>
    </>
  );
}
