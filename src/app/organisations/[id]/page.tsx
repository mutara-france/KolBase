import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { CreateMenu, DashHead, DashStats, Timeline, TodoGroups, type TimelineItem } from "@/components/Dashboard";
import { requireMembership } from "@/lib/orgs";
import { orgOverview } from "@/lib/org-overview";
import { eventMoment, formatEUR } from "@/lib/events";
import { supplierCategoryLabel } from "@/lib/suppliers";
import { orgBillingLine, orgOnboarding } from "@/lib/onboarding";
import { CheckCircle2, Circle } from "lucide-react";
import { rnaAccepted, roleLabel, STATS_ROLES } from "@/lib/org-roles";
import type { OrgKind } from "@/generated/prisma/client";
import { de, inSentence } from "@/lib/elision";

export const metadata = { title: "Accueil — KolBase" };

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;
/** Lien vers la demande de validation : la voir, ou compléter / corriger l'identité (SIREN, ou RNA pour une association). */
const identityLink = (org: { verification: string; siren: string | null; rna: string | null; kind: OrgKind }) => {
  const ids = rnaAccepted(org.kind) ? "SIREN ou RNA" : "SIREN";
  if (org.verification === "REJECTED") return `Corriger l'identité (${ids})`;
  if (org.siren || org.rna) return "Voir la demande";
  return rnaAccepted(org.kind) ? "Compléter l'identité (SIREN ou RNA)" : "Renseigner le SIREN";
};

/** Accueil d'une organisation : ce qui attend une action, puis ce qui arrive. Le reste est dans les rubriques. */
export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ acces?: string }> }) {
  const { id } = await params;
  const { acces } = await searchParams;
  const { user, isAdmin, roles } = await requireMembership(id);
  const o = await orgOverview(id);
  if (!o) notFound();
  const { org, can, todos, projects, events, calls, hosp, rfqs } = o;
  const onboarding = isAdmin ? await orgOnboarding(id) : [];
  const billingLine = onboarding.length > 0 ? await orgBillingLine(id, org.kind) : null;
  const now = new Date();
  const base = `/organisations/${id}`;

  const active = projects.filter((p) => !["TERMINE", "DECLINE"].includes(p.status));
  const engaged = active.flatMap((p) => p.experts.filter((e) => !["ATT_EXPERTS", "DECLINE"].includes(e.status)));
  // À venir et en cours (commencé n'est pas terminé : visible le jour même) ; un événement annulé n'y figure plus.
  const upcoming = events.filter((e) => !e.cancelledAt && eventMoment(e, now) !== "passe");
  const pendingApps = calls.reduce((s, c) => s + c.applications.length, 0);
  const hospValue = hosp.reduce((s, r) => s + r.benefits.reduce((x, b) => x + b.valueCents, 0), 0);

  // Trois repères au plus, choisis selon les droits.
  const stats = [
    can.view && { href: `${base}/dossiers`, value: active.length, label: "Dossiers en cours", hint: plural(engaged.length, "expert engagé", "experts engagés") },
    can.view && { href: `${base}/dossiers`, value: formatEUR(engaged.reduce((s, e) => s + (e.feeCents ?? 0), 0)), label: "Engagés (HT)", hint: "Sur les dossiers en cours" },
    can.events && { href: `${base}/evenements`, value: upcoming.length, label: "Événements à venir", hint: plural(upcoming.reduce((s, e) => s + e._count.registrations, 0), "inscrit", "inscrits") },
    can.sourcing && { href: `${base}/opportunites`, value: pendingApps, label: "Candidatures à traiter", hint: plural(calls.length, "appel ouvert", "appels ouverts") },
    can.compliance && { href: `${base}/conformite`, value: projects.filter((p) => p.status === "EN_VALID").length, label: "Dossiers à valider" },
    can.compliance && { href: `${base}/hospitalites`, value: hosp.length, label: "Hospitalités à déclarer", hint: formatEUR(hospValue) },
  ]
    .filter((s): s is Exclude<typeof s, false> => !!s)
    .slice(0, 3);

  const timeline: TimelineItem[] = [
    ...upcoming.map((e) => ({
      date: e.startsAt,
      title: e.title,
      detail: [eventMoment(e, now) === "en_cours" ? "en cours · inscriptions closes" : null, e.city ?? (e.format === "DISTANCIEL" ? "En ligne" : null), e.internal ? "réunion interne" : `${plural(e._count.registrations, "inscrit", "inscrits")}${e.capacity ? ` sur ${e.capacity}` : ""}`, e.publishedAt || e.internal ? null : "brouillon"]
        .filter(Boolean)
        .join(" · "),
      // La conformité lit la fiche de l'événement (hospitalités, inscrits) sans la modifier.
      href: can.events || can.compliance ? `${base}/evenements/${e.id}` : `/evenements/${e.id}`,
      strong: true,
    })),
    ...(can.organizer
      ? rfqs
          .filter((r) => r.status === "sent" && r.deadline && r.deadline >= now)
          .map((r) => ({ date: r.deadline!, title: `Limite des devis : ${supplierCategoryLabel(r.category).toLowerCase()}`, detail: r.event?.title, href: `${base}/prestataires` }))
      : []),
    ...calls
      .filter((c) => c.deadline && c.deadline >= now)
      .map((c) => ({
        date: c.deadline!,
        title: `Clôture de l'appel : ${c.title}`,
        detail: c.applications.length ? plural(c.applications.length, "candidature à examiner", "candidatures à examiner") : "Aucune candidature à examiner",
        href: `${base}/opportunites/${c.id}`,
      })),
  ]
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .slice(0, 6);

  const create = [
    can.sourcing && { href: `${base}/dossiers/nouveau`, label: "Un dossier de collaboration" },
    can.organizer && { href: `${base}/evenements/nouveau`, label: "Un événement" },
    can.sourcing && { href: `${base}/opportunites#nouvel-appel`, label: "Un appel à candidatures" },
  ].filter((c): c is Exclude<typeof c, false> => !!c);

  const urgent = todos.filter((t) => t.tone === "danger").length;
  const lede =
    todos.length === 0
      ? "Rien à traiter pour le moment."
      : `${plural(todos.length, "action vous attend", "actions vous attendent")}${urgent ? `, dont ${plural(urgent, "urgente", "urgentes")}` : ""}.`;

  return (
    <>
      <SiteHeader />
      <main className="stack dash">
        <DashHead title={`Bonjour ${user.firstName}.`} lede={lede} action={<CreateMenu items={create} />} />
        {acces === "refuse" && (
          <p className="notice warn" role="alert">
            La page demandée est réservée à d&apos;autres rôles {de(org.name)} (vos rôles : {roles.map((r) => roleLabel(r, org.kind)).join(", ")}).{" "}
            {isAdmin ? <>Vous pouvez ajuster les rôles dans <Link href={`${base}/membres`}>Membres et réglages</Link>.</> : "Un administrateur de l'organisation peut vous donner le rôle nécessaire."}
          </p>
        )}
        {org.verification === "SUSPENDED" && (
          <p className="notice error" role="status">
            Organisation suspendue{org.verificationNote ? ` : ${inSentence(org.verificationNote)}` : ""}. Votre page publique, vos événements et vos appels sont masqués,
            et aucune nouvelle action n&apos;est possible jusqu&apos;à la réactivation par KolBase ; rien n&apos;est supprimé.
          </p>
        )}
        {org.verification !== "VERIFIED" && org.verification !== "SUSPENDED" && (
          <p className={`notice ${org.verification === "REJECTED" ? "error" : "warn"}`}>
            {org.verification === "REJECTED"
              ? `KolBase n'a pas validé votre organisation${org.verificationNote ? ` : ${inSentence(org.verificationNote)}` : ""}.`
              : org.kind === "PRESTATAIRE"
                ? "Votre organisation est en attente de validation par KolBase. D'ici là, elle ne peut ni répondre aux demandes de devis, ni figurer dans l'annuaire des prestataires."
                : "Votre organisation est en attente de validation par KolBase. D'ici là, elle ne peut ni solliciter de praticiens, ni publier."}{" "}
            {isAdmin ? <Link href={`${base}/membres?onglet=organisation`}>{identityLink(org)}</Link> : "Un administrateur de l'organisation peut compléter la demande."}
          </p>
        )}
        {onboarding.length > 0 && onboarding.some((s) => !s.done) && (
          <section className="card onboarding" aria-labelledby="prise-en-main">
            <div className="flex-between">
              <h2 id="prise-en-main" className="dash-title">Prise en main</h2>
              <span className="muted text-sm">{onboarding.filter((s) => s.done).length} étape{onboarding.filter((s) => s.done).length > 1 ? "s" : ""} sur {onboarding.length}</span>
            </div>
            <div className="gauge-track"><div className="gauge-fill" style={{ width: `${Math.round((onboarding.filter((s) => s.done).length / onboarding.length) * 100)}%` }} /></div>
            <ol className="onboarding-steps">
              {onboarding.map((s) => (
                <li key={s.key} className={s.done ? "done" : ""}>
                  {s.done ? <CheckCircle2 size={18} aria-label="Fait" /> : <Circle size={18} aria-label="À faire" />}
                  <span>{s.done ? <strong>{s.label}</strong> : <Link href={s.href}><strong>{s.label}</strong></Link>}<small>{s.hint}</small></span>
                </li>
              ))}
            </ol>
            {billingLine && <p className="hint onboarding-billing">{billingLine} <Link href={`${base}/abonnement`}>Voir l&apos;abonnement</Link></p>}
          </section>
        )}
        <DashStats stats={stats} />
        {org.kind !== "PRESTATAIRE" && roles.some((r) => STATS_ROLES.includes(r)) && (
          <p className="text-sm"><Link href={`${base}/statistiques`}>Voir les statistiques de l&apos;organisation</Link> : budget engagé, experts, événements, délais.</p>
        )}
        <div className={`dash-layout${timeline.length ? "" : " single"}`}>
          <section className="card dash-card" aria-labelledby="a-faire">
            <h2 id="a-faire" className="dash-title">
              À faire {todos.length > 0 && <span className="count-pill">{todos.length}</span>}
            </h2>
            <TodoGroups todos={todos} moreHref={can.view ? `${base}/dossiers` : undefined} />
          </section>
          {timeline.length > 0 && (
            <section className="card dash-card" aria-labelledby="a-venir">
              <h2 id="a-venir" className="dash-title">À venir</h2>
              <Timeline items={timeline} />
            </section>
          )}
        </div>
      </main>
    </>
  );
}
