import Link from "next/link";
import { Globe2, Route } from "lucide-react";
import { PageHead, SectionHead } from "@/components/UI";
import { SiteHeader } from "@/components/SiteHeader";
import { ChannelForm, PerimeterForm } from "@/components/RoutingForms";
import { removeChannel } from "@/lib/routing-actions";
import { topicLabel } from "@/lib/routing";
import { requireMembership } from "@/lib/orgs";
import { PROJECT_ROLES } from "@/lib/projects";
import { country } from "@/lib/countries";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: `${t("Canaux de contact")} — KolBase` };
}

/**
 * Canaux de contact de l'organisation : par sujet (formation, recherche clinique, innovation…), le membre qui reçoit
 * les propositions des experts, son suppléant et le délai de réponse. Entité d'un groupe : pays couverts et marques.
 */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { t } = await getT();
  const { id } = await params;
  const { org } = await requireMembership(id, ["ADMIN"]);
  const [channels, team, group] = await Promise.all([
    db.contactChannel.findMany({ where: { organizationId: id }, orderBy: { createdAt: "asc" } }),
    db.membership.findMany({ where: { organizationId: id, role: { in: PROJECT_ROLES } }, select: { user: { select: { id: true, firstName: true, lastName: true } } }, distinct: ["userId"] }),
    org.groupId ? db.orgGroup.findUnique({ where: { id: org.groupId }, include: { entities: { where: { NOT: { id } }, select: { id: true, name: true, coveredCountries: true } } } }) : null,
  ]);
  const members = team.map((m) => ({ id: m.user.id, name: `${m.user.firstName} ${m.user.lastName}` }));
  const who = (uid: string | null) => members.find((m) => m.id === uid)?.name ?? t("ancien membre (à remplacer)");
  return (
    <>
      <SiteHeader />
      <main className="stack narrow">
        <p className="muted"><Link href={`/organisations/${id}/membres?onglet=organisation`}>{t("Membres et réglages")}</Link></p>
        <PageHead title={t("Canaux de contact")} desc={t("Les propositions des experts arrivent au membre en charge du sujet, qui reçoit l'e-mail et en devient responsable, avec un délai de réponse annoncé à l'expert. Sans canal pour un sujet : le canal « Autre sujet », sinon toute l'équipe Projets.")} />
        {group && (
          <section className="card stack-sm" aria-labelledby="perimetre-titre">
            <SectionHead icon={Globe2} id="perimetre-titre" title={t("Entité du groupe {name}", { name: group.name })} desc={t("Un expert qui propose un projet au groupe est aiguillé vers l'entité de son pays (et de la marque concernée).")} />
            {group.entities.length > 0 && (
              <p className="text-sm muted">{t("Autres entités : {list}", { list: group.entities.map((e) => `${e.name}${e.coveredCountries.length ? ` (${e.coveredCountries.map((c) => t(country(c).name)).join(", ")})` : ` (${t("siège")})`}`).join(" · ") })}</p>
            )}
            <PerimeterForm orgId={id} countries={org.coveredCountries.join(", ")} brands={org.brands.join(", ")} />
          </section>
        )}
        <section className="card stack-sm" aria-labelledby="canaux-titre">
          <SectionHead icon={Route} id="canaux-titre" title={t("Sujets et responsables")} />
          {channels.length === 0 && <p className="muted text-sm">{t("Aucun canal : les propositions arrivent à toute l'équipe Projets.")}</p>}
          {channels.map((c) => (
            <details key={c.id} className="disclosure">
              <summary><strong>{t(topicLabel(c.topic))}</strong> <span className="text-sm muted">· {who(c.ownerId)}{c.backupId ? ` · ${t("suppléant : {name}", { name: who(c.backupId) })}` : ""} · {t(c.responseDays > 1 ? "réponse sous {n} jours" : "réponse sous {n} jour", { n: c.responseDays })}</span></summary>
              <ChannelForm orgId={id} members={members} init={{ topic: c.topic, ownerId: c.ownerId, backupId: c.backupId ?? "", responseDays: c.responseDays, ipPolicy: c.ipPolicy ?? "" }} />
              <form action={removeChannel}>
                <input type="hidden" name="orgId" value={id} /><input type="hidden" name="channelId" value={c.id} />
                <button className="link danger">{t("Retirer ce canal")}</button>
              </form>
            </details>
          ))}
          <details className="disclosure" open={channels.length === 0}>
            <summary>{t("Ajouter un canal")}</summary>
            <ChannelForm orgId={id} members={members} />
          </details>
        </section>
      </main>
    </>
  );
}
