import { notFound } from "next/navigation";
import { BadgeCheck } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { validCertificateCode } from "@/lib/event-followup";
import { TZ } from "@/lib/events";
import { intlLocale } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: `${t("Vérification d'une attestation")} — KolBase`, robots: { index: false, follow: false } };
}

/** Vérification publique d'une attestation de présence (QR code imprimé sur le document). */
export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (!validCertificateCode(code)) notFound();
  const [user, { t, locale }] = await Promise.all([getCurrentUser(), getT()]);
  const reg = await db.registration.findUnique({
    where: { certificateCode: code },
    include: { user: { select: { firstName: true, lastName: true } }, event: { select: { title: true, startsAt: true, organization: { select: { name: true } } } } },
  });
  if (!reg?.checkedInAt) notFound();
  const day = reg.event.startsAt.toLocaleDateString(intlLocale(locale), { timeZone: TZ, day: "numeric", month: "long", year: "numeric" });
  return (
    <>
      <SiteHeader variant={user ? "app" : "public"} />
      <main className={`narrow stack${user ? "" : " landing"}`}>
        <section className="card stack-sm verify-card">
          <p className="pill ok"><BadgeCheck size={14} /> {t("Attestation authentique")}</p>
          <h1>{reg.user.firstName} {reg.user.lastName}</h1>
          <p>{t("a participé à « {title} », organisé par {org}, le {date}.", { title: reg.event.title, org: reg.event.organization.name, date: day })}</p>
          <p className="muted text-sm">{t("Présence enregistrée à l'accueil de l'événement. Code de vérification : {code}.", { code })}</p>
        </section>
      </main>
    </>
  );
}
