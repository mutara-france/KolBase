import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { NewsletterForm } from "@/components/ServiceForms";
import { db } from "@/lib/db";
import { requirePlatformAdmin } from "@/lib/platform";

export const metadata = { title: "Lettre d'information — KolBase" };

/** Lettre d'information de KolBase (actualités de la plateforme), hors commande d'un organisateur. */
export default async function Page() {
  await requirePlatformAdmin();
  const audience = await db.user.count({ where: { notifyPrefs: { path: ["newsletter"], equals: true }, emailVerifiedAt: { not: null } } });
  return (
    <>
      <SiteHeader />
      <main className="narrow stack">
        <p className="muted"><Link href="/admin?onglet=services">Administration › Services</Link></p>
        <h1>Lettre d&apos;information</h1>
        <NewsletterForm subject="Les nouvelles de KolBase" body="" audience={audience} ai={false} />
      </main>
    </>
  );
}
