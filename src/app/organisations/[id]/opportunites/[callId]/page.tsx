import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { RetainForm } from "@/components/OpportunityForms";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/orgs";
import { formatDate, formatEUR } from "@/lib/events";
import { collabType, PROJECT_ROLES } from "@/lib/projects";
import { rejectApplication, setOpenCallStatus } from "@/lib/opportunity-actions";

export const metadata = { title: "Opportunité — Kolbase" };

const APP_STATUS: Record<string, string> = { pending: "À traiter", retained: "Retenue", rejected: "Non retenue" };

export default async function Page({ params }: { params: Promise<{ id: string; callId: string }> }) {
  const { id, callId } = await params;
  const { org } = await requireMembership(id, PROJECT_ROLES);
  const call = await db.openCall.findFirst({
    where: { id: callId, organizationId: id },
    include: {
      applications: {
        include: { practitioner: { include: { user: { select: { firstName: true, lastName: true } } } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!call) notFound();
  const type = collabType(call.typeId);
  const budget = [call.budgetMinCents, call.budgetMaxCents].map((c) => (c != null ? formatEUR(c) : null));

  return (
    <>
      <SiteHeader />
      <main className="stack">
        <p className="muted"><Link href={`/organisations/${id}`}>{org.name}</Link> / <Link href={`/organisations/${id}/opportunites`}>Opportunités</Link></p>
        <div className="actions spread">
          <div>
            <span className={`pill ${call.status === "open" ? "ok" : "done"}`}>{call.status === "open" ? "Ouverte" : "Clôturée"}</span>
            <h1>{call.title}</h1>
            <p className="muted">
              {type?.label ?? call.typeId}{call.specialty ? ` · ${call.specialty}` : ""}
              {budget[0] || budget[1] ? ` · budget ${budget.filter(Boolean).join(" – ")} HT` : ""}
              {call.deadline ? ` · jusqu'au ${formatDate(call.deadline)}` : ""}
            </p>
          </div>
          <form action={setOpenCallStatus}>
            <input type="hidden" name="orgId" value={id} />
            <input type="hidden" name="callId" value={callId} />
            <input type="hidden" name="status" value={call.status === "open" ? "closed" : "open"} />
            <button className="btn ghost">{call.status === "open" ? "Clôturer" : "Rouvrir"}</button>
          </form>
        </div>
        {call.description && <section className="card"><h2>Description</h2><p>{call.description}</p></section>}
        <section className="card">
          <h2>Candidatures ({call.applications.length})</h2>
          {call.applications.length === 0 && <p className="muted">Aucune candidature pour l&apos;instant.</p>}
          <ul className="applications">
            {call.applications.map((a) => (
              <li key={a.id}>
                <div className="actions spread">
                  <strong><Link href={`/annuaire/${a.practitionerId}`}>Dr {a.practitioner.user.firstName} {a.practitioner.user.lastName}</Link></strong>
                  <span className={`pill ${a.status === "retained" ? "ok" : a.status === "rejected" ? "done" : "wait"}`}>{APP_STATUS[a.status]}</span>
                </div>
                <span className="muted">{[a.practitioner.specialty || a.practitioner.profession, a.practitioner.city].filter(Boolean).join(" · ")} · le {formatDate(a.createdAt)}</span>
                {a.message && <p>{a.message}</p>}
                {a.status === "pending" && (
                  <div className="actions">
                    <RetainForm
                      orgId={id}
                      applicationId={a.id}
                      unit={type?.unit ?? "unité"}
                      defaultFee={call.budgetMaxCents != null ? String(call.budgetMaxCents / 100) : a.practitioner.dayRateCents != null ? String(a.practitioner.dayRateCents / 100) : ""}
                    />
                    <form action={rejectApplication}>
                      <input type="hidden" name="orgId" value={id} />
                      <input type="hidden" name="applicationId" value={a.id} />
                      <button className="link danger">Ne pas retenir</button>
                    </form>
                  </div>
                )}
                {a.projectId && <Link href={`/organisations/${id}/dossiers/${a.projectId}`}>Voir le dossier</Link>}
              </li>
            ))}
          </ul>
        </section>
      </main>
    </>
  );
}
