import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { NewsletterForm } from "@/components/ServiceForms";
import { requirePlatformAdmin } from "@/lib/platform";
import { newsletterAudienceCount, newsletterSendsThisMonth } from "@/lib/services";
import { NEWSLETTER_MONTHLY_MAX, parisMonthLabel } from "@/lib/newsletter";

export const metadata = { title: "Lettre d'information — KolBase" };

/** Lettre d'information de KolBase (actualités de la plateforme), hors commande d'un organisateur. */
export default async function Page() {
  await requirePlatformAdmin();
  const [audience, sends] = await Promise.all([newsletterAudienceCount(), newsletterSendsThisMonth()]);
  return (
    <>
      <SiteHeader />
      <main className="narrow stack">
        <p className="muted"><Link href="/admin">Administration</Link> › <Link href="/admin/services">Services</Link></p>
        <h1>Lettre d&apos;information</h1>
        <p className="muted">Les nouvelles de la plateforme et les événements à venir, pour les praticiens abonnés. Vérifiez l&apos;aperçu et envoyez-vous un test avant l&apos;envoi.</p>
        <NewsletterForm subject="Les nouvelles de KolBase" body="" audience={audience} ai={false} sends={sends} max={NEWSLETTER_MONTHLY_MAX} month={parisMonthLabel()} />
      </main>
    </>
  );
}
