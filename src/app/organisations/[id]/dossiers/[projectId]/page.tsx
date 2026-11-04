import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarDays, Clock, Euro, Scale, Sparkles, User, Users, Wallet } from "lucide-react";
import { aiEnabled } from "@/lib/ai";
import { Avatar } from "@/components/Avatar";
import { SiteHeader } from "@/components/SiteHeader";
import { FmvBadge, Pipeline, StatusPill, Thread } from "@/components/ProjectBits";
import { MessageForm } from "@/components/ProjectForms";
import { AddExpertForm, ExpertTermsForm, ProjectObjectForm } from "@/components/DossierForms";
import { canSee, kolVisibility } from "@/lib/visibility";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/orgs";
import { COMPLIANCE_ROLES, formatDate, formatDateTime, formatEUR, parisToday } from "@/lib/events";
import { collabType, needsMeeting, PROJECT_ROLES, PROJECT_VIEW_ROLES, projectEditable, recruitmentOpen, REVIEW_ROLES, STATUS_LABEL, TRANSITIONS, type TransitionKey } from "@/lib/projects";
import { storageEnabled } from "@/lib/storage";
import { advanceProject } from "@/lib/project-actions";
import { markExpertPaid } from "@/lib/revenue-actions";
import { expertSplit } from "@/lib/indicators";
import { BudgetPanel, ConflictsPanel, ConventionSignatureBlock, DocumentsPanel, MaterialsPanel } from "@/components/DossierSections";
import { missingSignedConventions } from "@/lib/project-documents";
import { FOUR_EYES_BLOCKED, FOUR_EYES_JUSTIFY, fourEyes, projectAuthors } from "@/lib/four-eyes";
import { RFQ_STATUS, rfqDisplayStatus, supplierCategoryLabel } from "@/lib/suppliers";
import type { ProjectStatus } from "@/generated/prisma/client";
import { complianceSettings, projectRegime, REGIME_LABEL } from "@/lib/compliance";
import { country, foreignObligations, practicesInFrance } from "@/lib/countries";
import { drPrefix } from "@/lib/professions";
import { AiReview } from "@/components/AiReview";
import { signatureEnabled } from "@/lib/yousign";
import { engagementBlock } from "@/lib/billing";

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
  "signature.send": "Convention envoyée en signature électronique",
  "signature.done": "Convention signée électroniquement",
  "signature.declined": "Signature électronique refusée",
  "signature.expired": "Demande de signature électronique expirée",
  "signature.canceled": "Demande de signature électronique annulée",
  "project.submit": "Soumis à la conformité",
  "project.validate": "Validé par la conformité",
  "project.block": "Bloqué par la conformité",
  "project.revise": "Dossier repris après blocage",
  "project.back_to_accord": "Retour en accord de principe",
  "project.abandon": "Dossier abandonné",
  "project.edit": "Objet du dossier modifié",
  "project.terms": "Nouvelle proposition envoyée à un expert",
  "project.add_expert": "Expert ajouté au dossier",
  "project.accept_proposal": "Proposition de l'expert acceptée",
  "project.decline_proposal": "Proposition de l'expert déclinée",
  "project.ordre": "Autorisation demandée à l'Ordre",
  "project.declaration": "Déclaration simple : convention à signer",
  "project.hors_france": "Hors France : obligations du pays vérifiées, convention à signer",
  "project.ordre_ok": "Autorisation de l'Ordre obtenue",
  "project.ordre_ko": "Autorisation de l'Ordre refusée",
  "project.signed": "Convention signée",
  "project.done": "Prestation réalisée",
  "project.publish": "Publié sur Transparence Santé",
  "project.unpublish": "Publication sur Transparence Santé annulée",
  "ai.review": "Relecture assistée demandée",
  "expert.paid": "Honoraires marqués payés",
  "expert.unpaid": "Paiement des honoraires annulé",
  "document.upload": "Document ajouté",
  "document.signed_convention": "Convention signée déposée",
  "document.delete": "Document supprimé",
  "signature.ongoing": "Signature électronique en cours",
  "signature.draft": "Envoi en signature électronique inachevé",
  "signature.closed": "Demande de signature électronique close",
  "transparency.report": "Erreur signalée par l'expert sur sa déclaration Transparence Santé",
};

/** Ce qu'il reste à faire, selon l'étape : affiché en tête de la colonne de droite. */
const NEXT_HINT: Partial<Record<ProjectStatus, string>> = {
  ATT_EXPERTS: "Les experts sollicités répondent depuis leur espace. Dès qu'un expert donne son accord de principe, le dossier peut être monté.",
  ATT_IND: "Proposition spontanée d'un expert : acceptez-la pour ouvrir le circuit, ou déclinez-la.",
  ACCORD: "Vérifiez les honoraires, les supports et le budget, puis soumettez le dossier à la conformité.",
  EN_VALID: "La conformité contrôle le dossier : elle le valide, ou le bloque avec un commentaire.",
  BLOQUE: "Reprenez le dossier pour le corriger selon le commentaire de la conformité (objet, conditions des experts), puis soumettez-le à nouveau.",
  VALIDE: "Effectuez la démarche EPS adaptée au régime (déclaration ou autorisation), puis passez en signature.",
  ORDRE: "Demande d'autorisation transmise : indiquez la réponse de l'Ordre dès réception.",
  SIGNATURE: "Faites signer la convention de chaque expert engagé, électroniquement ou en déposant le PDF signé.",
  SIGNE: "Une fois la prestation réalisée, clôturez le dossier : il rejoint les déclarations Transparence Santé.",
  TERMINE: "Prestation réalisée. Le dossier figure dans les déclarations Transparence Santé de l'organisation.",
  DECLINE: "Dossier clos : décliné ou abandonné.",
  REFUS_ORDRE: "Autorisation refusée : revoyez les conditions avec les experts ou abandonnez le dossier.",
};
const DANGER: TransitionKey[] = ["abandon", "block", "ordre_ko", "decline_proposal", "back_to_accord"];


export default async function Page({ params, searchParams }: { params: Promise<{ id: string; projectId: string }>; searchParams: Promise<{ modifier?: string }> }) {
  const { id, projectId } = await params;
  const { modifier } = await searchParams;
  const { org, roles, user } = await requireMembership(id, PROJECT_VIEW_ROLES);
  const project = await db.project.findFirst({
    where: { id: projectId, organizationId: id },
    include: {
      experts: {
        include: {
          practitioner: { include: { user: { select: { firstName: true, lastName: true } } } },
          signature: true,
          documents: { where: { kind: "CONVENTION_SIGNEE" }, select: { id: true }, take: 1 },
          feeNote: { select: { id: true, number: true, totalCents: true, vatBp: true, issuedAt: true } },
          messages: { include: { author: { select: { firstName: true, lastName: true } } }, orderBy: { createdAt: "asc" } },
        },
        orderBy: { createdAt: "asc" },
      },
      expenses: { select: { amountCents: true } },
      events: {
        orderBy: { startsAt: "asc" },
        include: { rfqs: { include: { quotes: { select: { status: true, amountCents: true } } } } },
      },
    },
  });
  if (!project) notFound();
  const linkIds = project.experts.map((e) => e.id);
  const [history, owner, fromCall] = await Promise.all([
    db.auditLog.findMany({
      where: { OR: [{ entityType: "Project", entityId: projectId }, { entityType: "ProjectExpert", entityId: { in: linkIds } }] },
      include: { actor: { select: { firstName: true, lastName: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    project.createdById ? db.user.findUnique({ where: { id: project.createdById }, select: { firstName: true, lastName: true } }) : null,
    // Dossier né d'une candidature à un appel rattaché à un événement : l'intervention a lieu à cet événement.
    db.application.findFirst({
      where: { projectId, openCall: { organizationId: id } },
      select: { openCall: { select: { id: true, title: true, event: { select: { id: true, title: true, startsAt: true, city: true } } } } },
    }),
  ]);
  const callEvent = fromCall?.openCall.event ?? null;

  const type = collabType(project.typeId);
  const isProject = roles.some((r) => PROJECT_ROLES.includes(r));
  const isCompliance = roles.some((r) => COMPLIANCE_ROLES.includes(r));
  const settings = complianceSettings(org.complianceSettings);
  const regime = projectRegime(settings, type?.unit ?? "", project.experts.map((e) => ({ ...e, country: e.practitioner.country })));
  const foreignExperts = project.experts.filter((e) => e.status !== "DECLINE" && !practicesInFrance(e.practitioner.country));
  const unsigned = project.status === "SIGNATURE" ? await missingSignedConventions(projectId) : [];
  // Sans stockage de documents, la convention signée ne peut pas être déposée : une attestation explicite est demandée.
  const attestable = unsigned.length > 0 && !storageEnabled();
  const attester = project.signatureAttestedById ? await db.user.findUnique({ where: { id: project.signatureAttestedById }, select: { firstName: true, lastName: true } }) : null;
  const closed = !recruitmentOpen(project.status);
  // Modification (objet, conditions, ajout d'un expert) pendant le recrutement ; le retour en accord de principe
  // n'est plus possible une fois une convention en signature ou signée.
  const editable = isProject && projectEditable(project.status);
  const signStarted = ["VALIDE", "ORDRE", "REFUS_ORDRE", "SIGNATURE"].includes(project.status)
    ? (await db.conventionSignature.count({ where: { projectExpert: { projectId }, status: { in: ["ongoing", "done"] } } })) + (await db.document.count({ where: { projectId, kind: "CONVENTION_SIGNEE" } })) > 0
    : false;
  const candidates = editable
    ? await db.practitionerProfile.findMany({
        where: { listed: true, id: { notIn: project.experts.map((e) => e.practitionerId) } },
        include: { user: { select: { firstName: true, lastName: true } } },
        orderBy: { user: { lastName: "asc" } },
        take: 500,
      })
    : [];
  // Contrôle à quatre yeux : qui a monté ou soumis le dossier ne le valide pas seul.
  const fourEyesRule = project.status === "EN_VALID" && isCompliance ? await fourEyes(await projectAuthors(projectId), id, user.id, COMPLIANCE_ROLES) : "ok";
  const available = (Object.keys(TRANSITIONS) as TransitionKey[]).filter((k) => {
    const t = TRANSITIONS[k];
    // Au-delà d'un seuil, la déclaration simple n'est pas possible : seule la demande d'autorisation est proposée.
    if (k === "declaration" && (regime?.regime === "autorisation" || regime?.regime === "hors_france")) return false;
    // Experts exerçant tous hors de France : ni déclaration ni autorisation EPS, une étape dédiée.
    if (k === "ordre" && regime?.regime === "hors_france") return false;
    if (k === "hors_france" && regime?.regime !== "hors_france") return false;
    // « Convention signée » attend la convention signée (ou la signature électronique) de chaque expert engagé ;
    // sans stockage configuré, l'étape reste proposée mais exige une attestation.
    if (k === "signed" && unsigned.length > 0 && !attestable) return false;
    if (k === "validate" && fourEyesRule === "blocked") return false;
    if (k === "back_to_accord" && signStarted) return false;
    return (t.from as readonly string[]).includes(project.status) && (t.roles === "compliance" ? isCompliance : isProject);
  }).sort((a, b) => Number(DANGER.includes(a)) - Number(DANGER.includes(b)));
  const needsNote = (k: TransitionKey) => k === "block" || k === "validate" || k === "ordre" || k === "abandon";
  const notePlaceholder = (k: TransitionKey) => (k === "ordre" ? "Référence de la demande" : k === "validate" && fourEyesRule === "justify" ? "Justification (obligatoire)" : k === "block" ? "Motif du blocage (obligatoire)" : k === "abandon" ? "Motif de l'abandon (obligatoire)" : "Commentaire (facultatif)");

  // Engagé = experts ayant accepté ; les honoraires proposés sans réponse sont indiqués à part (même définition
  // dans le budget plus bas).
  const live = project.experts.filter((e) => e.status !== "DECLINE");
  const { engaged, proposed: waiting, engagedCents: total, proposedCents: proposed } = expertSplit(project.experts, !closed);
  const supplierCents = project.events.flatMap((ev) => ev.rfqs.flatMap((r) => r.quotes)).filter((q) => q.status === "retained").reduce((s, q) => s + q.amountCents, 0);
  const spent = total + project.expenses.reduce((s, e) => s + e.amountCents, 0) + supplierCents;
  // Dossier terminé ou abandonné : plus d'événement à créer ; un dossier né d'un appel renvoie à l'événement de l'appel.
  const finished = project.status === "TERMINE" || project.status === "DECLINE";
  const showLogistics = project.events.length > 0 || (!finished && (needsMeeting(project.typeId) || !!callEvent));
  const budgetPct = project.budgetCents ? Math.round((spent / project.budgetCents) * 100) : null;
  const recent = history.slice(0, 8);
  const older = history.slice(8);

  const historyItem = (h: (typeof history)[number]) => {
    const d = h.data as { to?: string; note?: string; title?: string; name?: string; ref?: string; version?: number; selfValidated?: boolean } | null;
    // Jamais de code technique : libellé connu, sinon l'étape atteinte, sinon une mention générique.
    const what = d?.title ?? d?.name;
    const label = ACTION_LABEL[h.action]
      ? `${ACTION_LABEL[h.action]}${what ? ` : ${what}${d?.version ? ` (v${d.version})` : ""}` : ""}${d?.ref ? ` (réf. ${d.ref})` : ""}`
      : d?.to ? `Étape : ${STATUS_LABEL[d.to as keyof typeof STATUS_LABEL] ?? "mise à jour"}` : "Mise à jour du dossier";
    return (
      <li key={h.id}>
        <div>
          <span>{label}{d?.note ? ` — ${d.note}` : ""}{d?.selfValidated ? " (validé par son auteur, seul habilité : justification conservée)" : ""}</span>
          <span className="when">{h.createdAt.toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "short" })} · {h.actor ? `${h.actor.firstName} ${h.actor.lastName}` : "système"}</span>
        </div>
      </li>
    );
  };

  return (
    <>
      <SiteHeader />
      <main className="stack">
        <p className="muted"><Link href={`/organisations/${id}`}>{org.name}</Link> / <Link href={`/organisations/${id}/dossiers`}>Dossiers</Link></p>

        <header className="page-hero">
          <div className="hero-top">
            <span className="eyebrow-sm">{type?.label ?? project.typeId}{project.therapeuticArea ? ` · ${project.therapeuticArea}` : ""}</span>
            <StatusPill status={project.status} />
          </div>
          <h1>{project.title}</h1>
          {project.description && <p className="lead">{project.description}</p>}
          <dl className="hero-facts">
            <div>
              <dt><Users size={13} /> Experts</dt>
              <dd>{engaged.length} engagé{engaged.length > 1 ? "s" : ""}<small>{waiting.length ? `${waiting.length} réponse${waiting.length > 1 ? "s" : ""} attendue${waiting.length > 1 ? "s" : ""}` : `${live.length} sollicité${live.length > 1 ? "s" : ""}`}</small></dd>
            </div>
            <div>
              <dt><Euro size={13} /> Honoraires engagés</dt>
              <dd>{formatEUR(total)} HT<small>{proposed > 0 ? `${formatEUR(proposed)} HT proposés, sans réponse` : "honoraires acceptés"}</small></dd>
            </div>
            <div>
              <dt><Wallet size={13} /> Budget</dt>
              <dd>{project.budgetCents != null ? `${formatEUR(project.budgetCents)} HT` : "Non défini"}<small>{budgetPct != null ? `${budgetPct} % engagé${supplierCents ? ", prestataires compris" : ""}${proposed > 0 ? ` ; ${formatEUR(proposed)} HT proposés en plus` : ""}` : "à renseigner plus bas"}</small></dd>
            </div>
            <div>
              <dt><Scale size={13} /> Régime</dt>
              <dd>{regime ? REGIME_LABEL[regime.regime] : "À déterminer"}<small>{regime ? regime.reason : "selon les experts engagés"}</small></dd>
            </div>
            <div>
              <dt><User size={13} /> Responsable</dt>
              <dd>{owner ? `${owner.firstName} ${owner.lastName}` : "—"}<small>ouvert le {formatDate(project.createdAt)}</small></dd>
            </div>
          </dl>
          <Pipeline status={project.status} />
        </header>

        {project.status === "ATT_IND" && <p className="notice warn">Proposition spontanée de l&apos;expert : acceptez-la pour ouvrir le circuit, ou déclinez-la.</p>}

        <div className="page-grid">
          <div className="page-main">
            <section className="stack-sm">
              <div className="block-head">
                <h2>Experts</h2>
                <span className="muted text-sm">{engaged.length} engagé{engaged.length > 1 ? "s" : ""} sur {project.experts.length} sollicité{project.experts.length > 1 ? "s" : ""}</span>
              </div>
              {project.experts.length === 0 && <div className="card empty"><p className="muted">Aucun expert sollicité pour l&apos;instant.</p></div>}
              {project.experts.map((e) => {
                const name = `${drPrefix(e.practitioner.profession)}${e.practitioner.user.firstName} ${e.practitioner.user.lastName}`;
                const active = e.status !== "ATT_EXPERTS" && e.status !== "DECLINE";
                const last = e.messages.at(-1);
                const toAnswer = last && last.authorId === e.practitioner.userId;
                const earlier = e.messages.slice(0, -2);
                return (
                  <section key={e.id} className={`card expert-card${e.status === "DECLINE" ? " muted-card" : ""}`}>
                    <div className="expert-head">
                      <Avatar name={name} size={44} />
                      <div className="who">
                        <h3><Link href={`/annuaire/${e.practitionerId}`}>{name}</Link></h3>
                        <div className="muted text-sm">
                          {[e.practitioner.specialty ?? e.practitioner.profession, e.practitioner.city, !practicesInFrance(e.practitioner.country) ? country(e.practitioner.country).name : null].filter(Boolean).join(" · ")}
                        </div>
                      </div>
                      <span className={`pill ${e.status === "DECLINE" ? "done" : e.status === "ATT_EXPERTS" ? "wait" : "ok"}`}>
                        {e.status === "ATT_EXPERTS" ? (closed ? "Sans réponse, recrutement clos" : "Réponse attendue") : e.status === "DECLINE" ? "A décliné" : STATUS_LABEL[e.status]}
                      </span>
                    </div>
                    <div className="terms">
                      <span className="term"><CalendarDays size={13} /> {e.days ?? "—"} {type?.unit ?? "unité"}{(e.days ?? 0) > 1 ? "s" : ""}</span>
                      <span className="term"><Euro size={13} /> {e.feeCents != null ? formatEUR(e.feeCents) : "—"} HT</span>
                      <FmvBadge typeId={project.typeId} feeCents={e.feeCents} units={e.days} />
                      {e.desiredFeeCents != null && <span className="term desired"><Euro size={13} /> Souhaités par l&apos;expert : {formatEUR(e.desiredFeeCents)} HT</span>}
                    </div>
                    {active && (
                      <div className="expert-docs">
                        <span className="actions">
                          <a className="btn ghost small" href={`/organisations/${id}/dossiers/${projectId}/convention/${e.id}`} target="_blank" rel="noreferrer">
                            Convention (PDF)
                          </a>
                          <a className="link" href={`/organisations/${id}/dossiers/${projectId}/convention/${e.id}?lang=en`} target="_blank" rel="noreferrer" title="Traduction de courtoisie : la version française fait foi">
                            version anglaise
                          </a>
                        </span>
                        <ConventionSignatureBlock orgId={id} linkId={e.id} signature={e.signature} projectStatus={project.status} canSend={isProject} deposited={e.documents.length > 0} />
                      </div>
                    )}
                    {active && ["SIGNE", "TERMINE"].includes(e.status) && (
                      <div className="payment-row">
                        {e.paidAt ? (
                          <>
                            <span className="pill ok">Honoraires payés le {formatDate(e.paidAt)} · {formatEUR(e.paidCents ?? 0)} HT</span>
                            {isProject && (
                              <form action={markExpertPaid}>
                                <input type="hidden" name="orgId" value={id} /><input type="hidden" name="linkId" value={e.id} /><input type="hidden" name="undo" value="1" />
                                <button className="link">Annuler</button>
                              </form>
                            )}
                          </>
                        ) : isProject ? (
                          <form action={markExpertPaid} className="inline wrap">
                            <input type="hidden" name="orgId" value={id} /><input type="hidden" name="linkId" value={e.id} />
                            <span className="text-sm">Paiement des honoraires</span>
                            <input name="amount" inputMode="decimal" defaultValue={e.feeCents != null ? String(e.feeCents / 100) : ""} aria-label="Montant payé (€ HT)" />
                            <input name="date" type="date" defaultValue={parisToday()} max={parisToday()} aria-label="Date du paiement" />
                            <button className="btn ghost small">Marquer payé</button>
                          </form>
                        ) : (
                          <span className="pill wait">Honoraires à payer</span>
                        )}
                        {e.feeNote ? (
                          <a className="fee-note-link" href={`/notes-honoraires/${e.feeNote.id}`}>Note d&apos;honoraires {e.feeNote.number} · {formatEUR(e.feeNote.totalCents)} {e.feeNote.vatBp ? "TTC" : "(TVA non applicable)"}</a>
                        ) : (
                          <span className="text-xs muted">Note d&apos;honoraires : pas encore établie par l&apos;expert (depuis « Mes revenus »).</span>
                        )}
                      </div>
                    )}
                    <div className="exchanges">
                      <div className="exchanges-head">
                        <span className="label">Échanges{e.messages.length ? ` (${e.messages.length})` : ""}</span>
                        {toAnswer && e.status !== "DECLINE" && <span className="pill electric">À vous de répondre</span>}
                        {last && <span className="muted text-xs">dernier message le {formatDateTime(last.createdAt)}</span>}
                      </div>
                      {earlier.length > 0 && (
                        <details className="older">
                          <summary>Afficher {earlier.length > 1 ? `les ${earlier.length} messages précédents` : "le message précédent"}</summary>
                          <Thread messages={earlier} meId={user.id} />
                        </details>
                      )}
                      <Thread messages={e.messages.slice(-2)} meId={user.id} />
                      {e.status !== "DECLINE" && <MessageForm linkId={e.id} />}
                    </div>
                  </section>
                );
              })}
            </section>

            {editable && (
              <details className="card edit-block" id="modifier" open={modifier === "1"}>
                <summary><h2>Modifier le dossier</h2></summary>
                <div className="stack">
                  <p className="hint">Tant que le dossier n&apos;est pas soumis à la conformité, vous pouvez en modifier l&apos;objet et les conditions de chaque expert, ou solliciter un expert de plus. Des unités ou des honoraires modifiés renvoient la proposition à l&apos;expert : sa réponse est de nouveau attendue.</p>
                  <ProjectObjectForm orgId={id} projectId={projectId} title={project.title} area={project.therapeuticArea ?? ""} description={project.description ?? ""} />
                  {project.experts.length > 0 && (
                    <div className="stack-sm">
                      <h3>Conditions proposées</h3>
                      {project.experts.map((e) => (
                        <ExpertTermsForm
                          key={`${e.id}-${e.feeCents}-${e.days}`}
                          orgId={id} projectId={projectId} linkId={e.id}
                          name={`${drPrefix(e.practitioner.profession)}${e.practitioner.user.firstName} ${e.practitioner.user.lastName}${e.status === "DECLINE" ? " (a décliné)" : ""}`}
                          unit={type?.unit ?? "unité"}
                          units={e.days != null ? String(e.days).replace(".", ",") : ""}
                          fee={e.feeCents != null ? String(e.feeCents / 100).replace(".", ",") : ""}
                          desired={e.desiredFeeCents != null ? formatEUR(e.desiredFeeCents) : null}
                        />
                      ))}
                    </div>
                  )}
                  <div className="stack-sm">
                    <h3>Solliciter un autre expert</h3>
                    <AddExpertForm
                      orgId={id} projectId={projectId} unit={type?.unit ?? "unité"}
                      blocked={await engagementBlock(id, "sollicitation")}
                      experts={candidates.map((c) => {
                        const v = kolVisibility(c.visibility);
                        return {
                          id: c.id,
                          name: `${drPrefix(c.profession)}${c.user.firstName} ${c.user.lastName}`,
                          detail: [c.specialty || c.profession, canSee(v.contact, "membre") ? c.city : null].filter(Boolean).join(" · "),
                          dayRateCents: canSee(v.tarif, "membre") ? c.dayRateCents : null,
                        };
                      })}
                    />
                  </div>
                </div>
              </details>
            )}

            <MaterialsPanel orgId={id} projectId={projectId} canSubmit={isProject} canReview={roles.some((r) => REVIEW_ROLES.includes(r))} />
            <DocumentsPanel projectId={projectId} canUpload={isProject || isCompliance} openUpload={project.status === "SIGNATURE"} />
            <BudgetPanel orgId={id} projectId={projectId} canEdit={isProject} />

            <section className="card">
              <h2 className="section-title"><Clock size={15} /> Historique</h2>
              {history.length === 0 ? <p className="muted">Aucune action enregistrée.</p> : (
                <>
                  <ol className="audit-trail">{recent.map(historyItem)}</ol>
                  {older.length > 0 && (
                    <details className="older">
                      <summary>Voir les {older.length} actions précédentes</summary>
                      <ol className="audit-trail">{older.map(historyItem)}</ol>
                    </details>
                  )}
                </>
              )}
            </section>
          </div>

          <aside className="page-aside">
            <section className="card next-step">
              <span className="eyebrow-sm">Prochaine étape</span>
              <p className="next-hint">{NEXT_HINT[project.status]}</p>
              {project.status === "EN_VALID" && !isCompliance && <p className="hint">En attente de l&apos;équipe Conformité.</p>}
              {fourEyesRule === "blocked" && <p className="notice warn">{FOUR_EYES_BLOCKED}</p>}
              {fourEyesRule === "justify" && <p className="hint">{FOUR_EYES_JUSTIFY}</p>}
              {available.length > 0 && (
                <div className="transitions-stack">
                  {available.map((k) => (
                    <form key={k} action={advanceProject} className={`transition${DANGER.includes(k) ? " secondary" : ""}`}>
                      <input type="hidden" name="orgId" value={id} />
                      <input type="hidden" name="projectId" value={projectId} />
                      <input type="hidden" name="transition" value={k} />
                      {needsNote(k) && <input name="note" aria-label={notePlaceholder(k)} placeholder={notePlaceholder(k)} required={k === "block" || k === "abandon" || (k === "validate" && fourEyesRule === "justify")} />}
                      {k === "signed" && attestable && (
                        <label className="check text-sm">
                          <input type="checkbox" name="attest" value="1" required /> J&apos;atteste que la convention de {unsigned.join(", ")} est signée par les deux parties et conservée par l&apos;organisation.
                        </label>
                      )}
                      <button className={DANGER.includes(k) ? "btn ghost" : "btn"}>{TRANSITIONS[k].label}</button>
                    </form>
                  ))}
                </div>
              )}
              {signStarted && isProject && (
                <p className="hint">Une convention est en cours de signature ou déjà signée : le retour en accord de principe n&apos;est plus possible. Si les conditions doivent changer, abandonnez le dossier (motif obligatoire) et ouvrez-en un nouveau.</p>
              )}
              {unsigned.length > 0 && !attestable && (
                <p className="hint">
                  Déposez la convention signée de {unsigned.join(", ")} (rubrique Documents){signatureEnabled() ? " ou faites-la signer électroniquement (fiche de l'expert)" : ""} pour passer le dossier en « Signé ».
                </p>
              )}
              {attestable && (
                <p className="hint">
                  Le dépôt de documents n&apos;est pas encore activé sur KolBase{signatureEnabled() ? " (la signature électronique reste possible depuis la fiche de l'expert)" : ""} : passer en « Signé » exige votre attestation, enregistrée à votre nom avec la date.
                </p>
              )}
            </section>

            {isCompliance && aiEnabled() && (
              <section className="card stack-sm">
                <h2 className="section-title"><Sparkles size={15} /> Relecture assistée</h2>
                <AiReview orgId={id} projectId={projectId} />
              </section>
            )}

            <section className="card stack-sm">
              <h2 className="section-title"><Scale size={15} /> Conformité</h2>
              {regime ? (
                <p className="text-sm">
                  Régime : <span className={`pill ${regime.regime === "autorisation" ? "wait" : regime.regime === "hors_france" ? "" : "ok"}`}>{REGIME_LABEL[regime.regime]}</span>{" "}
                  ({regime.reason}).{" "}
                  {regime.regime === "hors_france"
                    ? "Pas de démarche sur la plateforme EPS ; vérifiez les obligations du pays d'exercice avant la signature."
                    : regime.regime === "autorisation"
                      ? `Demande d'autorisation à adresser au moins ${settings.authorizationDays} jours avant l'exécution ; la déclaration simple n'est pas possible.`
                      : `Déclaration à effectuer au moins ${settings.declarationDays} jours ouvrables avant l'exécution. Si une hospitalité dépasse les seuils, demandez l'autorisation.`}
                </p>
              ) : <p className="muted text-sm">Le régime (déclaration ou autorisation) sera déterminé dès qu&apos;un expert aura accepté.</p>}
              {project.complianceNote && <p className={`notice ${project.status === "BLOQUE" ? "error" : "ok"}`}>Conformité : {project.complianceNote}</p>}
              {project.ordreRef && <p className="muted text-sm">Demande à l&apos;Ordre : {project.ordreRef}</p>}
              {project.signatureAttestedAt && (
                <p className="notice warn">
                  Signature attestée par {attester ? `${attester.firstName} ${attester.lastName}` : "un membre de l'organisation"} le {project.signatureAttestedAt.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" })} : convention signée conservée hors de KolBase, non déposée.
                </p>
              )}
            </section>

            <ConflictsPanel projectId={projectId} />

            {foreignExperts.length > 0 && (
              <section className="card stack-sm">
                <h2 className="section-title">Experts exerçant hors de France</h2>
                {foreignExperts.map((e) => (
                  <div key={e.id}>
                    <strong>{drPrefix(e.practitioner.profession)}{e.practitioner.user.firstName} {e.practitioner.user.lastName}</strong> · {country(e.practitioner.country).name}
                    <ul className="text-sm">{foreignObligations(e.practitioner.country).map((o) => <li key={o}>{o}</li>)}</ul>
                  </div>
                ))}
                <p className="text-xs muted">Repères donnés à titre indicatif, à faire valider par votre service juridique.</p>
              </section>
            )}

            {showLogistics && <section className="card stack-sm">
              <h2 className="section-title"><CalendarDays size={15} /> Événement et logistique</h2>
              {project.events.length === 0 && callEvent ? (
                <div className="stack-sm">
                  <p className="muted text-sm">Dossier né de l&apos;appel à candidatures « {isProject ? <Link href={`/organisations/${id}/opportunites/${fromCall!.openCall.id}`}>{fromCall!.openCall.title}</Link> : fromCall!.openCall.title} » : l&apos;intervention a lieu à cet événement, où se gèrent la logistique et les devis.</p>
                  <ul className="linked-events">
                    <li>
                      <Link href={`/organisations/${id}/evenements/${callEvent.id}`}><strong>{callEvent.title}</strong></Link>
                      <span className="muted text-xs">{formatDateTime(callEvent.startsAt)}{callEvent.city ? ` · ${callEvent.city}` : ""}</span>
                    </li>
                  </ul>
                </div>
              ) : project.events.length === 0 ? (
                <p className="muted text-sm">Réunion, formation ou symposium : créez l&apos;événement rattaché au dossier pour consulter les prestataires (salle, traiteur, hébergement, transport) et comparer leurs devis.</p>
              ) : (
                <ul className="linked-events">
                  {project.events.map((ev) => {
                    const answered = ev.rfqs.filter((r) => r.quotes.length > 0).length;
                    return (
                      <li key={ev.id}>
                        <Link href={`/organisations/${id}/evenements/${ev.id}`}><strong>{ev.title}</strong></Link>
                        <span className="muted text-xs">{formatDateTime(ev.startsAt)}{ev.city ? ` · ${ev.city}` : ""}</span>
                        {ev.rfqs.length === 0 ? <span className="text-xs muted">Aucune demande de devis</span> : (
                          <span className="chips">
                            {ev.rfqs.map((r) => { const st = RFQ_STATUS[rfqDisplayStatus(r)]; return <span key={r.id} className={`pill ${st.tone}`}>{supplierCategoryLabel(r.category)} · {st.label}</span>; })}
                          </span>
                        )}
                        {ev.rfqs.length > 0 && <span className="text-xs muted">{answered} demande{answered > 1 ? "s" : ""} avec devis sur {ev.rfqs.length}</span>}
                      </li>
                    );
                  })}
                </ul>
              )}
              {isProject && !finished && (project.events[0] || !callEvent) && (
                <Link className="btn ghost small" href={project.events[0] ? `/organisations/${id}/prestataires?onglet=nouvelle&evenement=${project.events[0].id}` : `/organisations/${id}/evenements/nouveau?dossier=${projectId}`}>
                  {project.events[0] ? "Demander des devis" : "Créer l'événement du dossier"}
                </Link>
              )}
              {callEvent && project.events.length === 0 && <Link className="btn ghost small" href={`/organisations/${id}/evenements/${callEvent.id}`}>Voir l&apos;événement</Link>}
            </section>}
          </aside>
        </div>
      </main>
    </>
  );
}
