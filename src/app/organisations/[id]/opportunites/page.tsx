import Link from "next/link";
import { aiEnabled } from "@/lib/ai";
import { SiteHeader } from "@/components/SiteHeader";
import { SectionNav } from "@/components/SectionNav";
import { orgTabs } from "@/lib/org-overview";
import { NewCallForm } from "@/components/OpportunityForms";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/orgs";
import { formatDate } from "@/lib/events";
import { BillingNotice } from "@/components/BillingNotice";
import { engagementBlock } from "@/lib/billing";
import { COLLAB_TYPES, collabType, SOURCING_ROLES } from "@/lib/projects";

export const metadata = { title: "Appels à candidatures — KolBase" };

const DAY = (d: Date) => d.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", day: "numeric" });
const MONTH = (d: Date) => d.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", month: "short" });

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ evenement?: string }> }) {
  const { id } = await params;
  const { evenement } = await searchParams;
  await requireMembership(id, SOURCING_ROLES);
  const now = new Date();
  const [calls, events] = await Promise.all([
    db.openCall.findMany({
      where: { organizationId: id },
      include: { applications: { select: { status: true } }, event: { select: { id: true, title: true, startsAt: true } } },
      orderBy: [{ status: "desc" }, { createdAt: "desc" }],
    }),
    db.event.findMany({ where: { organizationId: id, startsAt: { gte: now } }, orderBy: { startsAt: "asc" }, select: { id: true, title: true, startsAt: true, typeId: true, therapeuticArea: true } }),
  ]);
  const sectionTabs = await orgTabs("praticiens", id);
  return (
    <>
      <SiteHeader />
      <main className="stack">
        <BillingNotice orgId={id} motive="appel" />
        <SectionNav tabs={sectionTabs} active="appels" label="Rubrique Praticiens" />
        <div className="actions spread">
          <h1>Appels à candidatures</h1>
          <a className="btn" href="#nouvel-appel">Nouvel appel</a>
        </div>
        <p className="muted">
          Un appel invite les experts référencés à candidater, pour une collaboration (board, étude, rédaction…) ou pour intervenir à l&apos;un de vos
          événements (formation, symposium…). Vous retenez qui vous voulez ; chaque personne retenue reçoit une proposition d&apos;honoraires et un dossier s&apos;ouvre.
        </p>
        {calls.length > 0 && (
          <section className="card row-list">
            {calls.map((c) => {
              const pending = c.applications.filter((a) => a.status === "pending").length;
              const retained = c.applications.filter((a) => a.status === "retained").length;
              const closed = c.status !== "open" || (c.deadline != null && c.deadline < now);
              return (
                <Link key={c.id} href={`/organisations/${id}/opportunites/${c.id}`} className="row-item">
                  {c.event ? (
                    <span className="date-block" aria-hidden><strong>{DAY(c.event.startsAt)}</strong><small>{MONTH(c.event.startsAt)}</small></span>
                  ) : (
                    <span className="date-block muted-block" aria-hidden><small>sans</small><small>événement</small></span>
                  )}
                  <span className="row-main">
                    <strong>{c.title}</strong>
                    <span className="muted text-sm">
                      {collabType(c.typeId)?.label ?? c.typeId}
                      {c.event ? ` · ${c.event.title}` : ""}
                      {c.deadline ? ` · jusqu'au ${formatDate(c.deadline)}` : ""}
                    </span>
                  </span>
                  <span className="row-status">
                    <span className={`pill ${closed ? "done" : c.slots != null && retained >= c.slots ? "bad" : "ok"}`}>{closed ? "Clôturé" : c.slots != null && retained >= c.slots ? "Complet" : "Ouvert"}</span>
                    {pending > 0 && <span className="text-xs warn-text">{pending} candidature{pending > 1 ? "s" : ""} à examiner</span>}
                  </span>
                  <span className="row-figures">
                    <strong>{retained}{c.slots ? ` / ${c.slots}` : ""}</strong>
                    <span className="text-xs muted">retenu{retained > 1 ? "s" : ""} · {c.applications.length} candidature{c.applications.length > 1 ? "s" : ""}</span>
                  </span>
                </Link>
              );
            })}
          </section>
        )}
        <div id="nouvel-appel">
          <NewCallForm
            blocked={await engagementBlock(id, "appel")}
            orgId={id}
            types={COLLAB_TYPES}
            ai={aiEnabled()}
            events={events.map((e) => ({ id: e.id, label: `${formatDate(e.startsAt)} — ${e.title}`, title: e.title, typeId: e.typeId, area: e.therapeuticArea }))}
            defaultEventId={events.some((e) => e.id === evenement) ? evenement : undefined}
          />
        </div>
      </main>
    </>
  );
}
