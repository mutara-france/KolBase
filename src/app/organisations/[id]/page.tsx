import { SectionHead } from "@/components/UI";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { CreateMenu, DashHead, DashStats, Timeline, TodoGroups, type TimelineItem } from "@/components/Dashboard";
import { requireMembership } from "@/lib/orgs";
import { db } from "@/lib/db";
import { orgOverview } from "@/lib/org-overview";
import { eventMoment } from "@/lib/events";
import { supplierCategoryLabel } from "@/lib/suppliers";
import { orgBillingLine, orgOnboarding } from "@/lib/onboarding";
import { CalendarClock, CheckCircle2, Circle, ListChecks, Rocket } from "lucide-react";
import { rnaAccepted, roleLabel } from "@/lib/org-roles";
import type { OrgKind } from "@/generated/prisma/client";
import { de, inSentence } from "@/lib/elision";
import { getT } from "@/lib/i18n/server";
import { fmtEur, intlLocale, type T } from "@/lib/i18n";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: `${t("Accueil")} — KolBase` };
}

/** « 3 inscrits » : clés de traduction « {n} inscrit » / « {n} inscrits ». */
const plural = (t: T, n: number, one: string, many: string) => t(n > 1 ? `{n} ${many}` : `{n} ${one}`, { n });
/** Lien vers la demande de validation : la voir, ou compléter / corriger l'identité (SIREN, ou RNA pour une association). */
const identityLink = (org: { verification: string; siren: string | null; rna: string | null; kind: OrgKind }) => {
  const ids = rnaAccepted(org.kind) ? "SIREN ou RNA" : "SIREN";
  if (org.verification === "REJECTED") return `Corriger l'identité (${ids})`;
  if (org.siren || org.rna) return "Voir la demande";
  return rnaAccepted(org.kind) ? "Compléter l'identité (SIREN ou RNA)" : "Renseigner le SIREN";
};

/** Accueil d'une organisation : ce qui attend une action, puis ce qui arrive. Le reste est dans les rubriques. */
export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ acces?: string }> }) {
  const { t, locale } = await getT();
  const { id } = await params;
  const { acces } = await searchParams;
  const { user, isAdmin, roles } = await requireMembership(id);
  const o = await orgOverview(id);
  if (!o) notFound();
  const { org, can, todos, projects, events, calls, hosp, rfqs } = o;
  const onboarding = isAdmin ? await orgOnboarding(id) : [];
  const billingLine = onboarding.length > 0 ? await orgBillingLine(id, org.kind, t, intlLocale(locale)) : null;
  const now = new Date();
  const base = `/organisations/${id}`;

  const active = projects.filter((p) => !["TERMINE", "DECLINE"].includes(p.status));
  const engaged = active.flatMap((p) => p.experts.filter((e) => !["ATT_EXPERTS", "DECLINE"].includes(e.status)));
  // À venir et en cours (commencé n'est pas terminé : visible le jour même) ; un événement annulé n'y figure plus.
  const upcoming = events.filter((e) => !e.cancelledAt && eventMoment(e, now) !== "passe");
  const pendingApps = calls.reduce((s, c) => s + c.applications.length, 0);
  const hospValue = hosp.reduce((s, r) => s + r.benefits.reduce((x, b) => x + b.valueCents, 0), 0);
  // Prestataire : ses demandes de devis reçues, pour les mêmes repères que les autres accueils.
  const invites =
    org.kind === "PRESTATAIRE"
      ? await db.rfqSupplier.findMany({
          where: { supplierId: id, rfq: { status: { not: "draft" } } },
          select: {
            declined: true,
            rfq: {
              select: {
                status: true, deadline: true, category: true,
                organization: { select: { name: true } },
                event: { select: { title: true, startsAt: true, city: true } },
                quotes: { where: { supplierId: id }, select: { status: true, amountCents: true } },
              },
            },
          },
        })
      : [];
  const toQuote = invites.filter((i) => i.rfq.status === "sent" && !i.declined && i.rfq.quotes.length === 0);
  const won = invites.filter((i) => i.rfq.quotes[0]?.status === "retained");

  // Trois repères au plus, choisis selon les droits.
  const stats = [
    can.view && { href: `${base}/dossiers`, value: active.length, label: t("Dossiers en cours"), hint: plural(t, engaged.length, "expert engagé", "experts engagés") },
    can.view && { href: `${base}/dossiers`, value: fmtEur(locale, engaged.reduce((s, e) => s + (e.feeCents ?? 0), 0)), label: t("Engagés (HT)"), hint: t("Sur les dossiers en cours") },
    can.events && { href: `${base}/evenements`, value: upcoming.length, label: t("Événements à venir"), hint: plural(t, upcoming.reduce((s, e) => s + e._count.registrations, 0), "inscrit", "inscrits") },
    can.sourcing && { href: `${base}/opportunites`, value: pendingApps, label: t("Candidatures à traiter"), hint: plural(t, calls.length, "opportunité ouverte", "opportunités ouvertes") },
    can.compliance && { href: `${base}/conformite`, value: projects.filter((p) => p.status === "EN_VALID").length, label: t("Dossiers à valider") },
    can.compliance && { href: `${base}/hospitalites`, value: hosp.length, label: t("Hospitalités à déclarer"), hint: fmtEur(locale, hospValue) },
    org.kind === "PRESTATAIRE" && { href: `${base}/devis`, value: toQuote.length, label: t("Demandes à traiter"), hint: plural(t, invites.filter((i) => i.rfq.status === "sent" && !i.declined).length, "demande en cours", "demandes en cours") },
    org.kind === "PRESTATAIRE" && { href: `${base}/devis`, value: won.length, label: t("Devis retenus"), hint: plural(t, invites.length, "demande reçue", "demandes reçues") },
    org.kind === "PRESTATAIRE" && { href: `${base}/devis`, value: fmtEur(locale, won.reduce((s, i) => s + (i.rfq.quotes[0]?.amountCents ?? 0), 0)), label: t("Montant retenu"), hint: t("HT, toutes prestations") },
  ]
    .filter((s): s is Exclude<typeof s, false> => !!s)
    .slice(0, 3);

  const timeline: TimelineItem[] = [
    ...upcoming.map((e) => ({
      date: e.startsAt,
      title: e.title,
      detail: [eventMoment(e, now) === "en_cours" ? t("en cours · inscriptions closes") : null, e.city ?? (e.format === "DISTANCIEL" ? t("En ligne") : null), e.internal ? t("réunion interne") : e.capacity ? t("{n} inscrits sur {capacity}", { n: e._count.registrations, capacity: e.capacity }) : plural(t, e._count.registrations, "inscrit", "inscrits"), e.publishedAt || e.internal ? null : t("brouillon")]
        .filter(Boolean)
        .join(" · "),
      // La conformité lit la fiche de l'événement (hospitalités, inscrits) sans la modifier.
      href: can.events || can.compliance ? `${base}/evenements/${e.id}` : `/evenements/${e.id}`,
      strong: true,
    })),
    ...(can.organizer
      ? rfqs
          .filter((r) => r.status === "sent" && r.deadline && r.deadline >= now)
          .map((r) => ({ date: r.deadline!, title: t("Limite des devis : {toLowerCase}", { toLowerCase: t(supplierCategoryLabel(r.category)).toLowerCase() }), detail: r.event?.title, href: `${base}/prestataires` }))
      : []),
    // Prestataire : les prestations retenues à venir, et les demandes dont l'échéance de réponse approche.
    ...won
      .filter((i) => i.rfq.event && i.rfq.event.startsAt >= now)
      .map((i) => ({ date: i.rfq.event!.startsAt, title: i.rfq.event!.title, detail: [t(supplierCategoryLabel(i.rfq.category)), i.rfq.organization.name, i.rfq.event!.city].filter(Boolean).join(" · "), href: `${base}/devis`, strong: true })),
    ...toQuote
      .filter((i) => i.rfq.deadline && i.rfq.deadline >= now)
      .map((i) => ({ date: i.rfq.deadline!, title: t("Limite des devis : {toLowerCase}", { toLowerCase: t(supplierCategoryLabel(i.rfq.category)).toLowerCase() }), detail: [i.rfq.organization.name, i.rfq.event?.title].filter(Boolean).join(" · "), href: `${base}/devis` })),
    ...calls
      .filter((c) => c.deadline && c.deadline >= now)
      .map((c) => ({
        date: c.deadline!,
        title: t("Clôture de l'opportunité : {title}", { title: c.title }),
        detail: c.applications.length ? plural(t, c.applications.length, "candidature à examiner", "candidatures à examiner") : t("Aucune candidature à examiner"),
        href: `${base}/opportunites/${c.id}`,
      })),
  ]
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .slice(0, 6);

  const create = [
    can.sourcing && { href: `${base}/dossiers/nouveau`, label: t("Un dossier de collaboration") },
    can.organizer && { href: `${base}/evenements/nouveau`, label: t("Un événement") },
    can.sourcing && { href: `${base}/opportunites#nouvel-appel`, label: t("Une opportunité") },
  ].filter((c): c is Exclude<typeof c, false> => !!c);

  const urgent = todos.filter((tk) => tk.tone === "danger").length;
  const lede =
    todos.length === 0
      ? t("Rien à traiter pour le moment.")
      : urgent
        ? t(todos.length > 1 ? "{n} actions vous attendent, dont {urgent}." : "{n} action vous attend, dont {urgent}.", { n: todos.length, urgent: plural(t, urgent, "urgente", "urgentes") })
        : t(todos.length > 1 ? "{n} actions vous attendent." : "{n} action vous attend.", { n: todos.length });

  return (
    <>
      <SiteHeader />
      <main className="stack dash">
        <DashHead title={t("Bonjour {firstName}.", { firstName: user.firstName })} lede={lede} action={<CreateMenu items={create} />} />
        {acces === "refuse" && (
          <p className="notice warn" role="alert">
            {t("La page demandée est réservée à d'autres rôles {de} (vos rôles : {join}).", { de: de(org.name), join: roles.map((r) => t(roleLabel(r, org.kind))).join(", ") })}
            {isAdmin ? <>{t("Vous pouvez ajuster les rôles dans")}{" "}<Link href={`${base}/membres`}>{t("Membres et réglages")}</Link>.</> : t("Un administrateur de l'organisation peut vous donner le rôle nécessaire.")}
          </p>
        )}
        {org.verification === "SUSPENDED" && (
          <p className="notice error" role="status">
            {t("Organisation suspendue")}{org.verificationNote ? ` : ${inSentence(org.verificationNote)}` : ""}.{" "}
            {t("Votre page publique, vos événements et vos opportunités sont masqués, et aucune nouvelle action n'est possible jusqu'à la réactivation par KolBase ; rien n'est supprimé.")}
          </p>
        )}
        {org.verification !== "VERIFIED" && org.verification !== "SUSPENDED" && (
          <p className={`notice ${org.verification === "REJECTED" ? "error" : "warn"}`}>
            {org.verification === "REJECTED"
              ? t("KolBase n'a pas validé votre organisation{v}.", { v: org.verificationNote ? ` : ${inSentence(org.verificationNote)}` : "" })
              : org.kind === "PRESTATAIRE"
                ? t("Votre organisation est en attente de validation par KolBase. D'ici là, elle ne peut ni répondre aux demandes de devis, ni figurer dans l'annuaire des prestataires.")
                : t("Votre organisation est en attente de validation par KolBase. D'ici là, elle ne peut ni solliciter de praticiens, ni publier.")}{" "}
            {isAdmin ? <Link href={`${base}/membres?onglet=organisation`}>{t(identityLink(org))}</Link> : t("Un administrateur de l'organisation peut compléter la demande.")}
          </p>
        )}
        {onboarding.length > 0 && onboarding.some((s) => !s.done) && (
          <section className="card onboarding" aria-labelledby="prise-en-main">
            <SectionHead icon={Rocket} id="prise-en-main" title={t("Prise en main")} desc={t("Les réglages qui rendent l'organisation opérationnelle.")}>
              <span className="muted text-sm">{t(onboarding.filter((s) => s.done).length > 1 ? "{n} étapes sur {onboarding}" : "{n} étape sur {onboarding}", { n: onboarding.filter((s) => s.done).length, onboarding: onboarding.length })}</span>
            </SectionHead>
            <div className="gauge-track"><div className="gauge-fill" style={{ width: `${Math.round((onboarding.filter((s) => s.done).length / onboarding.length) * 100)}%` }} /></div>
            {/* Étapes restantes en clair ; les étapes faites, repliées, n'encombrent plus la prise en main. */}
            <ol className="onboarding-steps">
              {onboarding.filter((s) => !s.done).map((s) => (
                <li key={s.key}>
                  <Circle size={18} aria-label={t("À faire")} />
                  <span><Link href={s.href}><strong>{t(s.label)}</strong></Link><small>{t(s.hint)}</small></span>
                </li>
              ))}
            </ol>
            {onboarding.some((s) => s.done) && (
              <details className="onboarding-done">
                <summary>{t(onboarding.filter((s) => s.done).length > 1 ? "{n} étapes terminées" : "{n} étape terminée", { n: onboarding.filter((s) => s.done).length })}</summary>
                <ol className="onboarding-steps">
                  {onboarding.filter((s) => s.done).map((s) => (
                    <li key={s.key} className="done">
                      <CheckCircle2 size={18} aria-label={t("Fait")} />
                      <span><strong>{t(s.label)}</strong></span>
                    </li>
                  ))}
                </ol>
              </details>
            )}
            {billingLine && <p className="hint onboarding-billing">{billingLine} <Link href={`${base}/abonnement`}>{t("Voir l'abonnement")}</Link></p>}
          </section>
        )}
        <DashStats stats={stats} />
        <div className={`dash-layout${timeline.length ? "" : " single"}`}>
          <section className="card dash-card" aria-labelledby="a-faire">
            <SectionHead icon={ListChecks} id="a-faire" title={<>{t("À faire")}{" "}{todos.length > 0 && <span className="count-pill">{todos.length}</span>}</>} desc={todos.length ? t("Les plus urgentes d'abord.") : undefined} />
            <TodoGroups todos={todos} moreHref={can.view ? `${base}/dossiers` : undefined} />
          </section>
          {timeline.length > 0 && (
            <section className="card dash-card" aria-labelledby="a-venir">
              <SectionHead icon={CalendarClock} id="a-venir" title={t("À venir")} desc={t("Échéances et événements des prochaines semaines.")} />
              <Timeline items={timeline} />
            </section>
          )}
        </div>
      </main>
    </>
  );
}
