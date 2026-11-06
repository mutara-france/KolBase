import Link from "next/link";
import type { ApplicationStatus } from "@/generated/prisma/client";
import { notFound } from "next/navigation";
import { CalendarDays, Euro, Inbox, Mic, UserCheck } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { PageHero } from "@/components/PageHero";
import { RetainForm } from "@/components/OpportunityForms";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/orgs";
import { collabType, recruitmentOpen, SOURCING_ROLES } from "@/lib/projects";
import { rejectApplication, setOpenCallStatus } from "@/lib/opportunity-actions";
import { getT } from "@/lib/i18n/server";
import { fmtDate, fmtEur, intlLocale } from "@/lib/i18n";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: `${t("Opportunité")} — KolBase` };
}

const APP_STATUS: Record<ApplicationStatus, string> = { pending: "À traiter", retained: "Retenue", rejected: "Non retenue", declined: "Honoraires déclinés" };

export default async function Page({ params }: { params: Promise<{ id: string; callId: string }> }) {
  const { t, locale } = await getT();
  const { id, callId } = await params;
  const { org } = await requireMembership(id, SOURCING_ROLES);
  const call = await db.openCall.findFirst({
    where: { id: callId, organizationId: id },
    include: {
      event: { select: { id: true, title: true, startsAt: true, city: true, project: { select: { id: true, title: true, status: true } } } },
      applications: {
        include: { practitioner: { include: { user: { select: { firstName: true, lastName: true } } } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!call) notFound();
  const type = collabType(call.typeId);
  // Événement d'un dossier qui recrute encore : les candidats retenus rejoignent ce dossier.
  const host = call.event?.project && recruitmentOpen(call.event.project.status) ? call.event.project : null;
  const budget = [call.budgetMinCents, call.budgetMaxCents].map((c) => (c != null ? fmtEur(locale, c) : null));

  const pendingCount = call.applications.filter((a) => a.status === "pending").length;
  const retained = call.applications.filter((a) => a.status === "retained").length;
  // Places toutes pourvues : l'opportunité ne reçoit plus de candidature, même si elle n'est pas clôturée.
  const full = call.slots != null && retained >= call.slots;

  return (
    <>
      <SiteHeader />
      <main className="stack">
        <p className="muted"><Link href={`/organisations/${id}`}>{org.name}</Link> / <Link href={`/organisations/${id}/opportunites`}>{t("Opportunités")}</Link></p>
        <PageHero
          eyebrow={`${t("Opportunité")} · ${t(type?.label ?? call.typeId)}${call.specialty ? ` · ${t(call.specialty)}` : ""}`}
          status={<span className={`pill ${call.status !== "open" ? "done" : full ? "bad" : "ok"}`}>{call.status !== "open" ? t("Clôturé") : full ? t("Complet") : t("Ouvert")}</span>}
          title={call.title}
          lead={call.description}
          facts={[
            { icon: <Inbox size={13} />, label: t("Candidatures"), value: String(call.applications.length), sub: pendingCount ? t("{pendingCount} à traiter", { pendingCount }) : t("aucune en attente") },
            { icon: <UserCheck size={13} />, label: t("Retenues"), value: call.slots ? `${retained} / ${call.slots}` : String(retained), sub: call.slots ? (retained >= call.slots ? t("toutes les places sont pourvues") : t(call.slots - retained > 1 ? "{v} places à pourvoir" : "{v} place à pourvoir", { v: call.slots - retained })) : retained ? t("dossiers ouverts") : t("personne pour l'instant") },
            ...(call.event ? [{ icon: <Mic size={13} />, label: t("Événement"), value: fmtDate(locale, call.event.startsAt), sub: call.event.title }] : []),
            { icon: <Euro size={13} />, label: t("Budget"), value: budget[0] || budget[1] ? `${budget.filter(Boolean).join(" – ")} ${t("HT")}` : t("Non précisé"), sub: type ? t("repère : {v}–{v2} € par {unit}", { v: type.fmv[0].toLocaleString(intlLocale(locale)), v2: type.fmv[1].toLocaleString(intlLocale(locale)), unit: t(type.unit) }) : undefined },
            { icon: <CalendarDays size={13} />, label: t("Date limite"), value: call.deadline ? fmtDate(locale, call.deadline) : "Aucune" },
          ]}
        />
        <div className="page-grid">
          <div className="page-main">
        <section className="card">
          <h2>{t("Candidatures ({applications})", { applications: call.applications.length })}</h2>
          {call.applications.length === 0 && <p className="muted">{t("Aucune candidature pour l'instant.")}</p>}
          <ul className="applications">
            {call.applications.map((a) => (
              <li key={a.id}>
                <div className="actions spread">
                  <strong><Link href={`/annuaire/${a.practitionerId}`}>Dr {a.practitioner.user.firstName} {a.practitioner.user.lastName}</Link></strong>
                  <span className={`pill ${a.status === "retained" ? "ok" : ["rejected", "declined"].includes(a.status) ? "done" : "wait"}`}>{t(APP_STATUS[a.status])}</span>
                </div>
                <span className="muted">{t("{join} · le {date}", { join: [t(a.practitioner.specialty || a.practitioner.profession), a.practitioner.city].filter(Boolean).join(" · "), date: fmtDate(locale, a.createdAt) })}</span>
                {a.message && <p>{a.message}</p>}
                {a.status === "pending" && (
                  <div className="actions">
                    {call.slots != null && retained >= call.slots ? <span className="muted text-sm">{t("Places pourvues")}</span> : <RetainForm
                      orgId={id}
                      applicationId={a.id}
                      unit={type?.unit ?? t("unité")}
                      defaultFee={call.budgetMaxCents != null ? String(call.budgetMaxCents / 100) : a.practitioner.dayRateCents != null ? String(a.practitioner.dayRateCents / 100) : ""}
                    />}
                    <form action={rejectApplication}>
                      <input type="hidden" name="orgId" value={id} />
                      <input type="hidden" name="applicationId" value={a.id} />
                      <button className="link danger">{t("Ne pas retenir")}</button>
                    </form>
                  </div>
                )}
                {a.projectId && <Link href={`/organisations/${id}/dossiers/${a.projectId}`}>{t("Voir le dossier")}</Link>}
              </li>
            ))}
          </ul>
        </section>
          </div>
          <aside className="page-aside">
            <section className="card next-step">
              <span className="eyebrow-sm">{t("Pilotage")}</span>
              <p className="next-hint">{call.status !== "open" ? t("Opportunité clôturée : elle n'est plus visible des experts.") : full ? t("Complet : toutes les places sont pourvues, l'opportunité ne reçoit plus de candidature.") : host ? t("Les experts référencés voient l'opportunité dans « Opportunités » et sur la page de l'événement. Retenir une candidature ajoute l'expert au dossier « {title} » (onglet Experts) et lui propose des honoraires, tant que ce dossier n'est pas soumis à la conformité.", { title: host.title }) : t(call.event ? "Les experts référencés voient l'opportunité dans « Opportunités » et sur la page de l'événement. Retenir une candidature ouvre un dossier et propose des honoraires à l'expert ; le dossier avance après son accord." : "Les experts référencés voient l'opportunité dans « Opportunités ». Retenir une candidature ouvre un dossier et propose des honoraires à l'expert ; le dossier avance après son accord.")}</p>
              <form action={setOpenCallStatus} className="transitions-stack">
                <input type="hidden" name="orgId" value={id} />
                <input type="hidden" name="callId" value={callId} />
                <input type="hidden" name="status" value={call.status === "open" ? "closed" : "open"} />
                <button className="btn ghost">{call.status === "open" ? t("Clôturer l'opportunité") : t("Rouvrir l'opportunité")}</button>
              </form>
            </section>
            {call.event && (
              <section className="card stack-sm">
                <h2 className="section-title">{t("Événement")}</h2>
                <Link href={`/organisations/${id}/evenements/${call.event.id}`}><strong>{call.event.title}</strong></Link>
                <span className="muted text-sm">{fmtDate(locale, call.event.startsAt)}{call.event.city ? ` · ${call.event.city}` : ""}</span>
                <p className="hint">{t("Les personnes retenues interviennent à cet événement ; leur dossier précise l'intervention.")}</p>
              </section>
            )}
          </aside>
        </div>
      </main>
    </>
  );
}
