import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { Pipeline, StatusPill, Thread } from "@/components/ProjectBits";
import { MessageForm, RespondForm } from "@/components/ProjectForms";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { collabType } from "@/lib/projects";
import { DocumentsPanel, ExpertSignatureBlock, MaterialsPanel } from "@/components/DossierSections";
import { fmtEur, intlLocale } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: `${t("Sollicitation")} — KolBase` };
}

export default async function Page({ params }: { params: Promise<{ linkId: string }> }) {
  const { linkId } = await params;
  const user = await requireUser();
  const link = await db.projectExpert.findFirst({
    where: { id: linkId, practitioner: { userId: user.id } },
    include: {
      project: { include: { organization: true } },
      signature: true,
      messages: { include: { author: { select: { firstName: true, lastName: true } } }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!link) notFound();
  const p = link.project;
  const type = collabType(p.typeId);
  const abandoned = p.status === "DECLINE";
  const { t, locale } = await getT();
  const num = (n: number) => n.toLocaleString(intlLocale(locale));
  // Unité de prestation (« journée », « séance »…) : le pluriel français ajoute un « s », l'anglais a sa propre clé.
  const unit = type?.unit ?? "unité";
  const units = (link.days ?? 0) > 1 ? t(`${unit}s`) : t(unit);

  return (
    <>
      <SiteHeader />
      <main className="narrow stack">
        <p className="muted"><Link href="/sollicitations">{t("Mes sollicitations")}</Link></p>
        <div>
          <StatusPill status={abandoned ? "DECLINE" : p.status === "ATT_IND" ? "ATT_IND" : link.status} />
          <h1>{p.title}</h1>
          <p className="muted">{p.organization.name} · {type ? t(type.label) : p.typeId}{p.therapeuticArea ? ` · ${t(p.therapeuticArea)}` : ""}</p>
        </div>
        {link.status !== "ATT_EXPERTS" && link.status !== "DECLINE" && <Pipeline status={link.status} />}
        <section className="card">
          <dl className="facts">
            <dt>{t("Prestation")}</dt><dd>{link.days ?? "—"} {units}</dd>
            <dt>{t("Honoraires proposés")}</dt><dd>{link.feeCents != null ? t("{amount} HT", { amount: fmtEur(locale, link.feeCents) }) : "—"}</dd>
            {type && <dt>{t("Référence de marché")}</dt>}
            {type && <dd>{t("{min} à {max} € HT par {unit}", { min: num(type.fmv[0]), max: num(type.fmv[1]), unit: t(type.unit) })}</dd>}
          </dl>
        </section>
        {link.status !== "ATT_EXPERTS" && link.status !== "DECLINE" && !abandoned && (
          <a className="btn ghost" href={`/sollicitations/${link.id}/convention`} target="_blank" rel="noreferrer">{t("Projet de convention (PDF)")}</a>
        )}
        {link.status !== "ATT_EXPERTS" && link.status !== "DECLINE" && !abandoned && <ExpertSignatureBlock linkId={link.id} signature={link.signature} email={user.email} />}
        {p.description && <section className="card"><h2>{t("Objet")}</h2><p>{p.description}</p></section>}
        {link.status === "ATT_EXPERTS" && !abandoned && (
          <section className="card highlight"><h2>{t("Votre réponse")}</h2><RespondForm linkId={link.id} /></section>
        )}
        {abandoned && <p className="notice error">{t("Ce dossier a été abandonné par l'organisation.")}</p>}
        {!["ATT_EXPERTS", "DECLINE"].includes(link.status) && !abandoned && p.status !== "ATT_IND" && (
          <MaterialsPanel orgId={p.organizationId} projectId={p.id} canSubmit canReview={false} />
        )}
        {!["ATT_EXPERTS", "DECLINE"].includes(link.status) && !abandoned && <DocumentsPanel projectId={p.id} linkId={link.id} canUpload />}
        <section className="card">
          <h2>{t("Échanges avec {org}", { org: p.organization.name })}</h2>
          <Thread messages={link.messages} meId={user.id} />
          {!abandoned && link.status !== "DECLINE" && <MessageForm linkId={link.id} />}
        </section>
      </main>
    </>
  );
}
