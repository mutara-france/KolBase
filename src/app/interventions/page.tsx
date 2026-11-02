import Link from "next/link";
import { redirect } from "next/navigation";
import { Check, Clock, Megaphone, Users, Wallet } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { SectionNav } from "@/components/SectionNav";
import { practitionerSectionTabs } from "@/lib/nav";
import { SpeakerApplyForm } from "@/components/SpeakerForms";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { eventTypeLabel, TZ } from "@/lib/events";
import { SPEAKER_STATUS } from "@/lib/suppliers";
import { withdrawSpeaker } from "@/lib/speaker-actions";
import { fmtDate, fmtEur, intlLocale } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: `${t("Mes interventions")} — KolBase` };
}

export default async function Page({ searchParams }: { searchParams: Promise<{ onglet?: string }> }) {
  const user = await requireUser();
  const p = user.practitioner;
  if (!p?.listed) redirect("/compte");
  const { t, locale } = await getT();
  const formatDateTime = (d: Date) =>
    d.toLocaleString(intlLocale(locale), { timeZone: TZ, weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const now = new Date();

  const mine = await db.speakerApplication.findMany({
    where: { practitionerId: p.id },
    include: { event: { include: { organization: true, _count: { select: { registrations: true } } } } },
    orderBy: { event: { startsAt: "asc" } },
  });
  const speaking = mine.filter((a) => a.status === "retained");
  const links = await db.projectExpert.findMany({ where: { practitionerId: p.id, projectId: { in: speaking.map((a) => a.projectId).filter((x): x is string => !!x) } } });
  const linkOf = (projectId: string | null) => links.find((l) => l.projectId === projectId)?.id;
  const calls = await db.event.findMany({
    where: {
      speakerCallOpen: true,
      publishedAt: { not: null },
      startsAt: { gte: now },
      OR: [{ speakerDeadline: null }, { speakerDeadline: { gte: now } }],
    },
    include: { organization: true, speakerApplications: { select: { practitionerId: true, status: true } } },
    orderBy: { startsAt: "asc" },
  });
  const { onglet = speaking.length ? "interventions" : "appels" } = await searchParams;
  const group = onglet === "interventions" ? "agenda" : "opportunites";
  const active = onglet === "interventions" ? "interventions" : onglet === "candidatures" ? "candidatures" : "intervenants";
  const heading = (({
    interventions: ["Mes interventions", "Les événements où vous intervenez. Vos participations en tant que public sont dans Mes inscriptions."],
    appels: ["Appels à intervenants", "Les organisateurs annoncent leurs sessions avant d'avoir bouclé le programme : proposez-vous."],
    candidatures: ["Mes candidatures", "Vos candidatures aux appels à intervenants et leur suite."],
  } as Record<string, [string, string]>)[onglet] ?? ["Appels à intervenants", ""]).map((s) => (s ? t(s) : s));

  return (
    <>
      <SiteHeader section={group} />
      <main className="stack">
        <SectionNav tabs={practitionerSectionTabs(group).map((tab) => ({ ...tab, label: t(tab.label) }))} active={active} label={t(group === "agenda" ? "Rubrique Agenda" : "Rubrique Opportunités")} />
        <h1>{heading[0]}</h1>
        {heading[1] && <p className="muted">{heading[1]}</p>}

        {onglet === "interventions" && (
          <div className="grid-2">
            {speaking.length === 0 && <div className="card empty"><Megaphone size={22} /><p>{t("Vous n'intervenez sur aucun événement pour l'instant.")}</p></div>}
            {speaking.map((a) => (
              <div key={a.id} className="card stack-sm">
                <div className="eyebrow-sm">{a.event.organization.name} · {t(eventTypeLabel(a.event.typeId))}</div>
                <h3><Link href={`/evenements/${a.eventId}`}>{a.event.title}</Link></h3>
                <span className="muted"><Clock size={12} /> {formatDateTime(a.event.startsAt)}{a.event.city ? ` · ${a.event.city}` : ""}</span>
                <span className="pill electric"><Megaphone size={12} /> {t(a.event._count.registrations > 1 ? "Vous intervenez — {n} inscrits" : "Vous intervenez — {n} inscrit", { n: a.event._count.registrations })}</span>
                {linkOf(a.projectId) && <Link href={`/sollicitations/${linkOf(a.projectId)}`}>{t("Dossier de collaboration")}</Link>}
              </div>
            ))}
          </div>
        )}

        {onglet === "appels" && (
          <div className="grid-2">
            {calls.length === 0 && <div className="card empty"><Megaphone size={22} /><p>{t("Aucun appel à intervenants ouvert.")}</p></div>}
            {calls.map((ev) => {
              const retained = ev.speakerApplications.filter((a) => a.status === "retained").length;
              const applied = ev.speakerApplications.some((a) => a.practitionerId === p.id);
              const left = ev.speakerSlots != null ? ev.speakerSlots - retained : null;
              return (
                <div key={ev.id} className="card stack-sm">
                  <div className="card-head">
                    <div>
                      <div className="eyebrow-sm">{ev.organization.name} · {t(eventTypeLabel(ev.typeId))}</div>
                      <h3><Link href={`/evenements/${ev.id}`}>{ev.title}</Link></h3>
                    </div>
                    <span className="pill ok">{t("Appel ouvert")}</span>
                  </div>
                  <span className="muted"><Clock size={12} /> {formatDateTime(ev.startsAt)}{ev.city ? ` · ${ev.city}` : ""}</span>
                  <span className="muted"><Users size={12} /> {left != null ? t(left > 1 ? "{n} places restantes" : "{n} place restante", { n: left }) : t("Places à définir")}{ev.speakerDeadline ? ` · ${t("candidatures jusqu'au {date}", { date: fmtDate(locale, ev.speakerDeadline) })}` : ""}</span>
                  {(ev.speakerBudgetMinCents != null || ev.speakerBudgetMaxCents != null) && (
                    <span className="muted"><Wallet size={12} /> {t("{amount} HT", { amount: [ev.speakerBudgetMinCents, ev.speakerBudgetMaxCents].filter((c) => c != null).map((c) => fmtEur(locale, c!)).join(" – ") })}</span>
                  )}
                  {ev.speakerProfile && <p>{ev.speakerProfile}</p>}
                  {applied ? <span className="pill ok"><Check size={12} /> {t("Candidature envoyée")}</span> : left === 0 ? <span className="muted">{t("Places pourvues")}</span> : <SpeakerApplyForm eventId={ev.id} />}
                </div>
              );
            })}
          </div>
        )}

        {onglet === "candidatures" && (
          <section className="card">
            {mine.length === 0 && <p className="muted">{t("Aucune candidature.")}</p>}
            <ul className="applications">
              {mine.map((a) => (
                <li key={a.id}>
                  <div className="actions spread">
                    <strong><Link href={`/evenements/${a.eventId}`}>{a.event.title}</Link></strong>
                    <span className={`pill ${a.status === "retained" ? "ok" : ["rejected", "declined"].includes(a.status) ? "done" : "wait"}`}>{t(a.status === "pending" ? "En attente" : SPEAKER_STATUS[a.status])}</span>
                  </div>
                  <span className="muted">{a.event.organization.name} · {fmtDate(locale, a.event.startsAt)} · {t("envoyée le {date}", { date: fmtDate(locale, a.createdAt) })}</span>
                  {a.message && <p>{a.message}</p>}
                  {a.status === "pending" && (
                    <form action={withdrawSpeaker}>
                      <input type="hidden" name="eventId" value={a.eventId} />
                      <button className="link danger">{t("Retirer ma candidature")}</button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </>
  );
}
