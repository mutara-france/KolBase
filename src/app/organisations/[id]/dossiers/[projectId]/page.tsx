import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarDays, Clock, Euro, FileDown, FileSignature, FileText, Globe, ImageDown, LayoutDashboard, Megaphone, MessagesSquare, Receipt, Route, Scale, Sparkles, User, UserPlus, Users, Wallet } from "lucide-react";
import { SectionHead, StateTile } from "@/components/UI";
import { detectConflicts } from "@/lib/conflicts";
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
import { COMPLIANCE_ROLES } from "@/lib/events";
import { ACCOUNT_DELETED, PROPOSAL_ORIGIN, PROPOSAL_WITHDRAWN, collabType, eventTabOpen, needsMeeting, PROJECT_ROLES, PROJECT_VIEW_ROLES, projectEditable, recruitmentOpen, REVIEW_ROLES, STATUS_LABEL, TRANSITIONS, unitCount, type TransitionKey } from "@/lib/projects";
import { storageEnabled } from "@/lib/storage";
import { acceptCounterOffer, addProjectLead, advanceProject, removeProjectLead } from "@/lib/project-actions";
import { ConfirmButton } from "@/components/ConfirmButton";
import { expertSplit } from "@/lib/indicators";
import { BudgetTab, ConflictsPanel, ConventionSignatureBlock, DocumentsPanel, MaterialsPanel } from "@/components/DossierSections";
import { ExpertCostsTab, FrameworkPanel } from "@/components/ExpertCosts";
import { TransferForm } from "@/components/RoutingForms";
import { topicLabel } from "@/lib/routing";
import { missingCumulAuthorizations, missingSignedConventions } from "@/lib/project-documents";
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
import { fmtDate, fmtEur, intlLocale } from "@/lib/i18n";
import { feeLevels } from "@/lib/fee-fields";
import { fmtHours, hoursDetail, hoursOf } from "@/lib/fees";
import { daysLate, epsDue, plannedDate, reviewDue, submissionDue } from "@/lib/deadlines";

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
  "project.validate_first": "Première validation (seconde requise)",
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
  "expert_expense.submit": "Note de frais déposée par l'expert",
  "expert_expense.withdraw": "Note de frais retirée par l'expert",
  "expert_expense.approved": "Note de frais acceptée",
  "expert_expense.rejected": "Note de frais refusée",
  "expert_expense.paid": "Frais remboursés à l'expert",
  "expert_travel.save": "Voyage de l'expert enregistré",
  "framework.mission": "Mission consignée (contrat-cadre)",
  "framework.mission_remove": "Mission retirée (contrat-cadre)",
  "project.transfer": "Proposition transmise à un autre interlocuteur",
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


export default async function Page({ params, searchParams }: { params: Promise<{ id: string; projectId: string }>; searchParams: Promise<{ modifier?: string; onglet?: string; fil?: string; evenement?: string; publie?: string; solliciter?: string; soumission?: string }> }) {
  const { t, locale } = await getT();
  const { id, projectId } = await params;
  const { modifier, onglet, fil, evenement, publie, solliciter, soumission } = await searchParams;
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
      expenses: { select: { amountCents: true, status: true } },
      events: {
        orderBy: { startsAt: "asc" },
        include: { rfqs: { include: { quotes: { select: { status: true, amountCents: true } } } } },
      },
      // Justificatifs de frais : comptés avec leur note de frais, pas dans les documents.
      _count: { select: { documents: { where: { kind: { not: "JUSTIFICATIF" } } } } },
      // Proposition d'expert aiguillée : canal (sujet), réponse attendue, idée de produit sous accord de confidentialité.
      channel: { select: { topic: true } },
      proposal: { select: { topic: true, ndaRequested: true } },
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
      select: { openCall: { select: { id: true, title: true, event: { select: { id: true, title: true, startsAt: true, city: true, internal: true, publishedAt: true, reviewStatus: true } } } } },
    }),
    feeLevels(id),
  ]);
  const callEvent = fromCall?.openCall.event ?? null;
  // Proposition à examiner : transfert possible à un autre sujet de l'organisation ou à une autre entité du groupe.
  const transferTargets = project.status === "ATT_IND" && project.origin === PROPOSAL_ORIGIN
    ? await (async () => {
        const [own, entities] = await Promise.all([
          db.contactChannel.findMany({ where: { organizationId: id }, select: { topic: true } }),
          org.groupId ? db.organization.findMany({ where: { groupId: org.groupId, NOT: { id }, listed: true, verification: "VERIFIED" }, select: { id: true, name: true, coveredCountries: true } }) : Promise.resolve([]),
        ]);
        const topic = project.proposal?.topic ?? project.channel?.topic ?? "autre";
        return [
          ...own.filter((c) => c.topic !== project.channel?.topic).map((c) => ({ value: `${id}|${c.topic}`, label: t("{org} · {topic}", { org: org.name, topic: t(topicLabel(c.topic)) }) })),
          ...entities.map((e) => ({ value: `${e.id}|${topic}`, label: `${e.name}${e.coveredCountries.length ? ` (${e.coveredCountries.join(", ")})` : ` (${t("siège")})`}` })),
        ];
      })()
    : [];
  // Frais des experts : notes à examiner (pastille de l'onglet), frais acceptés ou remboursés (dans le budget).
  const [expensesToReview, expertCosts] = await Promise.all([
    db.expertExpense.count({ where: { projectExpert: { projectId }, status: "submitted" } }),
    db.expertExpense.aggregate({ where: { projectExpert: { projectId }, status: { in: ["approved", "paid"] } }, _sum: { amountCents: true } }),
  ]);

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
  // Démarche EPS à faire (dossier validé) : dernier jour pour déclarer ou demander l'autorisation, retard signalé.
  const epsDeadline = project.status === "VALIDE" ? epsDue(planned, regime?.regime, settings) : null;
  const epsLate = daysLate(epsDeadline);
  const foreignExperts = project.experts.filter((e) => e.status !== "DECLINE" && !practicesInFrance(e.practitioner.country));
  const unsigned = project.status === "SIGNATURE" ? await missingSignedConventions(projectId) : [];
  // Sans stockage de documents, la convention signée ne peut pas être déposée : une attestation explicite est demandée.
  const attestable = unsigned.length > 0 && !storageEnabled();
  // Experts agents publics : autorisation de cumul à joindre avant la déclaration ou la demande à l'Ordre.
  const noCumul = project.status === "VALIDE" ? await missingCumulAuthorizations(projectId) : [];
  const cumulAttestable = noCumul.length > 0 && !storageEnabled();
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
    if ((k === "declaration" || k === "ordre") && noCumul.length > 0 && !cumulAttestable) return false;
    if (k === "validate" && fourEyesRule === "blocked") return false;
    if (k === "back_to_accord" && signStarted) return false;
    return (t.from as readonly string[]).includes(project.status) && (t.roles === "compliance" ? isCompliance : isProject);
  }).sort((a, b) => Number(DANGER.includes(a)) - Number(DANGER.includes(b)));
  const needsNote = (k: TransitionKey) => k === "block" || k === "validate" || k === "ordre" || k === "declaration" || k === "abandon" || k === "decline_proposal";
  const notePlaceholder = (k: TransitionKey) => (k === "ordre" ? "Référence de la demande" : k === "declaration" ? "Référence de la déclaration EPS (facultatif)" : k === "validate" && fourEyesRule === "justify" ? "Justification (obligatoire)" : k === "block" ? "Motif du blocage (obligatoire)" : k === "abandon" ? "Motif de l'abandon (obligatoire)" : k === "decline_proposal" ? "Motif, transmis à l'expert (facultatif)" : "Commentaire (facultatif)");
  // Libellés français ci-dessus, traduits à l'affichage.

  // Engagé = experts ayant accepté ; les honoraires proposés sans réponse sont indiqués à part (même définition
  // dans le budget plus bas).
  const live = project.experts.filter((e) => e.status !== "DECLINE");
  const { engaged, proposed: waiting, engagedCents: total } = expertSplit(project.experts, !closed);
  const supplierCents = project.events.flatMap((ev) => ev.rfqs.flatMap((r) => r.quotes)).filter((q) => q.status === "retained").reduce((s, q) => s + q.amountCents, 0);
  const spent = total + project.expenses.reduce((s, e) => s + e.amountCents, 0) + supplierCents + (expertCosts._sum.amountCents ?? 0);
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

  // ─── Repères par rubrique : vue d'ensemble et pastilles des onglets ──────────
  // Chaque information a sa place : la vue d'ensemble résume et renvoie, l'onglet détaille et permet d'agir.
  const engagedLinks = project.experts.filter((e) => e.status !== "ATT_EXPERTS" && e.status !== "DECLINE");
  const conventionState = (e: (typeof project.experts)[number]): { label: string; tone: "ok" | "wait" | "done" } =>
    e.documents.length > 0 ? { label: "Convention signée déposée", tone: "ok" }
    : e.signature?.status === "done" ? { label: "Signée électroniquement", tone: "ok" }
    : ["SIGNE", "TERMINE"].includes(e.status) ? { label: "Convention signée", tone: "ok" }
    : e.signature?.status === "ongoing" ? { label: "En signature électronique", tone: "wait" }
    : project.status === "SIGNATURE" ? { label: "Convention à signer", tone: "wait" }
    : { label: "Convention prête", tone: "done" };
  const signedCount = engagedLinks.filter((e) => conventionState(e).tone === "ok").length;
  const [materials, conflicts, calls] = await Promise.all([
    db.material.findMany({ where: { projectId }, select: { versions: { select: { status: true }, orderBy: { version: "desc" }, take: 1 } } }),
    detectConflicts(projectId, t, locale),
    // Opportunités publiées pour l'événement du dossier : les candidats retenus rejoignent ce dossier.
    isProject && project.events.length
      ? db.openCall.findMany({
          where: { organizationId: id, eventId: { in: project.events.map((ev) => ev.id) } },
          include: { applications: { select: { status: true, practitioner: { select: { profession: true, user: { select: { firstName: true, lastName: true } } } } } } },
          orderBy: { createdAt: "asc" },
        })
      : Promise.resolve([]),
  ]);
  const matPending = materials.filter((m) => m.versions[0]?.status === "submitted").length;
  const matChanges = materials.filter((m) => m.versions[0]?.status === "changes").length;
  const conflictAlerts = conflicts.filter((c) => c.severity !== "info").length;
  const toPay = engagedLinks.filter((e) => ["SIGNE", "TERMINE"].includes(e.status) && !e.paidAt).length;
  const expensesDue = project.expenses.filter((x) => x.status !== "payee").length;
  const over = project.budgetCents != null && spent > project.budgetCents;
  const complianceActs = available.filter((k) => TRANSITIONS[k].roles === "compliance");
  // Seconde validation : honoraires engagés au-delà du seuil réglé par l'organisation (0 : désactivé).
  const engagedFees = project.experts.filter((e) => e.status !== "DECLINE" && e.status !== "ATT_EXPERTS").reduce((x, e) => x + (e.feeCents ?? 0), 0);
  const secondValidation = project.status === "EN_VALID" && settings.secondValidationAbove > 0 && engagedFees > settings.secondValidationAbove * 100;
  const firstValidator = project.firstValidatedById ? await db.user.findUnique({ where: { id: project.firstValidatedById }, select: { firstName: true, lastName: true } }).then((u) => (u ? `${u.firstName} ${u.lastName}` : t("un membre de la conformité"))) : null;
  const teamActs = available.filter((k) => TRANSITIONS[k].roles !== "compliance");
  const selectedEvent = project.events.find((ev) => ev.id === evenement) ?? project.events[0] ?? null;
  const ev0 = selectedEvent ?? callEvent;

  const tabs: DossierTab[] = [
    { key: "apercu", label: t("Vue d'ensemble"), icon: LayoutDashboard },
    { key: "experts", label: t("Experts"), icon: Users, count: live.length || undefined, alert: counters > 0 },
    // Collaboration sans réunion (rédaction, étude…) : pas d'onglet Événement, sauf événement déjà rattaché.
    { key: "evenement", label: t("Événement"), icon: CalendarDays, count: project.events.length || undefined, disabled: project.events.length || callEvent ? undefined : !needsMeeting(project.typeId) ? t("Pas d'événement pour ce type de collaboration") : eventOpen ? undefined : t("S'ouvre à l'accord de principe") },
    { key: "conformite", label: t("Conformité"), icon: Scale, alert: (project.status === "EN_VALID" && isCompliance) || project.status === "BLOQUE" || project.status === "REFUS_ORDRE" || (isCompliance && matPending > 0) },
    { key: "documents", label: t("Documents"), icon: FileText, count: project._count.documents || undefined, alert: unsigned.length > 0 },
    { key: "budget", label: t("Budget"), icon: Wallet, alert: over },
    { key: "frais", label: t("Frais et voyages"), icon: Receipt, count: expensesToReview || undefined, alert: expensesToReview > 0, disabled: engagedLinks.length ? undefined : t("Après l'accord de principe d'un expert") },
    { key: "messagerie", label: t("Messagerie"), icon: MessagesSquare, count: toAnswerCount || undefined, alert: toAnswerCount > 0 },
  ];
  // « ?modifier=1 » (proposer d'autres conditions, reprendre le dossier) : l'onglet Experts, conditions dépliées.
  // L'ancien onglet « Marketing » est désormais dans « Événement ».
  const requested = onglet === "marketing" ? "evenement" : onglet;
  const active = tabs.find((tb) => tb.key === requested && !tb.disabled)?.key ?? (modifier === "1" ? "experts" : "apercu");

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
      {(k === "declaration" || k === "ordre") && cumulAttestable && (
        <label className="check text-sm">
          <input type="checkbox" name="attestCumul" value="1" required />{" "}{t("J'atteste que l'autorisation de cumul d'activités de {join} est jointe à la transmission à l'Ordre et conservée par l'organisation.", { join: noCumul.join(", ") })}
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
  /** Actions principales en avant ; décisions (bloquer, refus de l'Ordre, décliner) visibles ; le reste replié. */
  const transitionsBlock = (keys: TransitionKey[]) => {
    const main = keys.filter((k) => !DANGER.includes(k));
    const others = keys.filter((k) => DANGER.includes(k));
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
  };

  // Prochaine étape (vue d'ensemble) : ce qu'il reste à faire et les actions de l'équipe. La décision de la
  // conformité se prend dans son onglet, à côté des supports et des points d'attention.
  const nextStep = (
            <section className="card next-step" aria-labelledby="prochaine-etape">
              <span className="eyebrow-sm" id="prochaine-etape">{t("Prochaine étape")}</span>
              <p className="next-hint">{t(NEXT_HINT[project.status] ?? "")}</p>
              {soumission === "date" && project.status === "ACCORD" && (
                <p className="notice warn" role="alert">
                  {t("Soumission refusée : renseignez la date d'intervention (ou créez l'événement daté) avant de soumettre le dossier à la conformité. Elle fixe le délai d'examen et le dernier jour de la démarche EPS.")}{" "}
                  <Link href={`${base}?modifier=1#objet-titre`}>{t("Renseigner la date")}</Link>
                </p>
              )}
              {!planned && project.status === "ACCORD" && soumission !== "date" && <p className="hint">{t("La date d'intervention est requise pour soumettre le dossier à la conformité.")}</p>}
              {subDue && (subLate > 0
                ? <p className="notice warn">{t("Soumission à la conformité en retard de {n} j : l'échéance interne était le {date} ({lead} jours avant l'intervention).", { n: subLate, date: fmtDate(locale, subDue), lead: settings.submissionLeadDays })}</p>
                : <p className="hint">{t("À soumettre à la conformité avant le {date} (délai interne : {lead} jours avant l'intervention).", { date: fmtDate(locale, subDue), lead: settings.submissionLeadDays })}</p>)}
              {revDue && (revLate > 0
                ? <p className="notice warn">{t("Examen par la conformité en retard de {n} j : attendu avant le {date} ({days} jours ouvrés après la soumission).", { n: revLate, date: fmtDate(locale, revDue), days: settings.reviewDays })}</p>
                : <p className="hint">{t("Examen par la conformité attendu avant le {date} ({days} jours ouvrés après la soumission).", { date: fmtDate(locale, revDue), days: settings.reviewDays })}</p>)}
              {project.status === "EN_VALID" && !isCompliance && <p className="hint">{t("En attente de l'équipe Conformité.")}</p>}
              {teamActs.length > 0 && transitionsBlock(teamActs)}
              {/* Dupliquer : un nouveau dossier avec le même cadre (titre, type, domaine, objet), experts et date à choisir. */}
              {isProject && <p className="hint"><Link href={`/organisations/${id}/dossiers/nouveau?modele=${projectId}`}>{t("Dupliquer le dossier")}</Link> · {t("même cadre, nouveaux experts et nouvelle date")}</p>}
              {complianceActs.length > 0 && <Link className="btn" href={tabHref("conformite")}>{t("Examiner le dossier")}</Link>}
              {signStarted && isProject && (
                <p className="hint">{t("Une convention est en cours de signature ou déjà signée : le retour en accord de principe n'est plus possible. Si les conditions doivent changer, abandonnez le dossier (motif obligatoire) et ouvrez-en un nouveau.")}</p>
              )}
              {unsigned.length > 0 && !attestable && (
                <p className="hint">
                  {signatureEnabled()
                    ? t("Faites signer la convention de {join} depuis l'onglet Documents (signature électronique, ou dépôt de la convention signée) pour passer le dossier en « Signé ».", { join: unsigned.join(", ") })
                    : t("Déposez la convention signée de {join} dans l'onglet Documents pour passer le dossier en « Signé ».", { join: unsigned.join(", ") })}{" "}
                  <Link href={`${tabHref("documents")}#conventions`}>{t("Ouvrir les conventions")}</Link>
                </p>
              )}
              {noCumul.length > 0 && !cumulAttestable && isProject && (
                <p className="notice warn">
                  {t("Expert agent public : déposez l'autorisation de cumul d'activités de {join} (ou l'accusé de sa déclaration à l'employeur) dans l'onglet Documents. La déclaration ou la demande d'autorisation à l'Ordre doit la comporter.", { join: noCumul.join(", ") })}{" "}
                  <Link href={tabHref("documents")}>{t("Ouvrir les documents")}</Link>
                </p>
              )}
              {attestable && (
                <p className="hint">
                  {t("Le dépôt de documents n'est pas encore activé sur KolBase")}{signatureEnabled() ? t(" (la signature électronique reste possible depuis l'onglet Documents)") : ""}{" "}{t(": passer en « Signé » exige votre attestation, enregistrée à votre nom avec la date.")}
                </p>
              )}
            </section>
  );

  // ─── Vue d'ensemble : un repère par rubrique ─────────────────────────────────
  const evTab = tabs.find((tb) => tb.key === "evenement")!;
  const tiles = (
    <div className="state-grid">
      <StateTile
        href={tabHref("experts")} icon={Users} label={t("Experts")}
        value={project.experts.length ? t(engaged.length > 1 ? "{n} engagés sur {m}" : "{n} engagé sur {m}", { n: engaged.length, m: project.experts.length }) : t("Aucun expert")}
        detail={counters ? t(counters > 1 ? "{n} contre-propositions à traiter" : "{n} contre-proposition à traiter", { n: counters }) : waiting.length && !closed ? t(waiting.length > 1 ? "{n} réponses attendues" : "{n} réponse attendue", { n: waiting.length }) : engaged.length ? fmtEur(locale, total) + " " + t("HT engagés") : editable ? t("Sollicitez un premier expert") : t("Aucun expert engagé")}
        tone={counters ? "danger" : waiting.length && !closed ? "warn" : engaged.length ? "ok" : "neutral"}
      />
      <StateTile
        href={tabHref("evenement")} icon={CalendarDays} label={t("Événement")} disabled={!!evTab.disabled}
        value={ev0 ? `${fmtDate(locale, ev0.startsAt)}${ev0.city ? ` · ${ev0.city}` : ""}` : evTab.disabled ? t("Sans événement") : t("À créer")}
        detail={ev0
          ? (ev0.internal ? t("Réunion interne") : ev0.publishedAt ? t("Publié dans l'agenda") : ev0.reviewStatus === "submitted" ? t("En attente de la conformité") : t("Brouillon"))
          : evTab.disabled ?? (isProject && !finished ? t("Date, lieu, prestataires et communication") : "")}
        tone={ev0 ? (ev0.publishedAt ? "ok" : "neutral") : evTab.disabled ? "neutral" : "warn"}
      />
      <StateTile
        href={tabHref("conformite")} icon={Scale} label={t("Conformité")}
        value={regime ? t(REGIME_LABEL[regime.regime]) : t("Régime à déterminer")}
        detail={project.status === "BLOQUE" ? t("Bloqué : à reprendre") : project.status === "EN_VALID" ? t("En cours d'examen") : matPending ? t(matPending > 1 ? "{n} supports à relire" : "{n} support à relire", { n: matPending }) : matChanges ? t(matChanges > 1 ? "{n} supports à corriger" : "{n} support à corriger", { n: matChanges }) : conflictAlerts ? t(conflictAlerts > 1 ? "{n} points d'attention" : "{n} point d'attention", { n: conflictAlerts }) : ["VALIDE", "ORDRE", "SIGNATURE", "SIGNE", "TERMINE"].includes(project.status) ? t("Validé par la conformité") : t("Rien à signaler")}
        tone={project.status === "BLOQUE" || project.status === "REFUS_ORDRE" ? "danger" : project.status === "EN_VALID" || matPending || matChanges || conflictAlerts ? "warn" : ["VALIDE", "ORDRE", "SIGNATURE", "SIGNE", "TERMINE"].includes(project.status) ? "ok" : "neutral"}
      />
      <StateTile
        href={tabHref("documents")} icon={FileText} label={t("Documents")}
        value={engagedLinks.length ? t(engagedLinks.length > 1 ? "{n} conventions signées sur {m}" : "{n} convention signée sur {m}", { n: signedCount, m: engagedLinks.length }) : t("Pas encore de convention")}
        detail={unsigned.length ? t(unsigned.length > 1 ? "{n} conventions à faire signer" : "{n} convention à faire signer", { n: unsigned.length }) : t(project._count.documents > 1 ? "{n} documents déposés" : "{n} document déposé", { n: project._count.documents })}
        tone={unsigned.length ? "warn" : engagedLinks.length && signedCount === engagedLinks.length ? "ok" : "neutral"}
      />
      <StateTile
        href={tabHref("budget")} icon={Wallet} label={t("Budget")}
        value={budgetPct != null ? t("{pct} % engagé", { pct: budgetPct }) : `${fmtEur(locale, spent)} ${t("HT engagés")}`}
        detail={over ? t("Dépassé de {montant}", { montant: fmtEur(locale, spent - project.budgetCents!) }) : toPay ? t(toPay > 1 ? "{n} experts à payer" : "{n} expert à payer", { n: toPay }) : expensesDue ? t(expensesDue > 1 ? "{n} dépenses à régler" : "{n} dépense à régler", { n: expensesDue }) : project.budgetCents != null ? t("sur {montant} HT prévus", { montant: fmtEur(locale, project.budgetCents) }) : t("Budget à renseigner")}
        tone={over ? "danger" : toPay || expensesDue || project.budgetCents == null ? "warn" : "ok"}
      />
      <StateTile
        href={tabHref("messagerie")} icon={MessagesSquare} label={t("Messagerie")}
        value={toAnswerCount ? t(toAnswerCount > 1 ? "{n} messages à traiter" : "{n} message à traiter", { n: toAnswerCount }) : t("À jour")}
        detail={t(fils.length > 1 ? "{n} conversations" : "{n} conversation", { n: fils.length })}
        tone={toAnswerCount ? "danger" : "ok"}
      />
    </div>
  );

  // ─── Experts : une carte par expert, conditions modifiables dans la carte ────
  const expertCards = project.experts.map((e) => {
    const name = nameOf(e);
    const engagedOne = e.status !== "ATT_EXPERTS" && e.status !== "DECLINE";
    const photo = expertPhotoSrc(e.practitioner, kolViewer(user, e.practitionerId));
    const usablePhoto = engagedOne && photo && e.practitioner.photoConsentAt && e.practitioner.photoUpdatedAt;
    // Contre-proposition de l'expert : la sollicitation reste ouverte, l'organisation répond.
    const counter = e.status === "ATT_EXPERTS" && e.desiredFeeCents != null && !closed;
    const last = e.messages.at(-1);
    const toAnswer = last && last.authorId === e.practitioner.userId;
    const conv = conventionState(e);
    return (
      <article key={e.id} id={`expert-${e.id}`} className={`card expert-card${e.status === "DECLINE" ? " muted-card" : ""}`}>
        <div className="expert-head">
          <Avatar name={name} size={48} photo={photo} />
          <div className="who">
            <h3><Link href={`/annuaire/${e.practitionerId}`}>{name}</Link></h3>
            <div className="muted text-sm">
              {[t(e.practitioner.specialty ?? e.practitioner.profession), e.practitioner.city, !practicesInFrance(e.practitioner.country) ? country(e.practitioner.country).name : null].filter(Boolean).join(" · ")}
            </div>
          </div>
          <span className={`pill ${e.status === "DECLINE" ? "done" : e.status === "ATT_EXPERTS" ? "wait" : "ok"}`}>{expertState(e)}</span>
        </div>
        <div className="terms">
          <span className="term"><CalendarDays size={13} /> {unitCount(t, intlLocale(locale), e.days, type?.unit ?? "unité")}</span>
          <span className="term strong"><Euro size={13} /> {e.feeCents != null ? fmtEur(locale, e.feeCents) : "—"}{" "}{t("HT")}</span>
          {hoursOf(e) != null && (
            <span className="term" title={hoursDetail(e, t, intlLocale(locale))}>
              <Clock size={13} /> {t("{hours} · {rate} / h réel", { hours: fmtHours(hoursOf(e)!, intlLocale(locale)), rate: fmtEur(locale, Math.round((e.feeCents ?? 0) / hoursOf(e)!)) })}
            </span>
          )}
          {e.feeLevelLabel && <span className="term">{t("Grille : {label} ({rate} / h)", { label: e.feeLevelLabel, rate: e.hourlyCents != null ? fmtEur(locale, e.hourlyCents) : "—" })}</span>}
          <FmvBadge typeId={project.typeId} feeCents={e.feeCents} units={e.days} />
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
                <a className="btn ghost small" href={`${tabHref("experts", { modifier: "1" })}#expert-${e.id}`}>{t("Proposer d'autres conditions")}</a>
              </span>
            )}
          </div>
        )}
        {editable && (
          <details className="terms-edit" open={modifier === "1"}>
            <summary>{t("Modifier les conditions")}</summary>
            <ExpertTermsForm
              orgId={id} projectId={projectId} linkId={e.id}
              name={`${name}${e.status === "DECLINE" ? ` (${t("a décliné")})` : ""}`}
              hideName
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
          </details>
        )}
        <div className="expert-foot">
          <div className="foot-group">
            {engagedOne && (
              <Link className={`doc-chip ${conv.tone}`} href={`${tabHref("documents")}#conventions`}>
                <FileSignature size={14} aria-hidden />{t(conv.label)}
              </Link>
            )}
            {usablePhoto ? (
              <a className="doc-chip" href={photoPath(e.practitionerId, e.practitioner.photoUpdatedAt!, "grande")} download>
                <ImageDown size={14} aria-hidden />{t("Photo pour vos supports")}
              </a>
            ) : engagedOne && photo ? <span className="text-xs muted">{t("Photo : accord non donné pour vos supports")}</span> : null}
          </div>
          <div className="foot-group">
            <Link className="doc-chip" href={tabHref("messagerie", { fil: e.id })}>
              <MessagesSquare size={14} aria-hidden />
              {e.messages.length ? t(e.messages.length > 1 ? "{n} messages échangés" : "{n} message échangé", { n: e.messages.length }) : t("Écrire à l'expert")}
            </Link>
            {toAnswer && e.status !== "DECLINE" && <span className="pill electric">{t("À vous de répondre")}</span>}
          </div>
        </div>
      </article>
    );
  });

  return (
    <>
      <SiteHeader />
      <main className="stack dossier-page">
        <p className="muted"><Link href={`/organisations/${id}`}>{org.name}</Link> / <Link href={`/organisations/${id}/dossiers`}>{t("Dossiers")}</Link></p>

        {/* En-tête : ce qu'est le dossier, où il en est, qui le porte. Les chiffres sont dans les onglets. */}
        <header className="page-hero dossier-hero">
          <div className="hero-top">
            <span className="eyebrow-sm">{t(type?.label ?? project.typeId)}{project.therapeuticArea ? ` · ${t(project.therapeuticArea)}` : ""}</span>
            <StatusPill status={project.status} />
          </div>
          <h1>{project.title}</h1>
          <ul className="hero-meta">
            <li>
              <CalendarDays size={15} aria-hidden />
              {planned
                ? <span><strong>{t("Intervention le {date}", { date: fmtDate(locale, planned) })}</strong>{subDue ? ` · ${t("à soumettre avant le {date}", { date: fmtDate(locale, subDue) })}` : revDue ? ` · ${t("examen attendu avant le {date}", { date: fmtDate(locale, revDue) })}` : ""}</span>
                : <span>{t("Date d'intervention à préciser")}</span>}
            </li>
            <li>
              <User size={15} aria-hidden />
              {leads.length
                ? <span><strong>{leads.map((l) => `${l.user.firstName} ${l.user.lastName}`).join(", ")}</strong></span>
                : <span className="warn-text">{t("Responsable à désigner")}</span>}
            </li>
            <li><Clock size={15} aria-hidden /><span>{t("ouvert le {date}", { date: fmtDate(locale, project.createdAt) })}</span></li>
          </ul>
          <Pipeline status={project.status} compact />
        </header>
        {project.status === "ATT_IND" && <p className="notice warn">{t("Projet proposé par l'expert : acceptez-le pour ouvrir le circuit (conformité, convention, signature), ou déclinez-le. Le motif éventuel lui est transmis dans vos échanges.")}</p>}
        {proposalBlocked && <BillingNotice orgId={id} motive="proposition" objet={projectId} />}

        <DossierTabs tabs={tabs} active={active} href={(k: string) => tabHref(k)} label={t("Rubriques du dossier")} />

        {active === "apercu" && (
          <div className="page-grid aside-last">
            <div className="page-main">
              {nextStep}
              <section className="card" aria-labelledby="etat-titre">
                <SectionHead icon={LayoutDashboard} id="etat-titre" title={t("État du dossier")} desc={t("Chaque rubrique, et ce qui y attend une action.")} />
                {tiles}
              </section>
              <section className="card stack-sm" id="objet" aria-labelledby="objet-titre">
                <SectionHead icon={FileText} id="objet-titre" title={t("Objet du dossier")} desc={t("Repris dans la sollicitation de chaque expert et dans sa convention.")} />
                {project.description ? <p className="object-text">{project.description}</p> : <p className="muted">{t("Aucun objet renseigné.")}</p>}
                {project.framework && project.periodEnd && <p className="text-sm"><strong>{t("Contrat-cadre")}</strong> · {t("jusqu'au {date}", { date: fmtDate(locale, project.periodEnd) })}</p>}
                {editable && (
                  <details className="inline-edit" open={modifier === "1" && active === "apercu"}>
                    <summary>{t("Modifier l'objet")}</summary>
                    <ProjectObjectForm orgId={id} projectId={projectId} title={project.title} area={project.therapeuticArea ?? ""} description={project.description ?? ""} planned={project.plannedAt ? project.plannedAt.toISOString().slice(0, 10) : ""} framework={project.framework} periodEnd={project.periodEnd ? project.periodEnd.toISOString().slice(0, 10) : ""} />
                  </details>
                )}
              </section>
              <section className="card" aria-labelledby="historique-titre">
                <SectionHead icon={Clock} id="historique-titre" title={t("Historique")} desc={history.length ? t(history.length > 1 ? "{n} actions enregistrées, les plus récentes d'abord." : "{n} action enregistrée.", { n: history.length }) : undefined} />
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
              {project.status === "ATT_IND" && project.origin === PROPOSAL_ORIGIN && (
                <section className="card stack-sm" id="aiguillage" aria-labelledby="aiguillage-titre">
                  <SectionHead icon={Route} id="aiguillage-titre" title={t("Aiguillage")} tone={project.responseDue && project.responseDue < new Date() ? "danger" : "brand"}
                    desc={[project.channel || project.proposal?.topic ? t("Sujet : {topic}", { topic: t(topicLabel(project.channel?.topic ?? project.proposal?.topic)) }) : null, project.responseDue ? t("réponse attendue avant le {date}", { date: fmtDate(locale, project.responseDue) }) : null].filter(Boolean).join(" · ") || undefined} />
                  {project.proposal?.ndaRequested && <p className="notice warn text-sm">{t("Idée de produit : l'expert demande un accord de confidentialité avant de la détailler. Proposez-le dans la messagerie si vous souhaitez en savoir plus.")}</p>}
                  {isProject && transferTargets.length > 0 && (
                    <details className="disclosure">
                      <summary>{t("Transmettre à un autre interlocuteur")}</summary>
                      <TransferForm orgId={id} projectId={projectId} targets={transferTargets} />
                    </details>
                  )}
                </section>
              )}
              <section className="card stack-sm" id="responsables" aria-labelledby="responsables-titre">
                <SectionHead icon={User} id="responsables-titre" title={t("Responsables")} desc={t("Ils retrouvent le dossier dans « Mes dossiers » et en reçoivent les e-mails.")} />
                {leads.length === 0 ? (
                  <p className="text-sm muted">{t("Aucun responsable : les e-mails du dossier vont à toute l'équipe Projets.")}</p>
                ) : (
                  <ul className="lead-list">
                    {leads.map((l) => (
                      <li key={l.userId}>
                        <Avatar name={`${l.user.firstName} ${l.user.lastName}`} size={32} photo={accountPhoto({ id: l.user.id, photoUpdatedAt: l.user.photoUpdatedAt })} />
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
                <p className="hint">{t("Toute l'équipe Projets garde l'accès au dossier.")}</p>
              </section>
            </aside>
          </div>
        )}

        {active === "experts" && (
          <div className="stack" id="modifier">
            <SectionHead
              icon={Users}
              title={t("Experts")}
              desc={project.experts.length ? t(project.experts.length > 1 ? (engaged.length > 1 ? "{n} engagés sur {m} sollicités" : "{n} engagé sur {m} sollicités") : "{n} engagé sur {m} sollicité", { n: engaged.length, m: project.experts.length }) : t("Aucun expert sollicité pour l'instant.")}
            >
              {editable && <a className="btn small" href={`${tabHref("experts", { solliciter: "1" })}#solliciter`}><UserPlus size={15} aria-hidden />{t("Solliciter un expert")}</a>}
            </SectionHead>
            {project.experts.length === 0 && <div className="card empty"><Users size={26} strokeWidth={1.6} aria-hidden /><p className="muted">{t("Sollicitez un expert : il répond depuis son espace, avec vos conditions.")}</p></div>}
            <div className="expert-list">{expertCards}</div>
            {project.framework && <FrameworkPanel orgId={id} projectId={projectId} canEdit={isProject} />}
            {editable && (
              <details className="card add-card" id="solliciter" open={modifier === "1" || solliciter === "1" || project.experts.length === 0}>
                <summary>
                  <SectionHead icon={UserPlus} level={3} title={t("Solliciter un autre expert")} desc={t("Il reçoit votre proposition par e-mail et répond depuis son espace.")} />
                </summary>
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
              </details>
            )}
            {isProject && selectedEvent && (calls.length > 0 || recruitmentOpen(project.status)) && (
              <section className="card stack-sm" aria-labelledby="opportunites-titre">
                <SectionHead icon={Megaphone} id="opportunites-titre" title={t("Opportunités du dossier")} desc={t("Publiez une opportunité rattachée à l'événement du dossier : les experts référencés candidatent, ceux que vous retenez rejoignent ce dossier.")}>
                  {recruitmentOpen(project.status) && <Link className="btn ghost small" href={`/organisations/${id}/opportunites?evenement=${selectedEvent.id}#nouvel-appel`}>{t("Publier une opportunité")}</Link>}
                </SectionHead>
                {calls.length > 0 && (
                  <ul className="opp-list">
                    {calls.map((c) => {
                      const kept = c.applications.filter((a) => a.status === "retained");
                      const pending = c.applications.filter((a) => a.status === "pending").length;
                      return (
                        <li key={c.id}>
                          <div className="grow">
                            <strong>{c.title}</strong>
                            <div className="muted text-sm">
                              {kept.length}{c.slots ? ` / ${c.slots}` : ""}{" "}{t(kept.length > 1 ? "retenus" : "retenu")}
                              {pending ? ` · ${t(pending > 1 ? "{pending} candidatures à examiner" : "{pending} candidature à examiner", { pending })}` : ""}
                            </div>
                          </div>
                          <span className={`pill ${c.status !== "open" ? "done" : c.slots != null && kept.length >= c.slots ? "bad" : "ok"}`}>{c.status !== "open" ? t("Clôturé") : c.slots != null && kept.length >= c.slots ? t("Complet") : t("Ouvert")}</span>
                          <Link className="btn ghost small" href={`/organisations/${id}/opportunites/${c.id}`}>{t("Voir")}</Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
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
              <EventWorkspace orgId={id} eventId={selectedEvent.id} mode="dossier" publie={publie} retour={tabHref("evenement", project.events.length > 1 ? { evenement: selectedEvent.id } : {})} expertsHref={tabHref("experts")} />
            </div>
          ) : callEvent ? (
            <div className="stack">
              <p className="notice">{t("Dossier né de l'opportunité «")}{" "}{fromCall!.openCall.title}{" "}{t("» : l'intervention a lieu à cet événement, partagé avec les autres intervenants retenus.")}</p>
              <EventWorkspace orgId={id} eventId={callEvent.id} mode="dossier" publie={publie} retour={tabHref("evenement")} expertsHref={tabHref("experts")} />
            </div>
          ) : (
            <section className="card event-empty">
              <span className="sec-icon brand big" aria-hidden><CalendarDays size={26} strokeWidth={1.6} /></span>
              <h2>{t("L'événement du dossier")}</h2>
              <p className="muted">{t("Réunion, formation ou symposium : créez l'événement rattaché au dossier. Vous préparez dès maintenant la date, le lieu, le programme, les devis des prestataires et l'agence ; la publication dans l'agenda, les inscriptions et la communication s'ouvrent une fois le dossier validé par la conformité.")}</p>
              {isProject && !finished && <Link className="btn" href={`/organisations/${id}/evenements/nouveau?dossier=${projectId}`}>{t("Créer l'événement du dossier")}</Link>}
            </section>
          )
        )}

        {active === "conformite" && (
          <div className={complianceActs.length > 0 || (isCompliance && aiEnabled()) ? "page-grid" : "stack"}>
            <div className="page-main">
              <section className="card stack-sm" id="regime" aria-labelledby="regime-titre">
                <SectionHead icon={Scale} id="regime-titre" title={t("Régime")} desc={regime ? regimeReason(regime, t, intlLocale(locale)) : t("Déterminé dès qu'un expert aura accepté.")}>
                  {regime && <span className={`pill ${regime.regime === "autorisation" ? "wait" : regime.regime === "hors_france" ? "" : "ok"}`}>{t(REGIME_LABEL[regime.regime])}</span>}
                </SectionHead>
                {regime && (
                  <p className="text-sm">
                    {regime.regime === "hors_france"
                      ? t("Pas de démarche sur la plateforme EPS ; vérifiez les obligations du pays d'exercice avant la signature.")
                      : regime.regime === "autorisation"
                        ? t("Demande d'autorisation à adresser au moins {authorizationDays} jours avant l'exécution ; la déclaration simple n'est pas possible.", { authorizationDays: settings.authorizationDays })
                        : t("Déclaration à effectuer au moins {declarationDays} jours ouvrables avant l'exécution. Si une hospitalité dépasse les seuils, demandez l'autorisation.", { declarationDays: settings.declarationDays })}
                  </p>
                )}
                {epsDeadline && (
                  <p className={`notice ${epsLate ? "error" : "warn"}`}>
                    {epsLate
                      ? t("Délai EPS dépassé de {n} j : la démarche devait être faite avant le {date} (intervention le {planned}).", { n: epsLate, date: fmtDate(locale, epsDeadline), planned: fmtDate(locale, planned!) })
                      : t("Démarche EPS à faire avant le {date} (intervention le {planned}).", { date: fmtDate(locale, epsDeadline), planned: fmtDate(locale, planned!) })}
                  </p>
                )}
                {project.status === "VALIDE" && !planned && regime && regime.regime !== "hors_france" && (
                  <p className="muted text-sm">{t("Renseignez la date d'intervention du dossier pour connaître le dernier jour de la démarche EPS.")}</p>
                )}
                {project.complianceNote && <p className={`notice ${project.status === "BLOQUE" ? "error" : "ok"}`}>{t("Conformité : {complianceNote}", { complianceNote: project.complianceNote })}</p>}
                {project.epsDeclaredAt && (
                  <p className="muted text-sm">
                    {t("Déclaration EPS faite le {date}", { date: fmtDate(locale, project.epsDeclaredAt) })}{project.epsRef ? ` · ${t("réf. {ref}", { ref: project.epsRef })}` : ""}
                  </p>
                )}
                {project.ordreRef && (
                  <p className="muted text-sm">
                    {t("Demande à l'Ordre : {ordreRef}", { ordreRef: project.ordreRef })}{project.ordreRequestedAt ? ` · ${t("le {date}", { date: fmtDate(locale, project.ordreRequestedAt) })}` : ""}
                  </p>
                )}
                {project.signatureAttestedAt && (
                  <p className="notice warn">
                    {t("Signature attestée par")}{" "}{attester ? `${attester.firstName} ${attester.lastName}` : t("un membre de l'organisation")}{" "}{t("le {date} : convention signée conservée hors de KolBase, non déposée.", { date: project.signatureAttestedAt ? fmtDate(locale, project.signatureAttestedAt) : "" })}
                  </p>
                )}
              </section>
              <MaterialsPanel orgId={id} projectId={projectId} canSubmit={isProject} canReview={roles.some((r) => REVIEW_ROLES.includes(r))} />
              <ConflictsPanel projectId={projectId} />
              {foreignExperts.length > 0 && (
                <section className="card stack-sm" aria-labelledby="hors-france-titre">
                  <SectionHead icon={Globe} id="hors-france-titre" title={t("Experts exerçant hors de France")} desc={t("Repères donnés à titre indicatif, à faire valider par votre service juridique.")} />
                  {foreignExperts.map((e) => (
                    <div key={e.id}>
                      <strong>{drPrefix(e.practitioner.profession)}{e.practitioner.user.firstName} {e.practitioner.user.lastName}</strong> · {country(e.practitioner.country).name}
                      <ul className="text-sm">{foreignObligations(e.practitioner.country).map((o) => <li key={o}>{o}</li>)}</ul>
                    </div>
                  ))}
                </section>
              )}
            </div>
            {(complianceActs.length > 0 || (isCompliance && aiEnabled())) && (
              <aside className="page-aside">
                {complianceActs.length > 0 && (
                  <section className="card next-step" aria-labelledby="decision-titre">
                    <span className="eyebrow-sm" id="decision-titre">{t("Décision de la conformité")}</span>
                    <p className="next-hint">{t(NEXT_HINT[project.status] ?? "")}</p>
                    {revDue && (revLate > 0
                      ? <p className="notice warn">{t("Examen en retard de {n} j : attendu avant le {date}.", { n: revLate, date: fmtDate(locale, revDue) })}</p>
                      : <p className="hint">{t("Examen attendu avant le {date}.", { date: fmtDate(locale, revDue) })}</p>)}
                    {fourEyesRule === "blocked" && <p className="notice warn">{t(FOUR_EYES_BLOCKED)}</p>}
                    {fourEyesRule === "justify" && <p className="hint">{t(FOUR_EYES_JUSTIFY)}</p>}
                    {secondValidation && (
                      project.firstValidatedById
                        ? <p className={`notice ${project.firstValidatedById === user.id ? "warn" : "ok"}`}>
                            {t("Première validation par {name} le {date}.", { name: firstValidator, date: fmtDate(locale, project.firstValidatedAt!) })}{" "}
                            {project.firstValidatedById === user.id ? t("La seconde validation doit venir d'un autre membre de la conformité.") : t("Votre validation sera la seconde : le dossier passera « Validé ».")}
                          </p>
                        : <p className="hint">{t("Honoraires au-delà de {max} HT : deux validations, par deux membres de la conformité, sont requises. La vôtre sera la première.", { max: fmtEur(locale, settings.secondValidationAbove * 100) })}</p>
                    )}
                    {transitionsBlock(complianceActs)}
                  </section>
                )}
                {isCompliance && aiEnabled() && (
                  <section className="card stack-sm" aria-labelledby="ia-titre">
                    <SectionHead icon={Sparkles} id="ia-titre" title={t("Relecture assistée")} />
                    <AiReview orgId={id} projectId={projectId} />
                  </section>
                )}
              </aside>
            )}
          </div>
        )}

        {active === "documents" && (
          <div className="stack">
            <section className="card stack-sm" id="conventions" aria-labelledby="conventions-titre">
              <SectionHead
                icon={FileSignature} id="conventions-titre" title={t("Conventions")}
                desc={engagedLinks.length ? t("Une convention par expert engagé : le PDF à faire signer, la signature électronique, ou le dépôt de la version signée.") : t("La convention de chaque expert apparaît ici dès son accord de principe.")}
              >
                {engagedLinks.length > 0 && <span className={`pill ${signedCount === engagedLinks.length ? "ok" : unsigned.length ? "wait" : "done"}`}>{t("{n} / {m} signées", { n: signedCount, m: engagedLinks.length })}</span>}
              </SectionHead>
              {engagedLinks.length > 0 && (
                <ul className="convention-list">
                  {engagedLinks.map((e) => {
                    const conv = conventionState(e);
                    return (
                      <li key={e.id}>
                        <div className="conv-row">
                          <Avatar name={nameOf(e)} size={36} photo={expertPhotoSrc(e.practitioner, kolViewer(user, e.practitionerId))} />
                          <span className="who">
                            <strong>{nameOf(e)}</strong>
                            <span className="muted text-xs">{unitCount(t, intlLocale(locale), e.days, type?.unit ?? "unité")} · {e.feeCents != null ? `${fmtEur(locale, e.feeCents)} ${t("HT")}` : "—"}</span>
                          </span>
                          <span className={`pill ${conv.tone}`}>{t(conv.label)}</span>
                          <span className="conv-actions">
                            <a className="btn ghost small" href={`/organisations/${id}/dossiers/${projectId}/convention/${e.id}`} target="_blank" rel="noreferrer"><FileDown size={14} aria-hidden />{t("Convention (PDF)")}</a>
                            <a className="link text-sm" href={`/organisations/${id}/dossiers/${projectId}/convention/${e.id}?lang=en`} target="_blank" rel="noreferrer" title={t("Traduction de courtoisie : la version française fait foi")}>{t("version anglaise")}</a>
                          </span>
                        </div>
                        <ConventionSignatureBlock orgId={id} linkId={e.id} signature={e.signature} projectStatus={project.status} canSend={isProject} deposited={e.documents.length > 0} />
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
            <DocumentsPanel projectId={projectId} canUpload={isProject || isCompliance} openUpload={project.status === "SIGNATURE"} />
          </div>
        )}

        {active === "budget" && <BudgetTab orgId={id} projectId={projectId} canEdit={isProject} />}

        {active === "frais" && <ExpertCostsTab orgId={id} projectId={projectId} canEdit={isProject} />}

        {active === "messagerie" && (
          fils.length === 0 ? (
            <section className="card empty"><MessagesSquare size={26} strokeWidth={1.6} aria-hidden /><p className="muted">{t("Aucune conversation : sollicitez un expert pour lui écrire.")}</p></section>
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
      </main>
    </>
  );
}
