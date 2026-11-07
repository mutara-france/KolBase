import { SectionHead } from "@/components/UI";
import Link from "next/link";
import { de } from "@/lib/elision";
import { notFound, redirect } from "next/navigation";
import { Briefcase, CalendarDays, Euro, Mic, ScrollText, Users } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { PageHero } from "@/components/PageHero";
import { ApplyForm } from "@/components/OpportunityForms";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { collabType } from "@/lib/projects";
import { orgIsPublic } from "@/lib/org-roles";
import { withdrawApplication } from "@/lib/opportunity-actions";
import type { ApplicationStatus } from "@/generated/prisma/client";
import { fmtDate, fmtEur, intlLocale } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: `${t("Opportunité")} — KolBase` };
}

const APP_STATUS: Record<ApplicationStatus, string> = {
  pending: "Votre candidature est en cours d'examen.",
  retained: "Votre candidature a été retenue : l'organisation vous propose des honoraires, à accepter ou décliner dans « Sollicitations ».",
  rejected: "Votre candidature n'a pas été retenue.",
  declined: "Vous avez décliné la proposition d'honoraires.",
};

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  if (!user.practitioner?.listed) redirect("/compte?candidater=1#referencement");
  const call = await db.openCall.findUnique({
    where: { id },
    include: {
      organization: true, event: true,
      applications: { where: { practitionerId: user.practitioner.id } },
      _count: { select: { applications: { where: { status: "retained" } } } },
    },
  });
  if (!call) notFound();
  const mine = call.applications[0];
  const type = collabType(call.typeId);
  const full = call.slots != null && call._count.applications >= call.slots;
  // Organisation suspendue (ou plus validée) : l'appel est masqué, il ne reçoit plus de candidature.
  const closed = call.status !== "open" || call.organization.verification !== "VERIFIED" || (call.deadline != null && call.deadline < new Date()) || (call.event != null && call.event.startsAt < new Date()) || full;
  const { t, locale } = await getT();
  const num = (n: number) => n.toLocaleString(intlLocale(locale));

  const budget = [call.budgetMinCents, call.budgetMaxCents].filter((x) => x != null).map((x) => fmtEur(locale, x!)).join(" – ");

  return (
    <>
      <SiteHeader />
      <main className="stack">
        <p className="muted"><Link href="/opportunites">{t("Opportunités")}</Link></p>
        <PageHero
          eyebrow={`${t("Opportunité")} · ${call.organization.name}`}
          status={<span className={`pill ${full ? "bad" : closed ? "done" : "ok"}`}>{full ? t("Complet") : closed ? t("Clôturé") : t("Ouvert")}</span>}
          title={call.title}
          lead={call.description}
          facts={[
            { icon: <Briefcase size={13} />, label: t("Collaboration"), value: type ? t(type.label) : call.typeId, sub: call.specialty ?? undefined },
            { icon: <Euro size={13} />, label: t("Budget"), value: budget ? t("{amount} HT", { amount: budget }) : t("À discuter"), sub: type ? t("repère : {min} à {max} € HT par {unit}", { min: num(type.fmv[0]), max: num(type.fmv[1]), unit: t(type.unit) }) : undefined },
            ...(call.event ? [{ icon: <Mic size={13} />, label: t("Intervention"), value: fmtDate(locale, call.event.startsAt), sub: [call.event.title, call.event.city].filter(Boolean).join(" · ") }] : []),
            ...(call.slots ? [{ icon: <Users size={13} />, label: t("Places"), value: t("{n} sur {total}", { n: Math.max(0, call.slots - call._count.applications), total: call.slots }), sub: t("encore disponibles") }] : []),
            { icon: <CalendarDays size={13} />, label: t("Date limite"), value: call.deadline ? fmtDate(locale, call.deadline) : t("Aucune") },
          ]}
        />
        <div className="page-grid">
          <div className="page-main">
            {call.event && (
              <section className="card stack-sm">
                <SectionHead icon={CalendarDays} title={t("L'événement")} />
                <p><strong>{call.event.title}</strong></p>
                <p className="muted text-sm">{fmtDate(locale, call.event.startsAt, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}{call.event.city ? ` · ${call.event.city}` : ""}</p>
                {call.event.publishedAt && <Link className="link" href={`/evenements/${call.event.id}`}>{t("Voir la page de l'événement")}</Link>}
              </section>
            )}
            {call.organization.policy && <section className="card"><SectionHead icon={ScrollText} title={t("Politique de collaboration {de_org}", { org: call.organization.name, de_org: de(call.organization.name) })} /><p>{call.organization.policy}</p></section>}
            <section className="card stack-sm">
              <h2 className="section-title">{call.organization.name}</h2>
              {call.organization.about && <p className="text-sm">{call.organization.about}</p>}
              {orgIsPublic(call.organization) && <Link className="link" href={`/structures/${call.organizationId}`}>{t("Voir la page de l'organisation")}</Link>}
            </section>
            <p className="hint">{t("Si votre candidature est retenue, un dossier de collaboration s'ouvre et l'organisation vous propose des honoraires ; il avance après votre accord, jusqu'à la convention.")}</p>
          </div>
          <aside className="page-aside">
            <section className="card next-step">
              <span className="eyebrow-sm">{t("Candidature")}</span>
              {mine ? (
                <>
                  <p className={`notice ${mine.status === "rejected" ? "error" : "ok"}`}>{t(APP_STATUS[mine.status])}</p>
                  {mine.message && <p className="muted">« {mine.message} »</p>}
                  {mine.status === "pending" && !closed && (
                    <form action={withdrawApplication}><input type="hidden" name="callId" value={id} /><button className="btn ghost">{t("Retirer ma candidature")}</button></form>
                  )}
                </>
              ) : closed ? (
                <p className="muted">{full ? t("Toutes les places sont pourvues.") : t("Cette opportunité est clôturée.")}</p>
              ) : (
                <ApplyForm callId={id} />
              )}
            </section>
          </aside>
        </div>
      </main>
    </>
  );
}
