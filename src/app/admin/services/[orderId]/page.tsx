import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { NewsletterForm, SocialDraft } from "@/components/ServiceForms";
import { db } from "@/lib/db";
import { requirePlatformAdmin } from "@/lib/platform";
import { aiEnabled } from "@/lib/ai";
import { formatDate, formatEUR, formatTime } from "@/lib/events";
import { updateServiceOrder } from "@/lib/service-actions";
import { newsletterAudienceCount, newsletterSendsThisMonth, trackedPath } from "@/lib/services";
import { NEWSLETTER_MONTHLY_MAX, parisMonthLabel } from "@/lib/newsletter";

export const metadata = { title: "Service — KolBase" };

/** Réalisation d'un service commandé : e-mailing aux membres, ou post pour les réseaux sociaux. */
export default async function Page({ params }: { params: Promise<{ orderId: string }> }) {
  await requirePlatformAdmin();
  const { orderId } = await params;
  const o = await db.serviceOrder.findUnique({ where: { id: orderId }, include: { event: true, organization: { select: { name: true } }, offer: true } });
  if (!o) notFound();
  const [audience, sends] = await Promise.all([newsletterAudienceCount(), newsletterSendsThisMonth()]);
  const e = o.event;
  const where = e.format === "DISTANCIEL" ? "en ligne" : [e.venue, e.city].filter(Boolean).join(", ");
  const defaultBody = `${o.organization.name} organise « ${e.title} », le ${formatDate(e.startsAt)} à ${formatTime(e.startsAt)}${where ? `, ${where}` : ""}.\n\n${e.description ?? "[présentation à compléter]"}\n\nInscription gratuite et nominative sur KolBase.`;
  return (
    <>
      <SiteHeader />
      <main className="narrow stack">
        <p className="muted"><Link href="/admin">Administration</Link> › <Link href="/admin/services">Services</Link></p>
        <h1>{o.label}</h1>
        <p className="muted">{o.organization.name} · « <Link href={`/evenements/${e.id}`}>{e.title}</Link> » du {formatDate(e.startsAt)} · {formatEUR(o.priceCents)} HT</p>
        {o.brief && <p className="notice">Consignes : « {o.brief} »</p>}
        {o.offer.kind === "newsletter" ? (
          <NewsletterForm orderId={o.id} advertiser={o.organization.name} subject={`${e.title} — ${formatDate(e.startsAt)}`} body={defaultBody} audience={audience} ai={aiEnabled()} sends={sends} max={NEWSLETTER_MONTHLY_MAX} month={parisMonthLabel()} />
        ) : (
          <section className="card stack-sm">
            <h2>Post à publier</h2>
            <p className="muted">Rédigez le post (l&apos;assistant peut proposer un texte), publiez-le sur les comptes de KolBase en le signalant comme partenariat, puis indiquez son lien.</p>
            {o.trackCode && <p className="notice">Lien d&apos;inscription à mettre dans le post (visites et inscriptions comptées dans le bilan de l&apos;organisateur) : <code>{process.env.APP_URL ?? "http://localhost:3000"}{trackedPath(o.trackCode)}</code></p>}
            {aiEnabled() && <SocialDraft orderId={o.id} />}
            {["demandee", "planifiee"].includes(o.status) && (
              <form action={updateServiceOrder} className="form">
                <input type="hidden" name="orderId" value={o.id} />
                <input type="hidden" name="action" value="done" />
                <label>Lien du post publié<input name="resultUrl" type="url" placeholder="https://www.linkedin.com/…" /></label>
                <button className="btn">Marquer réalisé et facturer</button>
              </form>
            )}
          </section>
        )}
      </main>
    </>
  );
}
