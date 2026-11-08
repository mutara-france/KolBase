import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { ReportForm } from "@/components/ModerationForms";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isReportTarget, REPORT_TARGETS, targetHref } from "@/lib/moderation";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: `${t("Signaler un contenu")} — KolBase`, robots: { index: false } };
}

/** Signalement d'un contenu public (profil, page d'organisation, événement, avis), examiné par l'équipe KolBase. */
export default async function Page({ searchParams }: { searchParams: Promise<{ type?: string; id?: string }> }) {
  const { type = "", id = "" } = await searchParams;
  if (!isReportTarget(type) || !id) notFound();
  const [user, { t }] = await Promise.all([getCurrentUser(), getT()]);
  const target =
    type === "expert" ? await db.practitionerProfile.findFirst({ where: { id, listed: true }, select: { user: { select: { firstName: true, lastName: true } } } }).then((p) => (p ? { label: `${p.user.firstName} ${p.user.lastName}`, href: targetHref(type, id) } : null))
    : type === "organisation" ? await db.organization.findFirst({ where: { id, verification: "VERIFIED" }, select: { name: true } }).then((o) => (o ? { label: o.name, href: targetHref(type, id) } : null))
    : type === "evenement" ? await db.event.findFirst({ where: { id, publishedAt: { not: null } }, select: { title: true } }).then((e) => (e ? { label: e.title, href: targetHref(type, id) } : null))
    : await db.supplierReview.findFirst({ where: { id, hiddenAt: null }, select: { supplierId: true, supplier: { select: { name: true } } } }).then((r) => (r ? { label: t("Avis sur {name}", { name: r.supplier.name }), href: targetHref(type, id, { supplierId: r.supplierId }) } : null));
  if (!target) notFound();
  return (
    <>
      <SiteHeader variant={user ? "app" : "public"} />
      <main className={`narrow stack${user ? "" : " landing"}`}>
        {target.href && <p className="muted"><Link href={target.href}>← {target.label}</Link></p>}
        <div>
          <h1>{t("Signaler un contenu")}</h1>
          <p className="muted">{t("{kind} : « {label} ». L'équipe KolBase examine chaque signalement, retire le contenu si nécessaire et communique sa décision motivée à l'auteur du signalement et à celui du contenu.", { kind: t(REPORT_TARGETS[type]), label: target.label })}</p>
        </div>
        <section className="card">
          <ReportForm type={type} id={id} needEmail={!user} />
        </section>
      </main>
    </>
  );
}
