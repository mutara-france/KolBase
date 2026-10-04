import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { ApplyForm } from "@/components/OpportunityForms";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { formatDate, formatEUR } from "@/lib/events";
import { collabType } from "@/lib/projects";
import { withdrawApplication } from "@/lib/opportunity-actions";

export const metadata = { title: "Opportunité — Kolbase" };

const APP_STATUS: Record<string, string> = {
  pending: "Votre candidature est en cours d'examen.",
  retained: "Votre candidature a été retenue : retrouvez le dossier dans « Sollicitations ».",
  rejected: "Votre candidature n'a pas été retenue.",
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

  return (
    <>
      <SiteHeader />
      <main className="narrow stack">
        <p className="muted"><Link href="/opportunites">Opportunités</Link></p>
        <div>
          <span className="tag">{type?.label ?? call.typeId}</span>
          <h1>{call.title}</h1>
          <p className="muted">{call.organization.name}</p>
        </div>
        <section className="card">
          <dl className="facts">
            {call.specialty && (<><dt>Spécialité</dt><dd>{call.specialty}</dd></>)}
            {(call.budgetMinCents != null || call.budgetMaxCents != null) && (
              <><dt>Budget</dt><dd>{[call.budgetMinCents, call.budgetMaxCents].filter((x) => x != null).map((x) => formatEUR(x!)).join(" – ")} HT</dd></>
            )}
            {type && (<><dt>Référence de marché</dt><dd>{type.fmv[0].toLocaleString("fr-FR")} à {type.fmv[1].toLocaleString("fr-FR")} € HT par {type.unit}</dd></>)}
            <dt>Date limite</dt><dd>{call.deadline ? formatDate(call.deadline) : "Aucune"}</dd>
          </dl>
        </section>
        {call.description && <section className="card"><h2>Description</h2><p>{call.description}</p></section>}
        {call.organization.policy && <section className="card"><h2>Politique de collaboration de {call.organization.name}</h2><p>{call.organization.policy}</p></section>}
        <section className="card highlight">
          <h2>Candidature</h2>
          {mine ? (
            <>
              <p className={`notice ${mine.status === "rejected" ? "error" : "ok"}`}>{APP_STATUS[mine.status]}</p>
              {mine.message && <p className="muted">« {mine.message} »</p>}
              {mine.status === "pending" && !closed && (
                <form action={withdrawApplication}><input type="hidden" name="callId" value={id} /><button className="btn ghost">Retirer ma candidature</button></form>
              )}
            </>
          ) : closed ? (
            <p className="muted">Cet appel est clôturé.</p>
          ) : (
            <ApplyForm callId={id} />
          )}
        </section>
      </main>
    </>
  );
}
