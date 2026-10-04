import Link from "next/link";
import { Lock, Megaphone, Unlock } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { Avatar } from "@/components/Avatar";
import { OpenSpeakerCallForm, RetainSpeakerForm } from "@/components/SpeakerForms";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/orgs";
import { EVENT_MANAGER_ROLES, eventTypeLabel, formatDate, formatDateTime, formatEUR, TZ } from "@/lib/events";
import { PROJECT_ROLES, PROJECT_VIEW_ROLES } from "@/lib/projects";
import { SPEAKER_STATUS } from "@/lib/suppliers";
import { rejectSpeaker, setSpeakerCallOpen } from "@/lib/speaker-actions";

export const metadata = { title: "Appels à intervenants — Kolbase" };

const isoDate = (d: Date | null) => (d ? d.toLocaleDateString("sv-SE", { timeZone: TZ }) : "");
const eur = (c: number | null) => (c != null ? String(c / 100) : "");

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { org, roles } = await requireMembership(id, [...EVENT_MANAGER_ROLES, ...PROJECT_ROLES]);
  const canManage = roles.some((r) => EVENT_MANAGER_ROLES.includes(r));
  const canSeeProjects = roles.some((r) => PROJECT_VIEW_ROLES.includes(r));
  const now = new Date();

  const upcoming = await db.event.findMany({ where: { organizationId: id, startsAt: { gte: now } }, orderBy: { startsAt: "asc" } });
  const calls = await db.event.findMany({
    where: { organizationId: id, OR: [{ speakerCallOpen: true }, { speakerApplications: { some: {} } }] },
    include: {
      speakerApplications: {
        include: { practitioner: { include: { user: { select: { firstName: true, lastName: true } }, _count: { select: { publications: true } } } } },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { startsAt: "asc" },
  });

  return (
    <>
      <SiteHeader />
      <main className="stack">
        <p className="muted"><Link href={`/organisations/${id}`}>{org.name}</Link> / Appels à intervenants</p>
        <h1>Appels à intervenants</h1>
        <p className="muted">
          Annoncez la session avant d&apos;avoir bouclé le programme. Les experts référencés se déclarent, vous arbitrez, et le dossier de
          collaboration s&apos;ouvre au moment où vous retenez quelqu&apos;un.
        </p>
        {canManage && (
          <OpenSpeakerCallForm
            orgId={id}
            events={upcoming.map((e) => ({
              id: e.id,
              label: `${formatDate(e.startsAt)} — ${e.title}${e.speakerCallOpen ? " (appel ouvert)" : ""}`,
              slots: e.speakerSlots,
              deadline: isoDate(e.speakerDeadline),
              min: eur(e.speakerBudgetMinCents),
              max: eur(e.speakerBudgetMaxCents),
              profile: e.speakerProfile ?? "",
            }))}
          />
        )}

        {calls.length === 0 && (
          <div className="card empty"><Megaphone size={22} /><p className="muted">Aucun appel à intervenants en cours.</p></div>
        )}
        {calls.map((ev) => {
          const retained = ev.speakerApplications.filter((a) => a.status === "retained").length;
          const full = ev.speakerSlots != null && retained >= ev.speakerSlots;
          const mid = ev.speakerBudgetMinCents != null && ev.speakerBudgetMaxCents != null ? (ev.speakerBudgetMinCents + ev.speakerBudgetMaxCents) / 2 : ev.speakerBudgetMaxCents ?? ev.speakerBudgetMinCents;
          return (
            <section key={ev.id} className="card">
              <div className="card-head">
                <div>
                  <div className="eyebrow-sm">{eventTypeLabel(ev.typeId)}{ev.therapeuticArea ? ` · ${ev.therapeuticArea}` : ""} · {formatDateTime(ev.startsAt)}</div>
                  <h2><Link href={`/organisations/${id}/evenements/${ev.id}`}>{ev.title}</Link></h2>
                </div>
                <span className={`pill ${ev.speakerCallOpen ? "ok" : "done"}`}>{ev.speakerCallOpen ? "Appel ouvert" : "Appel clos"}</span>
              </div>
              <div className="kv">
                <div><span>Places d&apos;intervenant</span><span>{retained} pourvue{retained > 1 ? "s" : ""} sur {ev.speakerSlots ?? "—"}</span></div>
                <div><span>Clôture</span><span>{ev.speakerDeadline ? formatDate(ev.speakerDeadline) : "—"}</span></div>
                <div><span>Fourchette</span><span>{ev.speakerBudgetMinCents != null || ev.speakerBudgetMaxCents != null ? `${ev.speakerBudgetMinCents != null ? formatEUR(ev.speakerBudgetMinCents) : "…"} – ${ev.speakerBudgetMaxCents != null ? formatEUR(ev.speakerBudgetMaxCents) : "…"}` : "—"}</span></div>
                <div><span>Publication</span><span>{ev.publishedAt ? "Dans l'agenda" : "Brouillon (invisible)"}</span></div>
              </div>
              {!ev.publishedAt && ev.speakerCallOpen && <p className="notice warn">L&apos;événement n&apos;est pas publié : les experts ne voient pas encore cet appel.</p>}
              {ev.speakerProfile && <p>{ev.speakerProfile}</p>}
              <h3>{ev.speakerApplications.length} candidature{ev.speakerApplications.length > 1 ? "s" : ""}</h3>
              {ev.speakerApplications.length === 0 && <p className="muted">Aucune candidature pour l&apos;instant.</p>}
              <ul className="applications">
                {ev.speakerApplications.map((a) => {
                  const p = a.practitioner;
                  const name = `${p.user.firstName} ${p.user.lastName}`;
                  return (
                    <li key={a.id}>
                      <div className="actions spread">
                        <div className="actions">
                          <Avatar name={name} size={36} ring />
                          <div>
                            <strong><Link href={`/experts/${p.id}`}>Dr {name}</Link></strong>
                            <div className="muted">{[p.specialty || p.profession, p.city, `${p._count.publications} publication${p._count.publications > 1 ? "s" : ""}`].filter(Boolean).join(" · ")}</div>
                          </div>
                        </div>
                        <span className={`pill ${a.status === "retained" ? "ok" : a.status === "rejected" ? "done" : "wait"}`}>{SPEAKER_STATUS[a.status]}</span>
                      </div>
                      {a.message && <p>« {a.message} »</p>}
                      {a.status === "pending" && (
                        <div className="actions">
                          {full ? <span className="muted">Places pourvues</span> : <RetainSpeakerForm orgId={id} applicationId={a.id} defaultFee={mid != null ? String(Math.round(mid / 100)) : p.dayRateCents != null ? String(p.dayRateCents / 100) : ""} />}
                          <form action={rejectSpeaker}>
                            <input type="hidden" name="orgId" value={id} />
                            <input type="hidden" name="applicationId" value={a.id} />
                            <button className="link danger">Ne pas retenir</button>
                          </form>
                        </div>
                      )}
                      {a.projectId && !canSeeProjects && <span className="muted">Dossier de collaboration ouvert pour l&apos;équipe projets.</span>}
                      {a.projectId && canSeeProjects && <Link href={`/organisations/${id}/dossiers/${a.projectId}`}>Voir le dossier de collaboration</Link>}
                    </li>
                  );
                })}
              </ul>
              {canManage && (
                <form action={setSpeakerCallOpen} className="actions">
                  <input type="hidden" name="orgId" value={id} />
                  <input type="hidden" name="eventId" value={ev.id} />
                  <input type="hidden" name="open" value={ev.speakerCallOpen ? "0" : "1"} />
                  <button className="btn ghost small">{ev.speakerCallOpen ? <><Lock size={13} /> Clore l&apos;appel</> : <><Unlock size={13} /> Rouvrir l&apos;appel</>}</button>
                </form>
              )}
            </section>
          );
        })}
      </main>
    </>
  );
}
