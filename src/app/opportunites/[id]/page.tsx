import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { ApplyForm } from "@/components/OpportunityForms";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { collabType } from "@/lib/projects";
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
  if (!user.practitioner?.listed) redirect("/compte?annuaire=1");
  const call = await db.openCall.findUnique({
    where: { id },
    include: { organization: true, applications: { where: { practitionerId: user.practitioner.id } } },
  });
  if (!call) notFound();
  const mine = call.applications[0];
  const type = collabType(call.typeId);
  const closed = call.status !== "open" || (call.deadline != null && call.deadline < new Date());
  const { t, locale } = await getT();
  const num = (n: number) => n.toLocaleString(intlLocale(locale));

  return (
    <>
      <SiteHeader />
      <main className="narrow stack">
        <p className="muted"><Link href="/opportunites">{t("Opportunités")}</Link></p>
        <div>
          <span className="tag">{type ? t(type.label) : call.typeId}</span>
          <h1>{call.title}</h1>
          <p className="muted">{call.organization.name}</p>
        </div>
        <section className="card">
          <dl className="facts">
            {call.specialty && (<><dt>{t("Spécialité")}</dt><dd>{call.specialty}</dd></>)}
            {(call.budgetMinCents != null || call.budgetMaxCents != null) && (
              <><dt>{t("Budget")}</dt><dd>{t("{amount} HT", { amount: [call.budgetMinCents, call.budgetMaxCents].filter((x) => x != null).map((x) => fmtEur(locale, x!)).join(" – ") })}</dd></>
            )}
            {type && (<><dt>{t("Référence de marché")}</dt><dd>{t("{min} à {max} € HT par {unit}", { min: num(type.fmv[0]), max: num(type.fmv[1]), unit: t(type.unit) })}</dd></>)}
            <dt>{t("Date limite")}</dt><dd>{call.deadline ? fmtDate(locale, call.deadline) : t("Aucune")}</dd>
          </dl>
        </section>
        {call.description && <section className="card"><h2>{t("Description")}</h2><p>{call.description}</p></section>}
        {call.organization.policy && <section className="card"><h2>{t("Politique de collaboration de {org}", { org: call.organization.name })}</h2><p>{call.organization.policy}</p></section>}
        <section className="card highlight">
          <h2>{t("Candidature")}</h2>
          {mine ? (
            <>
              <p className={`notice ${mine.status === "rejected" ? "error" : "ok"}`}>{t(APP_STATUS[mine.status])}</p>
              {mine.message && <p className="muted">« {mine.message} »</p>}
              {mine.status === "pending" && !closed && (
                <form action={withdrawApplication}><input type="hidden" name="callId" value={id} /><button className="btn ghost">{t("Retirer ma candidature")}</button></form>
              )}
            </>
          ) : closed ? (
            <p className="muted">{t("Cet appel est clôturé.")}</p>
          ) : (
            <ApplyForm callId={id} />
          )}
        </section>
      </main>
    </>
  );
}
