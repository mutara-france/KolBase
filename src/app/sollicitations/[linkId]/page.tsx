import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { Pipeline, StatusPill, Thread } from "@/components/ProjectBits";
import { MessageForm, RespondForm } from "@/components/ProjectForms";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { formatEUR } from "@/lib/events";
import { collabType } from "@/lib/projects";
import { MaterialsPanel } from "@/components/DossierSections";

export const metadata = { title: "Sollicitation — Kolbase" };

export default async function Page({ params }: { params: Promise<{ linkId: string }> }) {
  const { linkId } = await params;
  const user = await requireUser();
  const link = await db.projectExpert.findFirst({
    where: { id: linkId, practitioner: { userId: user.id } },
    include: {
      project: { include: { organization: true } },
      messages: { include: { author: { select: { firstName: true, lastName: true } } }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!link) notFound();
  const p = link.project;
  const type = collabType(p.typeId);
  const abandoned = p.status === "DECLINE";

  return (
    <>
      <SiteHeader />
      <main className="narrow stack">
        <p className="muted"><Link href="/sollicitations">Mes sollicitations</Link></p>
        <div>
          <StatusPill status={abandoned ? "DECLINE" : p.status === "ATT_IND" ? "ATT_IND" : link.status} />
          <h1>{p.title}</h1>
          <p className="muted">{p.organization.name} · {type?.label ?? p.typeId}{p.therapeuticArea ? ` · ${p.therapeuticArea}` : ""}</p>
        </div>
        {link.status !== "ATT_EXPERTS" && link.status !== "DECLINE" && <Pipeline status={link.status} />}
        <section className="card">
          <dl className="facts">
            <dt>Prestation</dt><dd>{link.days ?? "—"} {type?.unit ?? "unité"}{(link.days ?? 0) > 1 ? "s" : ""}</dd>
            <dt>Honoraires proposés</dt><dd>{link.feeCents != null ? `${formatEUR(link.feeCents)} HT` : "—"}</dd>
            {type && <dt>Référence de marché</dt>}
            {type && <dd>{type.fmv[0].toLocaleString("fr-FR")} à {type.fmv[1].toLocaleString("fr-FR")} € HT par {type.unit}</dd>}
          </dl>
        </section>
        {link.status !== "ATT_EXPERTS" && link.status !== "DECLINE" && !abandoned && (
          <a className="btn ghost" href={`/sollicitations/${link.id}/convention`} target="_blank" rel="noreferrer">Projet de convention (PDF)</a>
        )}
        {p.description && <section className="card"><h2>Objet</h2><p>{p.description}</p></section>}
        {link.status === "ATT_EXPERTS" && !abandoned && (
          <section className="card highlight"><h2>Votre réponse</h2><RespondForm linkId={link.id} /></section>
        )}
        {abandoned && <p className="notice error">Ce dossier a été abandonné par l&apos;organisation.</p>}
        {!["ATT_EXPERTS", "DECLINE"].includes(link.status) && !abandoned && p.status !== "ATT_IND" && (
          <MaterialsPanel orgId={p.organizationId} projectId={p.id} canSubmit canReview={false} />
        )}
        <section className="card">
          <h2>Échanges avec {p.organization.name}</h2>
          <Thread messages={link.messages} meId={user.id} />
          {!abandoned && link.status !== "DECLINE" && <MessageForm linkId={link.id} />}
        </section>
      </main>
    </>
  );
}
