import Link from "next/link";
import { redirect } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { Avatar } from "@/components/Avatar";
import { DashHead, MoreLink, Timeline, type TimelineItem } from "@/components/Dashboard";
import { TodoList, type TodoItem } from "@/components/Todo";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { collabType, recruitmentOpen } from "@/lib/projects";
import { speakerConfirmed } from "@/lib/indicators";
import { billingComplete } from "@/lib/fee-notes";
import { canBeExpert, drPrefix } from "@/lib/professions";
import { professionalId } from "@/lib/countries";
import { fmtDate, fmtEur } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import { answerNewsletter } from "@/lib/auth-actions";
import { newsletterPending } from "@/lib/newsletter";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: `${t("Accueil")} — KolBase` };
}

/** Accueil du praticien : les sollicitations à traiter d'abord, puis le profil, les opportunités et l'agenda. */
export default async function Page() {
  const user = await requireUser();
  const p = user.practitioner;
  if (!p) redirect(user.memberships[0] ? `/organisations/${user.memberships[0].organizationId}` : "/compte");
  const { t, locale } = await getT();
  /** « 1 étape restante » / « 2 étapes restantes » : une clé par forme. */
  const plural = (n: number, one: string, many: string) => t(n > 1 ? many : one, { n });
  const now = new Date();

  const [links, regs, calls, pubCount, apps] = await Promise.all([
    db.projectExpert.findMany({ where: { practitionerId: p.id }, include: { project: { include: { organization: { select: { name: true } } } } }, orderBy: { createdAt: "desc" } }),
    db.registration.findMany({ where: { userId: user.id, event: { startsAt: { gte: now } } }, include: { event: { include: { organization: { select: { name: true } } } } }, orderBy: { event: { startsAt: "asc" } } }),
    p.listed
      ? db.openCall.findMany({
          where: { status: "open", OR: [{ deadline: null }, { deadline: { gte: now } }], applications: { none: { practitionerId: p.id } }, organization: { verification: "VERIFIED" } },
          include: { organization: { select: { name: true } }, event: { select: { title: true, startsAt: true } } },
          orderBy: { deadline: "asc" },
          take: 20,
        })
      : Promise.resolve([]),
    db.publication.count({ where: { practitionerId: p.id } }),
    p.listed
      ? db.application.findMany({
          where: { practitionerId: p.id, status: { in: ["pending", "retained"] }, openCall: { event: { startsAt: { gte: now } } } },
          include: { openCall: { include: { event: { include: { organization: { select: { name: true } } } } } } },
        })
      : Promise.resolve([]),
  ]);

  const changes = await db.materialVersion.findMany({
    where: { status: "changes", submittedById: user.id, material: { versions: { none: { status: { in: ["submitted", "approved"] } } } } },
    include: { material: { include: { project: { select: { id: true, title: true } } } } },
  });

  const linkOf = (projectId: string) => links.find((l) => l.projectId === projectId)?.id;
  const pending = links.filter((l) => l.status === "ATT_EXPERTS" && recruitmentOpen(l.project.status));
  const toSign = links.filter((l) => l.status === "SIGNATURE");
  const spec = (p.specialty ?? "").toLowerCase();
  const matching = calls.filter((c) => spec && `${c.specialty ?? ""} ${c.title}`.toLowerCase().includes(spec.split(/[ ,]/)[0]));
  const suggested = (matching.length ? matching : calls).slice(0, 2);

  // Les sollicitations sont mises en avant à part ; le reste des actions suit.
  const todos: TodoItem[] = [
    ...changes
      .filter((c) => linkOf(c.material.project.id))
      .map((c) => ({ href: `/sollicitations/${linkOf(c.material.project.id)}`, title: t("Modifier le support : {title}", { title: c.material.title }), detail: c.reviewComment ?? c.material.project.title, icon: "AlertTriangle" as const, tone: "danger" as const })),
    ...toSign.map((l) => ({ href: `/sollicitations/${l.id}`, title: t("Convention à signer"), detail: `${l.project.title} · ${l.project.organization.name}`, icon: "FileSignature" as const, tone: "warn" as const })),
  ];
  const pid = professionalId(p);
  const profileTodos: TodoItem[] = p.listed
    ? [
        ...(!p.bio ? [{ href: "/compte", title: t("Ajouter une présentation"), detail: t("Les organisations la lisent en premier."), icon: "UserRound" as const }] : []),
        // Hors de France : l'identifiant du pays d'exercice (INAMI, NPI…), pas le RPPS.
        ...(!pid.value ? [{ href: "/compte", title: t("Renseigner votre {id}", { id: t(pid.short) }), detail: t("Nécessaire aux conventions et au badge « Identité vérifiée »."), icon: "ShieldCheck" as const }] : []),
        // Coordonnées de facturation (structure éventuelle, adresse, TVA) : reprises par les conventions et les notes d'honoraires.
        ...(!billingComplete(p) ? [{ href: "/revenus?onglet=facturation#coordonnees", title: t("Compléter vos coordonnées de facturation"), detail: t("Structure de facturation éventuelle, adresse et TVA : reprises sur vos conventions et vos notes d'honoraires."), icon: "FileSignature" as const }] : []),
        ...(pubCount === 0 ? [{ href: "/compte", title: t("Ajouter vos publications"), detail: t("Elles apparaissent sur votre fiche publique."), icon: "CircleDot" as const }] : []),
      ]
    : [];

  const agenda: TimelineItem[] = [
    // « Vous intervenez » une fois les honoraires proposés acceptés ; avant, la proposition est à accepter.
    ...apps.flatMap((a) => (a.openCall.event ? [{ ...a, event: a.openCall.event, link: links.find((l) => l.projectId === a.projectId) }] : [])).filter((a) => a.link?.status !== "DECLINE").map((a) => {
      const confirmed = speakerConfirmed(a, a.link);
      return {
        date: a.event.startsAt,
        title: a.event.title,
        detail: confirmed ? t("Vous intervenez · {org}", { org: a.event.organization.name }) : a.status === "retained" ? t("Honoraires proposés, à accepter · {org}", { org: a.event.organization.name }) : t("Candidature en attente de réponse"),
        href: confirmed ? "/interventions?onglet=interventions" : a.status === "retained" && a.link ? `/sollicitations/${a.link.id}` : "/interventions?onglet=candidatures",
        strong: a.status === "retained",
      };
    }),
    ...regs.map((r) => ({ date: r.event.startsAt, title: r.event.title, detail: t("Inscrit · {org}", { org: r.event.organization.name }), href: `/evenements/${r.eventId}`, strong: true })),
  ]
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .slice(0, 5);

  const lede = pending.length
    ? plural(pending.length, "{n} sollicitation attend votre réponse.", "{n} sollicitations attendent votre réponse.")
    : todos.length
      ? undefined
      : p.listed
        ? t("Rien à traiter pour le moment.")
        : canBeExpert(p.profession)
          ? t("Vos inscriptions aux événements. Référencez-vous comme expert pour être sollicité.")
          : t("Vos inscriptions aux événements.");

  return (
    <>
      <SiteHeader />
      <main className="stack dash">
        <DashHead title={t("Bonjour {name}.", { name: `${drPrefix(p.profession) || `${user.firstName} `}${user.lastName}` })} lede={lede} />

        {/* Référencement proposé aux seules professions qui peuvent être expertes. */}
        {!p.listed && canBeExpert(p.profession) && (
          <section className="card highlight flex-between">
            <div>
              <h2>{t("Devenir expert référencé")}</h2>
              <p className="muted">{t("Recevez des sollicitations, candidatez aux opportunités et gérez vos conventions.")}</p>
            </div>
            <Link className="btn" href="/compte">{t("Me référencer")}</Link>
          </section>
        )}

        {newsletterPending(user) && (
          <section className="card newsletter-ask" aria-labelledby="lettre">
            <div>
              <h2 id="lettre">{t("Recevoir la lettre d'information de KolBase ?")}</h2>
              <p className="muted">{t("Les événements scientifiques à venir et les nouveautés de la plateforme, deux envois par mois au plus. Désinscription en un clic depuis chaque envoi.")}</p>
            </div>
            <form action={answerNewsletter} className="actions">
              <input type="hidden" name="source" value="accueil" />
              <button className="btn" name="choice" value="oui">{t("Oui, je m'abonne")}</button>
              <button className="btn ghost" name="choice" value="non">{t("Non merci")}</button>
            </form>
          </section>
        )}

        <div className="dash-layout">
          <section className="card dash-card" aria-labelledby="a-faire">
            <h2 id="a-faire" className="dash-title">{t("À faire")}</h2>
            {pending.map((l) => (
              <article key={l.id} className="solicit-card">
                <div className="solicit-top">
                  <Avatar name={l.project.organization.name} size={40} square />
                  <p>{t("{org} vous sollicite", { org: l.project.organization.name })}</p>
                  <span className="pill new">{t("À traiter")}</span>
                </div>
                <h3>{l.project.title}</h3>
                <div className="solicit-foot">
                  <p className="text-sm">
                    {t(collabType(l.project.typeId)?.label ?? "Collaboration")} · {t("reçue le {date}", { date: fmtDate(locale, l.createdAt) })}
                    {l.feeCents != null && (
                      <>
                        {" "}· {t("honoraires proposés")} <span className="mono ink">{t("{amount} HT", { amount: fmtEur(locale, l.feeCents) })}</span>
                      </>
                    )}
                  </p>
                  <Link className="btn" href={`/sollicitations/${l.id}`}>{t("Voir et répondre")}</Link>
                </div>
              </article>
            ))}
            {(todos.length > 0 || pending.length === 0) && <TodoList items={todos} />}
            {profileTodos.length > 0 && (
              <div className="profile-steps">
                <div className="flex-between">
                  <h3>{t("Complétez votre profil")}</h3>
                  <span className="text-xs">{plural(profileTodos.length, "{n} étape restante", "{n} étapes restantes")}</span>
                </div>
                <TodoList items={profileTodos} />
              </div>
            )}
          </section>

          <div className="stack dash-side">
            {p.listed && (
              <section className="card dash-card" aria-labelledby="pour-vous">
                <h2 id="pour-vous" className="dash-title">{t("Pour vous")}</h2>
                {suggested.length === 0 ? (
                  <p className="muted">{t("Aucun appel ouvert pour le moment.")}</p>
                ) : (
                  suggested.map((c) => (
                    <Link key={c.id} href={`/opportunites/${c.id}`} className="suggest-card">
                      <span className="suggest-kind">{c.specialty || t(collabType(c.typeId)?.label ?? "")}</span>
                      <strong>{c.title}</strong>
                      <span>{c.organization.name}{c.event ? ` · ${t("intervention le {date}", { date: fmtDate(locale, c.event.startsAt) })}` : ""}{c.deadline ? ` · ${t("jusqu'au {date}", { date: fmtDate(locale, c.deadline) })}` : ""}</span>
                    </Link>
                  ))
                )}
                <MoreLink href="/opportunites">{t("Tous les appels à candidatures")}</MoreLink>
              </section>
            )}
            <section className="card dash-card" aria-labelledby="mon-agenda">
              <h2 id="mon-agenda" className="dash-title">{t("Mon agenda")}</h2>
              <Timeline items={agenda} empty={t("Aucun événement à venir.")} />
              <MoreLink href="/evenements">{t("Parcourir les événements")}</MoreLink>
            </section>
          </div>
        </div>
      </main>
    </>
  );
}
