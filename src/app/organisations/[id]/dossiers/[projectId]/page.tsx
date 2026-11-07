import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarDays, Clock, Euro, FileText, LayoutDashboard, Megaphone, MessagesSquare, Scale, Sparkles, User, Users, Wallet } from "lucide-react";
import { aiEnabled } from "@/lib/ai";
import { Avatar } from "@/components/Avatar";
import { SiteHeader } from "@/components/SiteHeader";
import { FmvBadge, Pipeline, StatusPill, Thread } from "@/components/ProjectBits";
import { MessageForm } from "@/components/ProjectForms";
import { RfqMessageForm } from "@/components/RfqForms";
import { DossierTabs, type DossierTab } from "@/components/DossierTabs";
import { EventWorkspace } from "@/components/EventWorkspace";
import { AddExpertForm, ExpertTermsForm, ProjectObjectForm } from "@/components/DossierForms";
import { canSee, kolViewer, kolVisibility } from "@/lib/visibility";
import { accountPhoto, expertPhotoSrc, photoPath } from "@/lib/expert-photo";
import { BillingNotice } from "@/components/BillingNotice";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/orgs";
import { COMPLIANCE_ROLES, parisToday } from "@/lib/events";
import { ACCOUNT_DELETED, PROPOSAL_ORIGIN, PROPOSAL_WITHDRAWN, collabType, eventTabOpen, needsMeeting, PROJECT_ROLES, PROJECT_VIEW_ROLES, projectEditable, recruitmentOpen, REVIEW_ROLES, STATUS_LABEL, TRANSITIONS, unitCount, type TransitionKey } from "@/lib/projects";
import { storageEnabled } from "@/lib/storage";
import { acceptCounterOffer, addProjectLead, advanceProject, removeProjectLead } from "@/lib/project-actions";
import { ConfirmButton } from "@/components/ConfirmButton";
import { markExpertPaid } from "@/lib/revenue-actions";
import { expertSplit } from "@/lib/indicators";
import { BudgetPanel, ConflictsPanel, ConventionSignatureBlock, DocumentsPanel, MaterialsPanel } from "@/components/DossierSections";
import { missingSignedConventions } from "@/lib/project-documents";
import { FOUR_EYES_BLOCKED, FOUR_EYES_JUSTIFY, fourEyes, projectAuthors } from "@/lib/four-eyes";
import { supplierCategoryLabel } from "@/lib/suppliers";
import type { ProjectStatus } from "@/generated/prisma/client";
import { complianceSettings, projectRegime, REGIME_LABEL, regimeReason } from "@/lib/compliance";
import { country, foreignObligations, practicesInFrance } from "@/lib/countries";
import { drPrefix } from "@/lib/professions";
import { AiReview } from "@/components/AiReview";
import { signatureEnabled } from "@/lib/yousign";
import { engagementBlock } from "@/lib/billing";
import { getT } from "@/lib/i18n/server";
import { fmtDate, fmtDateTime, fmtEur, intlLocale } from "@/lib/i18n";
import { feeLevels } from "@/lib/fee-fields";
import { fmtHours, hoursDetail, hoursOf } from "@/lib/fees";
import { daysLate, plannedDate, reviewDue, submissionDue } from "@/lib/deadlines";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: `${t("Dossier")} — KolBase` };
}

const ACTION_LABEL: Record<string, string> = {
  "project.create": "Dossier créé",
  "project.lead_add": "Responsable ajouté",
  "project.lead_remove": "Responsable retiré",
  "solicitation.accept": "Accord de principe d'un expert",
  "solicitation.decline": "Un expert a décliné",
  "solicitation.counter": "Un expert propose d'autres honoraires",
  "project.accept_counter": "Honoraires proposés par l'expert acceptés",
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
  "project.expert_removed": "Expert retiré du dossier (compte supprimé)",
  "project.edit": "Objet du dossier modifié",
  "project.terms": "Nouvelle proposition envoyée à un expert",
  "project.add_expert": "Expert ajouté au dossier",
  "project.accept_proposal": "Proposition de l'expert acceptée",
  "project.decline_proposal": "Proposition de l'expert déclinée",
  "project.withdraw_proposal": "Proposition retirée par l'expert",
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


export default async function Page({ params, searchParams }: { params: Promise<{ id: string; projectId: string }>; searchParams: Promise<{ modifier?: string; onglet?: string; fil?: string; evenement?: string; publie?: string }> }) {
  const { t, locale } = await getT();
  const { id, projectId } = await params;
  const { modifier, onglet, fil, evenement, publie } = await searchParams;
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
      _count: { select: { documents: true } },
    },
  });
  if (!project) notFound();
  const linkIds = project.experts.map((e) => e.id);
  const [history, leads, leadPool, fromCall, levels] = await Promise.all([
    db.auditLog.findMany({
      where: { OR: [{ entityType: "Project", entityId: projectId }, { entityType: "ProjectExpert", entityId: { in: linkIds } }] },
      include: { actor: { select: { firstName: true, lastName: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    // Responsables du dossier, et membres pouvant l'être (Administrateur ou Projets).
    db.projectLead.findMany({ where: { projectId }, include: { user: { select: { id: true, firstName: true, lastName: true, photoUpdatedAt: true } } }, orderBy: { createdAt: "asc" } }),
    db.membership.findMany({ where: { organizationId: id, role: { in: PROJECT_ROLES } }, select: { user: { select: { id: true, firstName: true, lastName: true } } }, distinct: ["userId"], orderBy: { createdAt: "asc" } }),
    // Dossier né d'une candidature à un appel rattaché à un événement : l'intervention a lieu à cet événement.
    db.application.findFirst({
      where: { projectId, openCall: { organizationId: id } },
      select: { openCall: { select: { id: true, title: true, event: { select: { id: true, title: true, startsAt: true, city: true } } } } },
    }),
    feeLevels(id),
  ]);
  const callEvent = fromCall?.openCall.event ?? null;

  const type = collabType(project.typeId);
  const isProject = roles.some((r) => PROJECT_ROLES.includes(r));
  const isCompliance = roles.some((r) => COMPLIANCE_ROLES.includes(r));
  const settings = complianceSettings(org.complianceSettings);
  // Délais internes : date d'intervention, échéance de soumission (recrutement) ou d'examen (en validation).
  const planned = plannedDate(project);
  const subDue = recruitmentOpen(project.status) ? submissionDue(planned, settings) : null;
  const revDue = project.status === "EN_VALID" ? reviewDue(project.submittedAt, settings) : null;
  const subLate = daysLate(subDue);
  const revLate = daysLate(revDue);
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
  // Accepter la proposition d'un expert l'engage : contrat de sous-traitance et abonnement, comme une sollicitation.
  const proposalBlocked = project.status === "ATT_IND" && isProject ? await engagementBlock(id, "proposition") : null;
  const available = (Object.keys(TRANSITIONS) as TransitionKey[]).filter((k) => {
    const t = TRANSITIONS[k];
    if (k === "accept_proposal" && proposalBlocked) return false;
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
  const needsNote = (k: TransitionKey) => k === "block" || k === "validate" || k === "ordre" || k === "abandon" || k === "decline_proposal";
  const notePlaceholder = (k: TransitionKey) => (k === "ordre" ? "Référence de la demande" : k === "validate" && fourEyesRule === "justify" ? "Justification (obligatoire)" : k === "block" ? "Motif du blocage (obligatoire)" : k === "abandon" ? "Motif de l'abandon (obligatoire)" : k === "decline_proposal" ? "Motif, transmis à l'expert (facultatif)" : "Commentaire (facultatif)");
  // Libellés français ci-dessus, traduits à l'affichage.

  // Engagé = experts ayant accepté ; les honoraires proposés sans réponse sont indiqués à part (même définition
  // dans le budget plus bas).
  const live = project.experts.filter((e) => e.status !== "DECLINE");
  const { engaged, proposed: waiting, engagedCents: total, proposedCents: proposed } = expertSplit(project.experts, !closed);
  const supplierCents = project.events.flatMap((ev) => ev.rfqs.flatMap((r) => r.quotes)).filter((q) => q.status === "retained").reduce((s, q) => s + q.amountCents, 0);
  const spent = total + project.expenses.reduce((s, e) => s + e.amountCents, 0) + supplierCents;
  // Dossier terminé ou abandonné : plus d'événement à créer ; un dossier né d'un appel renvoie à l'événement de l'appel.
  const finished = project.status === "TERMINE" || project.status === "DECLINE";
  const budgetPct = project.budgetCents ? Math.round((spent / project.budgetCents) * 100) : null;
  const recent = history.slice(0, 8);
  const older = history.slice(8);

  const historyItem = (h: (typeof history)[number]) => {
    const d = h.data as { to?: string; note?: string; title?: string; name?: string; ref?: string; version?: number; selfValidated?: boolean } | null;
    // Jamais de code technique : libellé connu, sinon l'étape atteinte, sinon une mention générique.
    const what = d?.title ?? d?.name;
    const label = ACTION_LABEL[h.action]
      ? `${t(ACTION_LABEL[h.action])}${what ? ` : ${what}${d?.version ? ` (v${d.version})` : ""}` : ""}${d?.ref ? ` (${t("réf. {ref}", { ref: d.ref })})` : ""}`
      : d?.to ? t("Étape : {step}", { step: t(STATUS_LABEL[d.to as keyof typeof STATUS_LABEL] ?? "mise à jour") }) : t("Mise à jour du dossier");
    return (
      <li key={h.id}>
        <div>
          <span>{label}{d?.note ? ` — ${d.note}` : ""}{d?.selfValidated ? t(" (validé par son auteur, seul habilité : justification conservée)") : ""}</span>
          <span className="when">{h.createdAt.toLocaleString(intlLocale(locale), { timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "short" })} · {h.actor ? `${h.actor.firstName} ${h.actor.lastName}` : t("système")}</span>
        </div>
      </li>
    );
  };

  // ─── Onglets ────────────────────────────────────────────────────────────────
  const base = `/organisations/${id}/dossiers/${projectId}`;
  const tabHref = (k: string, extra: Record<string, string> = {}) => (k === "apercu" && !Object.keys(extra).length ? base : `${base}?${new URLSearchParams({ onglet: k, ...extra })}`);
  const expertState = (e: (typeof project.experts)[number]) =>
    e.status === "ATT_EXPERTS" ? (closed ? t("Sans réponse, recrutement clos") : e.desiredFeeCents != null ? t("Contre-proposition") : t("Réponse attendue"))
    : e.status === "DECLINE" ? (e.responseNote === ACCOUNT_DELETED ? t("Retiré : compte supprimé") : e.responseNote === PROPOSAL_WITHDRAWN ? t("Proposition retirée par l'expert") : project.origin === PROPOSAL_ORIGIN ? t("Dossier clos") : t("A décliné"))
    : t(STATUS_LABEL[e.status]);
  const nameOf = (e: (typeof project.experts)[number]) => `${drPrefix(e.practitioner.profession)}${e.practitioner.user.firstName} ${e.practitioner.user.lastName}`;

  // Messagerie : un fil par expert, et un fil par prestataire consulté pour l'événement du dossier.
  const eventIds = project.events.length ? project.events.map((ev) => ev.id) : callEvent ? [callEvent.id] : [];
  const rfqs = isProject && eventIds.length
    ? await db.rfq.findMany({
        where: { organizationId: id, eventId: { in: eventIds }, status: { in: ["sent", "awarded"] } },
        include: {
          suppliers: { include: { supplier: { select: { id: true, name: true } } } },
          messages: { include: { author: { select: { firstName: true, lastName: true } } }, orderBy: { createdAt: "asc" } },
          quotes: { select: { supplierId: true, status: true } },
        },
        orderBy: { createdAt: "asc" },
      })
    : [];
  type Fil = { key: string; title: string; subtitle: string; messages: { id: string; body: string; createdAt: Date; authorId: string; author: { firstName: string; lastName: string } }[]; toAnswer: boolean; write: { linkId: string } | { rfqId: string; supplierId: string; name: string } | null };
  const fils: Fil[] = [
    ...project.experts.map((e) => {
      const last = e.messages.at(-1);
      return { key: e.id, title: nameOf(e), subtitle: e.status === "DECLINE" ? t("A décliné") : e.status === "ATT_EXPERTS" ? t("Réponse attendue") : t(STATUS_LABEL[e.status]), messages: e.messages, toAnswer: !!last && last.authorId === e.practitioner.userId && e.status !== "DECLINE", write: e.status !== "DECLINE" ? { linkId: e.id } : null };
    }),
    ...rfqs.flatMap((r) =>
      r.suppliers.filter((sp) => !sp.declined || r.messages.some((m) => m.supplierId === sp.supplierId)).map((sp) => {
        const msgs = r.messages.filter((m) => m.supplierId === sp.supplierId);
        const canWrite = r.status === "sent" || r.quotes.some((q) => q.supplierId === sp.supplierId && q.status === "retained");
        return { key: `devis-${r.id}-${sp.supplierId}`, title: sp.supplier.name, subtitle: t(supplierCategoryLabel(r.category)), messages: msgs, toAnswer: !!msgs.at(-1)?.fromSupplier, write: canWrite ? { rfqId: r.id, supplierId: sp.supplierId, name: sp.supplier.name } : null };
      }),
    ),
  ];
  const toAnswerCount = fils.filter((f) => f.toAnswer).length;
  const fil0 = fils.find((f) => f.key === fil) ?? fils.find((f) => f.toAnswer) ?? fils.find((f) => f.messages.length) ?? fils[0];

  const counters = project.experts.filter((e) => e.status === "ATT_EXPERTS" && e.desiredFeeCents != null && !closed).length;
  const eventOpen = eventTabOpen(project.status) || project.events.length > 0;
  const tabs: DossierTab[] = [
    { key: "apercu", label: t("Vue d'ensemble"), icon: LayoutDashboard },
    { key: "experts", label: t("Experts"), icon: Users, count: live.length || undefined, alert: counters > 0 },
    { key: "messagerie", label: t("Messagerie"), icon: MessagesSquare, count: toAnswerCount || undefined, alert: toAnswerCount > 0 },
    { key: "conformite", label: t("Conformité"), icon: Scale, alert: (project.status === "EN_VALID" && isCompliance) || project.status === "BLOQUE" || project.status === "REFUS_ORDRE" },
    { key: "documents", label: t("Documents"), icon: FileText, count: project._count.documents || undefined },
    { key: "marketing", label: t("Marketing"), icon: Megaphone },
    // Collaboration sans réunion (rédaction, étude…) : pas d'onglet Événement, sauf événement déjà rattaché.
    { key: "evenement", label: t("Événement"), icon: CalendarDays, count: project.events.length || undefined, disabled: project.events.length || callEvent ? undefined : !needsMeeting(project.typeId) ? t("Pas d'événement pour ce type de collaboration") : eventOpen ? undefined : t("S'ouvre à l'accord de principe") },
  ];
  // « ?modifier=1 » (proposer d'autres conditions, reprendre le dossier) : l'onglet Experts, où se trouve « Modifier le dossier ».
  const active = tabs.find((tb) => tb.key === onglet && !tb.disabled)?.key ?? (modifier === "1" ? "experts" : "apercu");
  const selectedEvent = project.events.find((ev) => ev.id === evenement) ?? project.events[0] ?? null;

  const nextStep = (
            <section className="card next-step">
              <span className="eyebrow-sm">{t("Prochaine étape")}</span>
              <p className="next-hint">{t(NEXT_HINT[project.status] ?? "")}</p>
              {subDue && (subLate > 0
                ? <p className="notice warn">{t("Soumission à la conformité en retard de {n} j : l'échéance interne était le {date} ({lead} jours avant l'intervention).", { n: subLate, date: fmtDate(locale, subDue), lead: settings.submissionLeadDays })}</p>
                : <p className="hint">{t("À soumettre à la conformité avant le {date} (délai interne : {lead} jours avant l'intervention).", { date: fmtDate(locale, subDue), lead: settings.submissionLeadDays })}</p>)}
              {revDue && (revLate > 0
                ? <p className="notice warn">{t("Examen par la conformité en retard de {n} j : attendu avant le {date} ({days} jours ouvrés après la soumission).", { n: revLate, date: fmtDate(locale, revDue), days: settings.reviewDays })}</p>
                : <p className="hint">{t("Examen par la conformité attendu avant le {date} ({days} jours ouvrés après la soumission).", { date: fmtDate(locale, revDue), days: settings.reviewDays })}</p>)}
              {project.status === "EN_VALID" && !isCompliance && <p className="hint">{t("En attente de l'équipe Conformité.")}</p>}
              {fourEyesRule === "blocked" && <p className="notice warn">{t(FOUR_EYES_BLOCKED)}</p>}
              {fourEyesRule === "justify" && <p className="hint">{t(FOUR_EYES_JUSTIFY)}</p>}
              {available.length > 0 && (() => {
                const transition = (k: TransitionKey) => (
                    <form key={k} action={advanceProject} className={`transition${DANGER.includes(k) ? " secondary" : ""}`}>
                      <input type="hidden" name="orgId" value={id} />
                      <input type="hidden" name="projectId" value={projectId} />
                      <input type="hidden" name="transition" value={k} />
                      {needsNote(k) && <input name="note" aria-label={t(notePlaceholder(k))} placeholder={t(notePlaceholder(k))} required={k === "block" || k === "abandon" || (k === "validate" && fourEyesRule === "justify")} />}
                      {k === "signed" && attestable && (
                        <label className="check text-sm">
                          <input type="checkbox" name="attest" value="1" required />{" "}{t("J'atteste que la convention de {join} est signée par les deux parties et conservée par l'organisation.", { join: unsigned.join(", ") })}
                        </label>
                      )}
                      {k === "submit" && waiting.length > 0 ? (
                        <ConfirmButton
                          className="btn"
                          confirm={t("soumettre à la conformité")}
                          summary={<>{waiting.length > 1 ? t("{waiting} réponses attendues seront closes", { waiting: waiting.length }) : t("1 réponse attendue sera close")} ({waiting.map((w) => `${drPrefix(w.practitioner.profession)}${w.practitioner.user.firstName} ${w.practitioner.user.lastName}${w.desiredFeeCents != null ? `, ${t("qui propose d'autres honoraires")}` : ""}`).join(" ; ")}) : {waiting.length > 1 ? t("ces experts sont prévenus") : t("l'expert est prévenu")}{" "}{t("par e-mail que le recrutement est clos.")}</>}
                        >
                          {t(TRANSITIONS[k].label)}
                        </ConfirmButton>
                      ) : (
                        <button className={DANGER.includes(k) ? "btn ghost" : "btn"}>{t(TRANSITIONS[k].label)}</button>
                      )}
                    </form>
                );
                const main = available.filter((k) => !DANGER.includes(k));
                const others = available.filter((k) => DANGER.includes(k));
                // Décision à prendre (bloquer, refus de l'Ordre, décliner une proposition) : affichée telle quelle ; les autres actions
                // secondaires ou destructives (abandonner, revenir en arrière) sont rangées sous « Autres actions ».
                return (
                  <>
                    {main.length > 0 && <div className="transitions-stack">{main.map(transition)}</div>}
                    {others.length > 0 && (others.some((k) => k === "block" || k === "ordre_ko" || k === "decline_proposal") ? (
                      <div className="transitions-stack">{others.map(transition)}</div>
                    ) : (
                      <details className="more-actions">
                        <summary>{t("Autres actions")}</summary>
                        <div className="transitions-stack">{others.map(transition)}</div>
                      </details>
                    ))}
                  </>
                );
              })()}
              {signStarted && isProject && (
                <p className="hint">{t("Une convention est en cours de signature ou déjà signée : le retour en accord de principe n'est plus possible. Si les conditions doivent changer, abandonnez le dossier (motif obligatoire) et ouvrez-en un nouveau.")}</p>
              )}
              {unsigned.length > 0 && !attestable && (
                <p className="hint">
                  {t("Déposez la convention signée de {join} (onglet Documents)", { join: unsigned.join(", ") })}{signatureEnabled() ? t(" ou faites-la signer électroniquement (onglet Experts)") : ""}{" "}{t("pour passer le dossier en « Signé ».")}
                </p>
              )}
              {attestable && (
                <p className="hint">
                  {t("Le dépôt de documents n'est pas encore activé sur KolBase")}{signatureEnabled() ? t(" (la signature électronique reste possible depuis l'onglet Experts)") : ""}{" "}{t(": passer en « Signé » exige votre attestation, enregistrée à votre nom avec la date.")}
                </p>
              )}
            </section>
  );
  const expertCards = (
            <section className="stack-sm">
              <div className="block-head">
                <h2>{t("Experts")}</h2>
                <span className="muted text-sm">{t(project.experts.length > 1 ? (engaged.length > 1 ? "{n} engagés sur {m} sollicités" : "{n} engagé sur {m} sollicités") : "{n} engagé sur {m} sollicité", { n: engaged.length, m: project.experts.length })}</span>
              </div>
              {project.experts.length === 0 && <div className="card empty"><p className="muted">{t("Aucun expert sollicité pour l'instant.")}</p></div>}
              {project.experts.map((e) => {
                const name = `${drPrefix(e.practitioner.profession)}${e.practitioner.user.firstName} ${e.practitioner.user.lastName}`;
                const active = e.status !== "ATT_EXPERTS" && e.status !== "DECLINE";
                const photo = expertPhotoSrc(e.practitioner, kolViewer(user, e.practitionerId));
                // Contre-proposition de l'expert : la sollicitation reste ouverte, l'organisation répond.
                const counter = e.status === "ATT_EXPERTS" && e.desiredFeeCents != null && !closed;
                const last = e.messages.at(-1);
                const toAnswer = last && last.authorId === e.practitioner.userId;
                return (
                  <section key={e.id} className={`card expert-card${e.status === "DECLINE" ? " muted-card" : ""}`}>
                    <div className="expert-head">
                      <Avatar name={name} size={44} photo={photo} />
                      <div className="who">
                        <h3><Link href={`/annuaire/${e.practitionerId}`}>{name}</Link></h3>
                        <div className="muted text-sm">
                          {[t(e.practitioner.specialty ?? e.practitioner.profession), e.practitioner.city, !practicesInFrance(e.practitioner.country) ? country(e.practitioner.country).name : null].filter(Boolean).join(" · ")}
                        </div>
                      </div>
                      <span className={`pill ${e.status === "DECLINE" ? "done" : e.status === "ATT_EXPERTS" ? "wait" : "ok"}`}>
                        {expertState(e)}
                      </span>
                    </div>
                    <div className="terms">
                      <span className="term"><CalendarDays size={13} /> {unitCount(t, intlLocale(locale), e.days, type?.unit ?? "unité")}</span>
                      <span className="term"><Euro size={13} /> {e.feeCents != null ? fmtEur(locale, e.feeCents) : "—"}{" "}{t("HT")}</span>
                      <FmvBadge typeId={project.typeId} feeCents={e.feeCents} units={e.days} />
                      {hoursOf(e) != null && (
                        <span className="term" title={hoursDetail(e, t, intlLocale(locale))}>
                          <Clock size={13} /> {t("{hours} · {rate} / h réel", { hours: fmtHours(hoursOf(e)!, intlLocale(locale)), rate: fmtEur(locale, Math.round((e.feeCents ?? 0) / hoursOf(e)!)) })}
                        </span>
                      )}
                      {e.feeLevelLabel && <span className="term">{t("Grille : {label} ({rate} / h)", { label: e.feeLevelLabel, rate: e.hourlyCents != null ? fmtEur(locale, e.hourlyCents) : "—" })}</span>}
                      {e.desiredFeeCents != null && e.status === "ATT_EXPERTS" && <span className="term desired"><Euro size={13} />{" "}{t("Souhaités par l'expert : {montant} HT", { montant: fmtEur(locale, e.desiredFeeCents) })}</span>}
                    </div>
                    {counter && (
                      <div className="notice warn stack-sm">
                        <span>
                          {t("{name} propose d'autres honoraires :", { name })}{" "}{e.feeCents != null ? `${fmtEur(locale, e.feeCents)} → ` : ""}{fmtEur(locale, e.desiredFeeCents!)}{" "}{t("HT")}{". "}{e.responseNote ? ` « ${e.responseNote} »` : ""}
                        </span>
                        {isProject && editable && (
                          <span className="actions" style={{ marginTop: 0 }}>
                            <form action={acceptCounterOffer}>
                              <input type="hidden" name="orgId" value={id} />
                              <input type="hidden" name="projectId" value={projectId} />
                              <input type="hidden" name="linkId" value={e.id} />
                              <ConfirmButton className="btn small" confirm={t("accepter ces honoraires")} summary={<>{t("Les honoraires de {name} passent à {montant} HT et l'expert est engagé (accord de principe) ; il en est prévenu par e-mail.", { name, montant: fmtEur(locale, e.desiredFeeCents!) })}</>}>
                                {t("Accepter ces honoraires")}
                              </ConfirmButton>
                            </form>
                            <a className="btn ghost small" href={`${tabHref("experts", { modifier: "1" })}#modifier`}>{t("Proposer d'autres conditions")}</a>
                          </span>
                        )}
                      </div>
                    )}
                    {active && (
                      <div className="expert-docs">
                        <span className="actions">
                          <a className="btn ghost small" href={`/organisations/${id}/dossiers/${projectId}/convention/${e.id}`} target="_blank" rel="noreferrer">
                            {t("Convention (PDF)")}
                          </a>
                          <a className="link" href={`/organisations/${id}/dossiers/${projectId}/convention/${e.id}?lang=en`} target="_blank" rel="noreferrer" title={t("Traduction de courtoisie : la version française fait foi")}>
                            {t("version anglaise")}
                          </a>
                        </span>
                        <ConventionSignatureBlock orgId={id} linkId={e.id} signature={e.signature} projectStatus={project.status} canSend={isProject} deposited={e.documents.length > 0} />
                      </div>
                    )}
                    {active && ["SIGNE", "TERMINE"].includes(e.status) && (
                      <div className="payment-row">
                        {e.paidAt ? (
                          <>
                            <span className="pill ok">{t("Honoraires payés le {date} · {montant} HT", { date: fmtDate(locale, e.paidAt), montant: fmtEur(locale, e.paidCents ?? 0) })}</span>
                            {isProject && (
                              <form action={markExpertPaid}>
                                <input type="hidden" name="orgId" value={id} /><input type="hidden" name="linkId" value={e.id} /><input type="hidden" name="undo" value="1" />
                                <button className="link">{t("Annuler")}</button>
                              </form>
                            )}
                          </>
                        ) : isProject ? (
                          <form action={markExpertPaid} className="inline wrap">
                            <input type="hidden" name="orgId" value={id} /><input type="hidden" name="linkId" value={e.id} />
                            <span className="text-sm">{t("Paiement des honoraires")}</span>
                            <input name="amount" inputMode="decimal" defaultValue={e.feeCents != null ? String(e.feeCents / 100) : ""} aria-label={t("Montant payé (€ HT)")} />
                            <input name="date" type="date" defaultValue={parisToday()} max={parisToday()} aria-label={t("Date du paiement")} />
                            <button className="btn ghost small">{t("Marquer payé")}</button>
                          </form>
                        ) : (
                          <span className="pill wait">{t("Honoraires à payer")}</span>
                        )}
                        {e.feeNote ? (
                          <a className="fee-note-link" href={`/notes-honoraires/${e.feeNote.id}`}>{t("Note d'honoraires {number} · {montant}", { number: e.feeNote.number, montant: fmtEur(locale, e.feeNote.totalCents) })}{" "}{e.feeNote.vatBp ? "TTC" : t("(TVA non applicable)")}</a>
                        ) : (
                          <span className="text-xs muted">{t("Note d'honoraires : pas encore établie par l'expert (depuis « Mes revenus »).")}</span>
                        )}
                      </div>
                    )}
                    <div className="exchanges-link">
                      <MessagesSquare size={15} aria-hidden />
                      <Link href={tabHref("messagerie", { fil: e.id })}>
                        {e.messages.length ? t(e.messages.length > 1 ? "{n} messages échangés" : "{n} message échangé", { n: e.messages.length }) : t("Écrire à l'expert")}
                      </Link>
                      {toAnswer && e.status !== "DECLINE" && <span className="pill electric">{t("À vous de répondre")}</span>}
                      {last && <span className="muted text-xs">{t("dernier message le {date}", { date: fmtDateTime(locale, last.createdAt) })}</span>}
                    </div>
                  </section>
                );
              })}
            </section>
  );

  return (
    <>
      <SiteHeader />
      <main className="stack">
        <p className="muted"><Link href={`/organisations/${id}`}>{org.name}</Link> / <Link href={`/organisations/${id}/dossiers`}>{t("Dossiers")}</Link></p>

        <header className="page-hero">
          <div className="hero-top">
            <span className="eyebrow-sm">{t(type?.label ?? project.typeId)}{project.therapeuticArea ? ` · ${t(project.therapeuticArea)}` : ""}</span>
            <StatusPill status={project.status} />
          </div>
          <h1>{project.title}</h1>
          {/* En-tête resserré : trois repères (honoraires, budget, responsables) ; l'objet, les experts et le régime
              sont détaillés dans la vue d'ensemble. */}
          <dl className="hero-facts slim">
            <div>
              <dt><Euro size={13} />{" "}{t("Honoraires engagés")}</dt>
              <dd>{fmtEur(locale, total)}{" "}{t("HT")}<small>{proposed > 0 ? t("{montant} HT proposés, sans réponse", { montant: fmtEur(locale, proposed) }) : t("honoraires acceptés")}</small></dd>
            </div>
            <div>
              <dt><Wallet size={13} />{" "}{t("Budget")}</dt>
              <dd>{project.budgetCents != null ? `${fmtEur(locale, project.budgetCents)} ${t("HT")}` : t("Non défini")}<small>{budgetPct != null ? `${t(supplierCents ? "{budgetPct} % engagé, prestataires compris" : "{budgetPct} % engagé", { budgetPct })}${proposed > 0 ? ` ; ${t("{montant} HT proposés en plus", { montant: fmtEur(locale, proposed) })}` : ""}` : t("à renseigner plus bas")}</small></dd>
            </div>
            {planned && (
              <div>
                <dt><CalendarDays size={13} />{" "}{t("Intervention prévue")}</dt>
                <dd>{fmtDate(locale, planned)}<small>{subDue ? t("à soumettre avant le {date}", { date: fmtDate(locale, subDue) }) : revDue ? t("examen attendu avant le {date}", { date: fmtDate(locale, revDue) }) : project.plannedAt ? t("date du dossier") : t("date de l'événement")}</small></dd>
              </div>
            )}
            <div>
              <dt><User size={13} />{" "}{leads.length > 1 ? t("Responsables") : t("Responsable")}</dt>
              <dd>{leads.length ? leads.slice(0, 2).map((l) => `${l.user.firstName} ${l.user.lastName}`).join(", ") + (leads.length > 2 ? ` +${leads.length - 2}` : "") : t("À désigner")}<small>{t("ouvert le {date}", { date: fmtDate(locale, project.createdAt) })}</small></dd>
            </div>
          </dl>
          <Pipeline status={project.status} compact />
        </header>

        {project.status === "ATT_IND" && <p className="notice warn">{t("Projet proposé par l'expert : acceptez-le pour ouvrir le circuit (conformité, convention, signature), ou déclinez-le. Le motif éventuel lui est transmis dans vos échanges.")}</p>}
        {proposalBlocked && <BillingNotice orgId={id} motive="proposition" objet={projectId} />}

        <DossierTabs tabs={tabs} active={active} href={(k: string) => tabHref(k)} label={t("Rubriques du dossier")} />

        {active === "apercu" && (
          <div className="page-grid">
            <div className="page-main">
              {nextStep}
              {project.description && (
                <section className="card stack-sm">
                  <h2 className="section-title"><FileText size={15} />{" "}{t("Objet du dossier")}</h2>
                  <p className="object-text">{project.description}</p>
                </section>
              )}
              <section className="card stack-sm">
                <div className="block-head">
                  <h2 className="section-title"><Users size={15} />{" "}{t("Experts")}</h2>
                  <Link className="link" href={tabHref("experts")}>{t("Voir les experts")}</Link>
                </div>
                {project.experts.length === 0 ? <p className="muted">{t("Aucun expert sollicité pour l'instant.")}</p> : (
                  <ul className="expert-rows">
                    {project.experts.map((e) => (
                      <li key={e.id}>
                        <Avatar name={nameOf(e)} size={32} photo={expertPhotoSrc(e.practitioner, kolViewer(user, e.practitionerId))} />
                        <span className="who"><strong>{nameOf(e)}</strong><span className="muted text-xs">{e.feeCents != null ? `${fmtEur(locale, e.feeCents)} ${t("HT")}` : "—"}</span></span>
                        <span className={`pill ${e.status === "DECLINE" ? "done" : e.status === "ATT_EXPERTS" ? "wait" : "ok"}`}>{expertState(e)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <BudgetPanel orgId={id} projectId={projectId} canEdit={isProject} />
            <section className="card">
              <h2 className="section-title"><Clock size={15} />{" "}{t("Historique")}</h2>
              {history.length === 0 ? <p className="muted">{t("Aucune action enregistrée.")}</p> : (
                <>
                  <ol className="audit-trail">{recent.map(historyItem)}</ol>
                  {older.length > 0 && (
                    <details className="older">
                      <summary>{t("Voir les {older} actions précédentes", { older: older.length })}</summary>
                      <ol className="audit-trail">{older.map(historyItem)}</ol>
                    </details>
                  )}
                </>
              )}
            </section>
            </div>
            <aside className="page-aside">
              <section className="card stack-sm" id="responsables">
                <h2 className="section-title"><User size={15} />{" "}{t("Responsables")}</h2>
                {leads.length === 0 ? (
                  <p className="text-sm muted">{t("Aucun responsable : les e-mails du dossier vont à toute l'équipe Projets.")}</p>
                ) : (
                  <ul className="lead-list">
                    {leads.map((l) => (
                      <li key={l.userId}>
                        <Avatar name={`${l.user.firstName} ${l.user.lastName}`} size={28} photo={accountPhoto({ id: l.user.id, photoUpdatedAt: l.user.photoUpdatedAt })} />
                        <span className="grow">{l.user.firstName} {l.user.lastName}{l.userId === user.id && <span className="muted">{" "}{t("(vous)")}</span>}</span>
                        {isProject && (
                          <form action={removeProjectLead}>
                            <input type="hidden" name="orgId" value={id} />
                            <input type="hidden" name="projectId" value={projectId} />
                            <input type="hidden" name="userId" value={l.userId} />
                            <button className="link danger text-xs" aria-label={t("Retirer {name} des responsables", { name: `${l.user.firstName} ${l.user.lastName}` })}>{t("Retirer")}</button>
                          </form>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {isProject && !leads.some((l) => l.userId === user.id) && (
                  <form action={addProjectLead}>
                    <input type="hidden" name="orgId" value={id} />
                    <input type="hidden" name="projectId" value={projectId} />
                    <button className="btn secondary small">{t("Me désigner responsable")}</button>
                  </form>
                )}
                {isProject && leadPool.some((m) => m.user.id !== user.id && !leads.some((l) => l.userId === m.user.id)) && (
                  <form action={addProjectLead} className="inline-form">
                    <input type="hidden" name="orgId" value={id} />
                    <input type="hidden" name="projectId" value={projectId} />
                    <label className="sr-only" htmlFor="lead-add">{t("Ajouter un responsable")}</label>
                    <select id="lead-add" name="userId" required defaultValue="">
                      <option value="" disabled>{t("Ajouter un collègue…")}</option>
                      {leadPool.filter((m) => m.user.id !== user.id && !leads.some((l) => l.userId === m.user.id)).map((m) => (
                        <option key={m.user.id} value={m.user.id}>{m.user.firstName} {m.user.lastName}</option>
                      ))}
                    </select>
                    <button className="btn ghost small">{t("Ajouter")}</button>
                  </form>
                )}
                <p className="hint">{t("Les responsables retrouvent le dossier dans « Mes dossiers » et en reçoivent les e-mails. Toute l'équipe Projets garde l'accès.")}</p>
              </section>
              <section className="card stack-sm">
                <h2 className="section-title"><Scale size={15} />{" "}{t("Régime")}</h2>
                <p className="text-sm">{regime ? <><span className={`pill ${regime.regime === "autorisation" ? "wait" : regime.regime === "hors_france" ? "" : "ok"}`}>{t(REGIME_LABEL[regime.regime])}</span> {regimeReason(regime, t, intlLocale(locale))}</> : t("Le régime (déclaration ou autorisation) sera déterminé dès qu'un expert aura accepté.")}</p>
                <Link className="link text-sm" href={tabHref("conformite")}>{t("Contrôles et supports")}</Link>
              </section>
              {(selectedEvent ?? callEvent) && (
                <section className="card stack-sm">
                  <h2 className="section-title"><CalendarDays size={15} />{" "}{t("Événement")}</h2>
                  <p className="text-sm"><strong>{(selectedEvent ?? callEvent)!.title}</strong><br /><span className="muted">{fmtDateTime(locale, (selectedEvent ?? callEvent)!.startsAt)}{(selectedEvent ?? callEvent)!.city ? ` · ${(selectedEvent ?? callEvent)!.city}` : ""}</span></p>
                  <Link className="link text-sm" href={tabHref("evenement")}>{t("Gérer l'événement")}</Link>
                </section>
              )}
            </aside>
          </div>
        )}

        {active === "experts" && (
          <div className="stack">
            {expertCards}
            {editable && (
              <details className="card edit-block" id="modifier" open={modifier === "1"}>
                <summary><h2>{t("Modifier le dossier")}</h2></summary>
                <div className="stack">
                  <p className="hint">{t("Tant que le dossier n'est pas soumis à la conformité, vous pouvez en modifier l'objet et les conditions de chaque expert, ou solliciter un expert de plus. Des unités ou des honoraires modifiés renvoient la proposition à l'expert : sa réponse est de nouveau attendue.")}</p>
                  <ProjectObjectForm orgId={id} projectId={projectId} title={project.title} area={project.therapeuticArea ?? ""} description={project.description ?? ""} planned={project.plannedAt ? project.plannedAt.toISOString().slice(0, 10) : ""} />
                  {project.experts.length > 0 && (
                    <div className="stack-sm">
                      <h3>{t("Conditions proposées")}</h3>
                      {project.experts.map((e) => (
                        <ExpertTermsForm
                          key={e.id}
                          orgId={id} projectId={projectId} linkId={e.id}
                          name={`${drPrefix(e.practitioner.profession)}${e.practitioner.user.firstName} ${e.practitioner.user.lastName}${e.status === "DECLINE" ? ` (${t("a décliné")})` : ""}`}
                          unit={type?.unit ?? t("unité")}
                          levels={levels}
                          hourlyMax={settings.remunerationHourlyMax}
                          defaults={{
                            units: e.days != null ? String(e.days).replace(".", ",") : "",
                            fee: e.feeCents != null ? String(e.feeCents / 100).replace(".", ",") : "",
                            level: e.feeLevelId ?? "",
                            prepHours: e.prepHours != null ? String(e.prepHours).replace(".", ",") : "",
                            interventionHours: e.interventionHours != null ? String(e.interventionHours).replace(".", ",") : "",
                            travelHours: e.travelHours != null ? String(e.travelHours).replace(".", ",") : "",
                          }}
                          desired={e.desiredFeeCents != null ? fmtEur(locale, e.desiredFeeCents) : null}
                        />
                      ))}
                    </div>
                  )}
                  <div className="stack-sm">
                    <h3>{t("Solliciter un autre expert")}</h3>
                    <AddExpertForm
                      orgId={id} projectId={projectId} unit={type?.unit ?? t("unité")}
                      levels={levels}
                      hourlyMax={settings.remunerationHourlyMax}
                      blocked={await engagementBlock(id, "sollicitation")}
                      experts={candidates.map((c) => {
                        const v = kolVisibility(c.visibility);
                        return {
                          id: c.id,
                          name: `${drPrefix(c.profession)}${c.user.firstName} ${c.user.lastName}`,
                          detail: [t(c.specialty || c.profession), canSee(v.contact, "membre") ? c.city : null].filter(Boolean).join(" · "),
                          dayRateCents: canSee(v.tarif, "membre") ? c.dayRateCents : null,
                        };
                      })}
                    />
                  </div>
                </div>
              </details>
            )}
          </div>
        )}

        {active === "messagerie" && (
          fils.length === 0 ? (
            <section className="card empty"><p className="muted">{t("Aucune conversation : sollicitez un expert pour lui écrire.")}</p></section>
          ) : (
            <section className="card messenger">
              <nav className="messenger-list" aria-label={t("Conversations")}>
                {[{ label: t("Experts"), items: fils.filter((f) => !f.key.startsWith("devis-")) }, { label: t("Prestataires"), items: fils.filter((f) => f.key.startsWith("devis-")) }].filter((g) => g.items.length).map((g) => (
                  <div key={g.label} className="messenger-group">
                    <p className="label">{g.label}</p>
                    {g.items.map((f) => {
                      const last = f.messages.at(-1);
                      return (
                        <Link key={f.key} href={tabHref("messagerie", { fil: f.key })} className={`messenger-item${f.key === fil0?.key ? " active" : ""}`} aria-current={f.key === fil0?.key ? "true" : undefined}>
                          <span className="messenger-who"><strong>{f.title}</strong><span className="muted text-xs">{last ? last.body.slice(0, 60) : f.subtitle}</span></span>
                          {f.toAnswer ? <span className="messenger-dot" aria-label={t("À vous de répondre")} /> : last ? <span className="muted text-xs">{fmtDate(locale, last.createdAt)}</span> : null}
                        </Link>
                      );
                    })}
                  </div>
                ))}
              </nav>
              {fil0 && (
                <div className="messenger-pane">
                  <div className="messenger-head">
                    <div><h2>{fil0.title}</h2><span className="muted text-sm">{fil0.subtitle}</span></div>
                    {fil0.toAnswer && <span className="pill electric">{t("À vous de répondre")}</span>}
                  </div>
                  <Thread messages={fil0.messages} meId={user.id} />
                  {fil0.write && ("linkId" in fil0.write ? <MessageForm linkId={fil0.write.linkId} /> : <RfqMessageForm orgId={id} rfqId={fil0.write.rfqId} supplierId={fil0.write.supplierId} placeholder={t("Écrire à {name}…", { name: fil0.write.name })} />)}
                </div>
              )}
            </section>
          )
        )}

        {active === "conformite" && (
          <div className="page-grid">
            <div className="page-main">
            <section className="card stack-sm">
              <h2 className="section-title"><Scale size={15} />{" "}{t("Conformité")}</h2>
              {regime ? (
                <p className="text-sm">
                  {t("Régime :")}{" "}<span className={`pill ${regime.regime === "autorisation" ? "wait" : regime.regime === "hors_france" ? "" : "ok"}`}>{t(REGIME_LABEL[regime.regime])}</span>{" "}
                  ({regimeReason(regime, t, intlLocale(locale))}).{" "}
                  {regime.regime === "hors_france"
                    ? t("Pas de démarche sur la plateforme EPS ; vérifiez les obligations du pays d'exercice avant la signature.")
                    : regime.regime === "autorisation"
                      ? t("Demande d'autorisation à adresser au moins {authorizationDays} jours avant l'exécution ; la déclaration simple n'est pas possible.", { authorizationDays: settings.authorizationDays })
                      : t("Déclaration à effectuer au moins {declarationDays} jours ouvrables avant l'exécution. Si une hospitalité dépasse les seuils, demandez l'autorisation.", { declarationDays: settings.declarationDays })}
                </p>
              ) : <p className="muted text-sm">{t("Le régime (déclaration ou autorisation) sera déterminé dès qu'un expert aura accepté.")}</p>}
              {project.complianceNote && <p className={`notice ${project.status === "BLOQUE" ? "error" : "ok"}`}>{t("Conformité : {complianceNote}", { complianceNote: project.complianceNote })}</p>}
              {project.ordreRef && <p className="muted text-sm">{t("Demande à l'Ordre : {ordreRef}", { ordreRef: project.ordreRef })}</p>}
              {project.signatureAttestedAt && (
                <p className="notice warn">
                  {t("Signature attestée par")}{" "}{attester ? `${attester.firstName} ${attester.lastName}` : t("un membre de l'organisation")}{" "}{t("le {date} : convention signée conservée hors de KolBase, non déposée.", { date: project.signatureAttestedAt.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" }) })}
                </p>
              )}
            </section>
              <MaterialsPanel orgId={id} projectId={projectId} canSubmit={isProject} canReview={roles.some((r) => REVIEW_ROLES.includes(r))} />
              <ConflictsPanel projectId={projectId} />
            {foreignExperts.length > 0 && (
              <section className="card stack-sm">
                <h2 className="section-title">{t("Experts exerçant hors de France")}</h2>
                {foreignExperts.map((e) => (
                  <div key={e.id}>
                    <strong>{drPrefix(e.practitioner.profession)}{e.practitioner.user.firstName} {e.practitioner.user.lastName}</strong> · {country(e.practitioner.country).name}
                    <ul className="text-sm">{foreignObligations(e.practitioner.country).map((o) => <li key={o}>{o}</li>)}</ul>
                  </div>
                ))}
                <p className="text-xs muted">{t("Repères donnés à titre indicatif, à faire valider par votre service juridique.")}</p>
              </section>
            )}
            </div>
            <aside className="page-aside">
              {nextStep}
            {isCompliance && aiEnabled() && (
              <section className="card stack-sm">
                <h2 className="section-title"><Sparkles size={15} />{" "}{t("Relecture assistée")}</h2>
                <AiReview orgId={id} projectId={projectId} />
              </section>
            )}
            </aside>
          </div>
        )}

        {active === "documents" && (
          <div className="stack">
            <DocumentsPanel projectId={projectId} canUpload={isProject || isCompliance} openUpload={project.status === "SIGNATURE"} />
            {project.experts.some((e) => e.status !== "ATT_EXPERTS" && e.status !== "DECLINE") && (
              <section className="card stack-sm">
                <h2 className="section-title"><FileText size={15} />{" "}{t("Conventions")}</h2>
                <ul className="plain stack-sm">
                  {project.experts.filter((e) => e.status !== "ATT_EXPERTS" && e.status !== "DECLINE").map((e) => (
                    <li key={e.id} className="flex-between">
                      <span>{nameOf(e)}</span>
                      <span className="actions" style={{ marginTop: 0 }}>
                        {e.documents.length > 0 ? <span className="pill ok">{t("Convention signée déposée")}</span> : e.signature?.status === "done" ? <span className="pill ok">{t("Signée électroniquement")}</span> : null}
                        <a className="btn ghost small" href={`/organisations/${id}/dossiers/${projectId}/convention/${e.id}`} target="_blank" rel="noreferrer">{t("Convention (PDF)")}</a>
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}

        {active === "marketing" && (
          <div className="stack">
            <section className="card stack-sm">
              <h2 className="section-title"><User size={15} />{" "}{t("Photos des experts")}</h2>
              <p className="muted text-sm">{t("Pour le programme, les affiches, les posts et les e-mailings : seulement les experts engagés qui ont donné leur accord pour l'usage de leur photo.")}</p>
              {engaged.length === 0 ? <p className="muted">{t("Aucun expert engagé pour l'instant.")}</p> : (
                <ul className="photo-grid">
                  {engaged.map((e) => {
                    const photo = expertPhotoSrc(e.practitioner, kolViewer(user, e.practitionerId));
                    const usable = photo && e.practitioner.photoConsentAt && e.practitioner.photoUpdatedAt;
                    return (
                      <li key={e.id}>
                        <Avatar name={nameOf(e)} size={56} photo={photo} />
                        <strong className="text-sm">{nameOf(e)}</strong>
                        {usable ? <a className="text-xs" href={photoPath(e.practitionerId, e.practitioner.photoUpdatedAt!, "grande")} download>{t("Télécharger la photo")}</a> : <span className="muted text-xs">{photo ? t("Accord non donné pour vos supports") : t("Pas de photo")}</span>}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
            {project.events.length === 0 && !callEvent ? (
              <section className="card stack-sm">
                <h2 className="section-title"><Megaphone size={15} />{" "}{t("Faire connaître l'événement")}</h2>
                <p className="muted">{t("E-mailing aux praticiens, publication sur les réseaux sociaux de KolBase et mise à la une de l'accueil : ces services portent sur l'événement du dossier. Ils apparaissent ici une fois l'événement créé et publié (onglet Événement).")}</p>
              </section>
            ) : (
              (project.events.length ? project.events : callEvent ? [callEvent] : []).map((ev) => (
                <div key={ev.id} className="stack-sm">
                  {(project.events.length > 1) && <p className="label">{ev.title}</p>}
                  {"internal" in ev && ev.internal
                    ? <section className="card"><p className="muted">{t("Réunion interne : pas de communication publique.")}</p></section>
                    : isProject ? <EventWorkspace orgId={id} eventId={ev.id} mode="marketing" /> : <section className="card"><p className="muted">{t("Les services de communication sont commandés par l'équipe Projets.")}</p></section>}
                </div>
              ))
            )}
          </div>
        )}

        {active === "evenement" && (
          selectedEvent ? (
            <div className="stack">
              {project.events.length > 1 && (
                <nav className="chips" aria-label={t("Événements du dossier")}>
                  {project.events.map((ev) => <Link key={ev.id} className={`chip${ev.id === selectedEvent.id ? " active" : ""}`} href={tabHref("evenement", { evenement: ev.id })}>{ev.title}</Link>)}
                </nav>
              )}
              <EventWorkspace orgId={id} eventId={selectedEvent.id} mode="dossier" publie={publie} retour={tabHref("evenement", project.events.length > 1 ? { evenement: selectedEvent.id } : {})} />
            </div>
          ) : callEvent ? (
            <div className="stack">
              <p className="notice">{t("Dossier né de l'opportunité «")}{" "}{fromCall!.openCall.title}{" "}{t("» : l'intervention a lieu à cet événement, partagé avec les autres intervenants retenus.")}</p>
              <EventWorkspace orgId={id} eventId={callEvent.id} mode="dossier" publie={publie} retour={tabHref("evenement")} />
            </div>
          ) : (
            <section className="card stack-sm event-empty">
              <CalendarDays size={28} strokeWidth={1.6} aria-hidden />
              <h2>{t("L'événement du dossier")}</h2>
              <p className="muted">{t("Réunion, formation ou symposium : créez l'événement rattaché au dossier. Vous préparez dès maintenant la date, le lieu, les devis des prestataires et l'agence ; la publication dans l'agenda et les inscriptions s'ouvrent une fois le dossier validé par la conformité.")}</p>
              {isProject && !finished && <Link className="btn" href={`/organisations/${id}/evenements/nouveau?dossier=${projectId}`}>{t("Créer l'événement du dossier")}</Link>}
            </section>
          )
        )}
      </main>
    </>
  );
}
