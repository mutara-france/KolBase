import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { FmvBadge, Pipeline, StatusPill, Thread } from "@/components/ProjectBits";
import { MessageForm } from "@/components/ProjectForms";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/orgs";
import { COMPLIANCE_ROLES, formatEUR } from "@/lib/events";
import { collabType, PROJECT_ROLES, PROJECT_VIEW_ROLES, STATUS_LABEL, TRANSITIONS, type TransitionKey } from "@/lib/projects";
import { advanceProject } from "@/lib/project-actions";
import { BudgetPanel, ConflictsPanel, DocumentsPanel, MaterialsPanel } from "@/components/DossierSections";
import { missingSignedConventions } from "@/lib/project-documents";
import { REVIEW_ROLES } from "@/lib/projects";
import { complianceSettings, projectRegime, REGIME_LABEL } from "@/lib/compliance";
import { country, foreignObligations, practicesInFrance } from "@/lib/countries";
import { drPrefix } from "@/lib/professions";

export const metadata = { title: "Dossier — KolBase" };

const ACTION_LABEL: Record<string, string> = {
  "project.create": "Dossier créé",
  "solicitation.accept": "Accord de principe d'un expert",
  "solicitation.decline": "Un expert a décliné",
  "project.propose": "Proposition reçue de l'expert",
  "project.budget": "Budget modifié",
  "expense.add": "Dépense ajoutée",
  "expense.remove": "Dépense retirée",
  "material.submit": "Support soumis à la relecture",
  "material.approve": "Support approuvé",
  "material.changes": "Modifications demandées sur un support",
};

export default async function Page({ params }: { params: Promise<{ id: string; projectId: string }> }) {
  const { id, projectId } = await params;
  const { org, roles, user } = await requireMembership(id, PROJECT_VIEW_ROLES);
  const project = await db.project.findFirst({
    where: { id: projectId, organizationId: id },
    include: {
      experts: {
        include: {
          practitioner: { include: { user: { select: { firstName: true, lastName: true } } } },
          messages: { include: { author: { select: { firstName: true, lastName: true } } }, orderBy: { createdAt: "asc" } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!project) notFound();
  const linkIds = project.experts.map((e) => e.id);
  const history = await db.auditLog.findMany({
    where: { OR: [{ entityType: "Project", entityId: projectId }, { entityType: "ProjectExpert", entityId: { in: linkIds } }] },
    include: { actor: { select: { firstName: true, lastName: true } } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const type = collabType(project.typeId);
  const isProject = roles.some((r) => PROJECT_ROLES.includes(r));
  const isCompliance = roles.some((r) => COMPLIANCE_ROLES.includes(r));
  const settings = complianceSettings(org.complianceSettings);
  const regime = projectRegime(settings, type?.unit ?? "", project.experts.map((e) => ({ ...e, country: e.practitioner.country })));
  const foreignExperts = project.experts.filter((e) => e.status !== "DECLINE" && !practicesInFrance(e.practitioner.country));
  const unsigned = project.status === "SIGNATURE" ? await missingSignedConventions(projectId) : [];
  const available = (Object.keys(TRANSITIONS) as TransitionKey[]).filter((k) => {
    const t = TRANSITIONS[k];
    // Au-delà d'un seuil, la déclaration simple n'est pas possible : seule la demande d'autorisation est proposée.
    if (k === "declaration" && (regime?.regime === "autorisation" || regime?.regime === "hors_france")) return false;
    // Experts exerçant tous hors de France : ni déclaration ni autorisation EPS, une étape dédiée.
    if (k === "ordre" && regime?.regime === "hors_france") return false;
    if (k === "hors_france" && regime?.regime !== "hors_france") return false;
    // Avec le stockage activé, « Convention signée » attend la convention signée de chaque expert engagé.
    if (k === "signed" && unsigned.length > 0) return false;
    return (t.from as readonly string[]).includes(project.status) && (t.roles === "compliance" ? isCompliance : isProject);
  });
  const needsNote = (k: TransitionKey) => k === "block" || k === "validate" || k === "ordre";
  const total = project.experts.filter((e) => e.status !== "DECLINE").reduce((s, e) => s + (e.feeCents ?? 0), 0);

  return (
    <>
      <SiteHeader />
      <main className="stack">
        <p className="muted"><Link href={`/organisations/${id}`}>{org.name}</Link> / <Link href={`/organisations/${id}/dossiers`}>Dossiers</Link></p>
        <div>
          <StatusPill status={project.status} />
          <h1>{project.title}</h1>
          <p className="muted">{type?.label ?? project.typeId}{project.therapeuticArea ? ` · ${project.therapeuticArea}` : ""} · engagement total {formatEUR(total)} HT</p>
        </div>
        <Pipeline status={project.status} />

        {project.complianceNote && <p className={`notice ${project.status === "BLOQUE" ? "error" : "ok"}`}>Conformité : {project.complianceNote}</p>}
        {project.ordreRef && <p className="muted">Demande à l&apos;Ordre : {project.ordreRef}</p>}

        {(available.length > 0 || unsigned.length > 0) && (
          <section className="card">
            <h2>Prochaine étape</h2>
            <div className="transitions">
              {available.map((k) => (
                <form key={k} action={advanceProject} className="inline">
                  <input type="hidden" name="orgId" value={id} />
                  <input type="hidden" name="projectId" value={projectId} />
                  <input type="hidden" name="transition" value={k} />
                  {needsNote(k) && <input name="note" placeholder={k === "ordre" ? "Réf. de la demande" : "Commentaire"} required={k === "block"} />}
                  <button className={k === "abandon" || k === "block" || k === "ordre_ko" ? "btn ghost" : "btn"}>{TRANSITIONS[k].label}</button>
                </form>
              ))}
            </div>
            {unsigned.length > 0 && (
              <p className="hint">Déposez la convention signée de {unsigned.join(", ")} (rubrique Documents) pour passer le dossier en « Signé ».</p>
            )}
            {project.status === "VALIDE" && regime?.regime === "hors_france" && (
              <p className="hint">
                Régime : <span className="pill">{REGIME_LABEL.hors_france}</span> ({regime.reason}). Pas de démarche sur la plateforme EPS ; vérifiez les obligations du pays d&apos;exercice ci-dessous avant la signature.
              </p>
            )}
            {project.status === "VALIDE" && regime && regime.regime !== "hors_france" && (
              <p className="hint">
                Régime : <span className={`pill ${regime.regime === "autorisation" ? "wait" : "ok"}`}>{REGIME_LABEL[regime.regime]}</span>{" "}
                ({regime.reason}).{" "}
                {regime.regime === "autorisation"
                  ? `Demande d'autorisation à adresser au moins ${settings.authorizationDays} jours avant l'exécution ; la déclaration simple n'est pas possible.`
                  : `Déclaration à effectuer au moins ${settings.declarationDays} jours ouvrables avant l'exécution.`}{" "}
                Si la convention prévoit aussi une hospitalité au-delà des seuils, demandez l&apos;autorisation.
              </p>
            )}
          </section>
        )}

        {foreignExperts.length > 0 && (
          <section className="card stack-sm">
            <h2>Experts exerçant hors de France</h2>
            {foreignExperts.map((e) => (
              <div key={e.id}>
                <strong>{drPrefix(e.practitioner.profession)}{e.practitioner.user.firstName} {e.practitioner.user.lastName}</strong> · {country(e.practitioner.country).name}
                <ul className="text-sm">{foreignObligations(e.practitioner.country).map((o) => <li key={o}>{o}</li>)}</ul>
              </div>
            ))}
            <p className="text-xs muted">Repères donnés à titre indicatif, à faire valider par votre service juridique.</p>
          </section>
        )}
        {project.status === "ATT_IND" && <p className="notice warn">Proposition spontanée de l&apos;expert : acceptez-la pour ouvrir le circuit, ou déclinez-la.</p>}
        {project.description && <section className="card"><h2>Objet</h2><p>{project.description}</p></section>}
        <ConflictsPanel projectId={projectId} />
        <MaterialsPanel orgId={id} projectId={projectId} canSubmit={isProject} canReview={roles.some((r) => REVIEW_ROLES.includes(r))} />
        <DocumentsPanel projectId={projectId} canUpload={isProject || isCompliance} />
        <BudgetPanel orgId={id} projectId={projectId} canEdit={isProject} />

        {project.experts.map((e) => (
          <section key={e.id} className="card">
            <div className="actions spread">
              <h2><Link href={`/annuaire/${e.practitionerId}`}>Dr {e.practitioner.user.firstName} {e.practitioner.user.lastName}</Link></h2>
              <span className={`pill ${e.status === "DECLINE" ? "done" : e.status === "ATT_EXPERTS" ? "wait" : "ok"}`}>
                {e.status === "ATT_EXPERTS" ? "Réponse attendue" : e.status === "DECLINE" ? "A décliné" : STATUS_LABEL[e.status]}
              </span>
            </div>
            <p className="muted">
              {e.days ?? "—"} {type?.unit ?? "unité"}{(e.days ?? 0) > 1 ? "s" : ""} · {e.feeCents != null ? formatEUR(e.feeCents) : "—"} HT{" "}
              <FmvBadge typeId={project.typeId} feeCents={e.feeCents} units={e.days} />
            </p>
            {e.status !== "ATT_EXPERTS" && e.status !== "DECLINE" && (
              <a className="btn ghost small" href={`/organisations/${id}/dossiers/${projectId}/convention/${e.id}`} target="_blank" rel="noreferrer">
                Convention (PDF)
              </a>
            )}
            <Thread messages={e.messages} meId={user.id} />
            {e.status !== "DECLINE" && <MessageForm linkId={e.id} />}
          </section>
        ))}

        <section className="card">
          <h2>Historique</h2>
          <ul className="history">
            {history.map((h) => {
              const d = h.data as { to?: string; note?: string } | null;
              const dm = h.data as { title?: string; version?: number } | null;
              const label = (ACTION_LABEL[h.action] ? ACTION_LABEL[h.action] + (dm?.title ? ` : ${dm.title}${dm.version ? ` (v${dm.version})` : ""}` : "") : null) ?? (d?.to ? `→ ${STATUS_LABEL[d.to as keyof typeof STATUS_LABEL] ?? d.to}` : h.action);
              return (
                <li key={h.id}>
                  <span className="muted">{h.createdAt.toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "short" })}</span>{" "}
                  {label}{d?.note ? ` — ${d.note}` : ""} <span className="muted">({h.actor ? `${h.actor.firstName} ${h.actor.lastName}` : "système"})</span>
                </li>
              );
            })}
          </ul>
        </section>
      </main>
    </>
  );
}
