import Link from "next/link";
import type { ApplicationStatus } from "@/generated/prisma/client";
import { notFound } from "next/navigation";
import { CalendarDays, Euro, Inbox, Mic, UserCheck } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { PageHero } from "@/components/PageHero";
import { RetainForm } from "@/components/OpportunityForms";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/orgs";
import { formatDate, formatEUR } from "@/lib/events";
import { collabType, SOURCING_ROLES } from "@/lib/projects";
import { rejectApplication, setOpenCallStatus } from "@/lib/opportunity-actions";

export const metadata = { title: "Appel à candidatures — KolBase" };

const APP_STATUS: Record<ApplicationStatus, string> = { pending: "À traiter", retained: "Retenue", rejected: "Non retenue", declined: "Honoraires déclinés" };

export default async function Page({ params }: { params: Promise<{ id: string; callId: string }> }) {
  const { id, callId } = await params;
  const { org } = await requireMembership(id, SOURCING_ROLES);
  const call = await db.openCall.findFirst({
    where: { id: callId, organizationId: id },
    include: {
      event: { select: { id: true, title: true, startsAt: true, city: true } },
      applications: {
        include: { practitioner: { include: { user: { select: { firstName: true, lastName: true } } } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!call) notFound();
  const type = collabType(call.typeId);
  const budget = [call.budgetMinCents, call.budgetMaxCents].map((c) => (c != null ? formatEUR(c) : null));

  const pendingCount = call.applications.filter((a) => a.status === "pending").length;
  const retained = call.applications.filter((a) => a.status === "retained").length;
  // Places toutes pourvues : l'appel ne reçoit plus de candidature, même s'il n'est pas clôturé.
  const full = call.slots != null && retained >= call.slots;

  return (
    <>
      <SiteHeader />
      <main className="stack">
        <p className="muted"><Link href={`/organisations/${id}`}>{org.name}</Link> / <Link href={`/organisations/${id}/opportunites`}>Appels à candidatures</Link></p>
        <PageHero
          eyebrow={`Appel à candidatures · ${type?.label ?? call.typeId}${call.specialty ? ` · ${call.specialty}` : ""}`}
          status={<span className={`pill ${call.status !== "open" ? "done" : full ? "bad" : "ok"}`}>{call.status !== "open" ? "Clôturé" : full ? "Complet" : "Ouvert"}</span>}
          title={call.title}
          lead={call.description}
          facts={[
            { icon: <Inbox size={13} />, label: "Candidatures", value: String(call.applications.length), sub: pendingCount ? `${pendingCount} à traiter` : "aucune en attente" },
            { icon: <UserCheck size={13} />, label: "Retenues", value: call.slots ? `${retained} / ${call.slots}` : String(retained), sub: call.slots ? (retained >= call.slots ? "toutes les places sont pourvues" : `${call.slots - retained} place${call.slots - retained > 1 ? "s" : ""} à pourvoir`) : retained ? "dossiers ouverts" : "personne pour l'instant" },
            ...(call.event ? [{ icon: <Mic size={13} />, label: "Événement", value: formatDate(call.event.startsAt), sub: call.event.title }] : []),
            { icon: <Euro size={13} />, label: "Budget", value: budget[0] || budget[1] ? `${budget.filter(Boolean).join(" – ")} HT` : "Non précisé", sub: type ? `repère : ${type.fmv[0]}–${type.fmv[1]} € par ${type.unit}` : undefined },
            { icon: <CalendarDays size={13} />, label: "Date limite", value: call.deadline ? formatDate(call.deadline) : "Aucune" },
          ]}
        />
        <div className="page-grid">
          <div className="page-main">
        <section className="card">
          <h2>Candidatures ({call.applications.length})</h2>
          {call.applications.length === 0 && <p className="muted">Aucune candidature pour l&apos;instant.</p>}
          <ul className="applications">
            {call.applications.map((a) => (
              <li key={a.id}>
                <div className="actions spread">
                  <strong><Link href={`/annuaire/${a.practitionerId}`}>Dr {a.practitioner.user.firstName} {a.practitioner.user.lastName}</Link></strong>
                  <span className={`pill ${a.status === "retained" ? "ok" : ["rejected", "declined"].includes(a.status) ? "done" : "wait"}`}>{APP_STATUS[a.status]}</span>
                </div>
                <span className="muted">{[a.practitioner.specialty || a.practitioner.profession, a.practitioner.city].filter(Boolean).join(" · ")} · le {formatDate(a.createdAt)}</span>
                {a.message && <p>{a.message}</p>}
                {a.status === "pending" && (
                  <div className="actions">
                    {call.slots != null && retained >= call.slots ? <span className="muted text-sm">Places pourvues</span> : <RetainForm
                      orgId={id}
                      applicationId={a.id}
                      unit={type?.unit ?? "unité"}
                      defaultFee={call.budgetMaxCents != null ? String(call.budgetMaxCents / 100) : a.practitioner.dayRateCents != null ? String(a.practitioner.dayRateCents / 100) : ""}
                    />}
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
          </div>
          <aside className="page-aside">
            <section className="card next-step">
              <span className="eyebrow-sm">Pilotage</span>
              <p className="next-hint">{call.status !== "open" ? "Appel clôturé : il n'est plus visible des experts." : full ? "Complet : toutes les places sont pourvues, l'appel ne reçoit plus de candidature." : "Les experts référencés voient l'appel dans « Appels à candidatures »" + (call.event ? " et sur la page de l'événement" : "") + ". Retenir une candidature ouvre un dossier et propose des honoraires à l'expert ; le dossier avance après son accord."}</p>
              <form action={setOpenCallStatus} className="transitions-stack">
                <input type="hidden" name="orgId" value={id} />
                <input type="hidden" name="callId" value={callId} />
                <input type="hidden" name="status" value={call.status === "open" ? "closed" : "open"} />
                <button className="btn ghost">{call.status === "open" ? "Clôturer l'appel" : "Rouvrir l'appel"}</button>
              </form>
            </section>
            {call.event && (
              <section className="card stack-sm">
                <h2 className="section-title">Événement</h2>
                <Link href={`/organisations/${id}/evenements/${call.event.id}`}><strong>{call.event.title}</strong></Link>
                <span className="muted text-sm">{formatDate(call.event.startsAt)}{call.event.city ? ` · ${call.event.city}` : ""}</span>
                <p className="hint">Les personnes retenues interviennent à cet événement ; leur dossier précise l&apos;intervention.</p>
              </section>
            )}
          </aside>
        </div>
      </main>
    </>
  );
}
