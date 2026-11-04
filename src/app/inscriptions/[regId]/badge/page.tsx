import Link from "next/link";
import { notFound } from "next/navigation";
import { Check } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { checkinUrl, ensureCheckinCode, qrSvg } from "@/lib/checkin";
import { eventEnded, TZ } from "@/lib/events";
import { intlLocale } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: `${t("Mon badge d'accueil")} — KolBase`, robots: { index: false } };
}

/** Badge du participant : un QR code à présenter à l'accueil, qui ouvre sa fiche de pointage chez l'organisateur. */
export default async function Page({ params }: { params: Promise<{ regId: string }> }) {
  const { regId } = await params;
  const user = await requireUser();
  const { t, locale } = await getT();
  const reg = await db.registration.findFirst({
    where: { id: regId, userId: user.id, cancelledAt: null },
    include: { event: { select: { id: true, title: true, startsAt: true, durationMinutes: true, venue: true, city: true, format: true, organization: { select: { name: true } } } } },
  });
  if (!reg) notFound();
  const code = await ensureCheckinCode(reg.id);
  if (!code) notFound();
  const svg = await qrSvg(checkinUrl(code));
  // Événement terminé : le badge n'est plus à présenter (ni QR code, ni consigne d'accueil).
  const ended = eventEnded(reg.event);
  const when = reg.event.startsAt.toLocaleString(intlLocale(locale), { timeZone: TZ, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

  return (
    <>
      <SiteHeader />
      <main className="narrow stack">
        <p className="muted"><Link href="/inscriptions">← {t("Mes inscriptions")}</Link></p>
        <section className="card badge-card">
          <span className="eyebrow-sm">{reg.event.organization.name}</span>
          <h1>{reg.event.title}</h1>
          <p className="muted">{when}{reg.event.venue ? ` · ${reg.event.venue}` : reg.event.city ? ` · ${reg.event.city}` : ""}</p>
          {/* SVG produit par la bibliothèque qrcode à partir d'une URL de KolBase. */}
          {!ended && <div className="badge-qr" role="img" aria-label={t("QR code de votre badge")} dangerouslySetInnerHTML={{ __html: svg }} />}
          <strong className="badge-name">{user.firstName} {user.lastName}</strong>
          {reg.checkedInAt ? (
            <p className="pill ok"><Check size={12} /> {t("Présence enregistrée à {time}", { time: reg.checkedInAt.toLocaleTimeString(intlLocale(locale), { timeZone: TZ, hour: "2-digit", minute: "2-digit" }) })}</p>
          ) : ended ? (
            <p className="muted text-sm">{t("Événement terminé : ce badge n'est plus à présenter.")}</p>
          ) : (
            <p className="muted text-sm">{t("Présentez ce code à l'accueil : l'organisateur le scanne pour enregistrer votre arrivée.")}</p>
          )}
        </section>
      </main>
    </>
  );
}
