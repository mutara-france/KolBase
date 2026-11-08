"use server";

import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit, requireUser } from "@/lib/auth";
import { eurToCents, str, UNITS_INVALID, unitsOrNull } from "@/lib/form";
import { collabType, PROJECT_ROLES, PROPOSAL_MAX_ORGS, PROPOSAL_ORIGIN, PROPOSAL_WITHDRAWN, PROPOSALS_PER_MONTH, proposalText } from "@/lib/projects";
import { ALLOWED_TYPES, matchesType, MAX_UPLOAD_BYTES, putObject, safeFileName, storageEnabled } from "@/lib/storage";
import { notifyProposal, notifyProposalWithdrawnByExpert } from "@/lib/notifications";
import { getT } from "@/lib/i18n/server";
import { groupEntities, proposalsThisMonth } from "@/lib/proposals";
import { isTopic, pickChannel, pickEntity, responseDue } from "@/lib/routing";

export type ProposalState = { error?: string; ok?: string } | undefined;

/**
 * Projet proposé par un expert référencé à une à cinq organisations (hors prestataires), validées et référencées.
 * Chacune reçoit sa copie : un dossier « Proposition de l'expert » qu'elle accepte (abonnement requis, comme une
 * sollicitation) ou décline. Rien n'indique aux organisations les autres destinataires.
 */
export async function submitProposal(_: ProposalState, form: FormData): Promise<ProposalState> {
  const user = await requireUser();
  const { t } = await getT();
  const prac = user.practitioner;
  if (!prac?.listed) return { error: t("Référencez-vous comme expert pour proposer un projet.") };

  const title = str(form, "title", 160);
  const typeId = str(form, "typeId");
  const area = str(form, "therapeuticArea", 120);
  const description = str(form, "description", 6000);
  const audience = str(form, "audience", 2000);
  const schedule = str(form, "schedule", 1000);
  const logistics = str(form, "logistics", 2000);
  if (!title) return { error: t("Donnez un titre à votre projet.") };
  const type = collabType(typeId);
  if (!type) return { error: t("Type de collaboration invalide.") };
  if (description.length < 30) return { error: t("Décrivez l'objectif et le contenu du projet en quelques lignes (30 caractères minimum).") };
  const feeRaw = str(form, "fee");
  const fee = eurToCents(feeRaw);
  if (feeRaw && fee === null) return { error: t("Honoraires invalides : indiquez un montant en euros HT.") };
  const parsedUnits = unitsOrNull(str(form, "units"));
  if (parsedUnits === undefined) return { error: t(UNITS_INVALID) };
  const units = parsedUnits ?? 1;
  if (form.get("attest") !== "1") return { error: t("Cochez l'engagement : une prestation réelle, rémunérée à sa juste valeur.") };

  const picked = [...new Set(form.getAll("orgId").map(String).filter(Boolean))];
  if (picked.length === 0) return { error: t("Choisissez au moins une organisation.") };
  if (picked.length > PROPOSAL_MAX_ORGS) return { error: t("Cinq organisations au plus par proposition.") };
  // Sujet : aiguille la proposition vers le bon canal (responsable, délai) ; idée de produit : conditions acceptées.
  const topic = str(form, "topic") || "autre";
  if (!isTopic(topic)) return { error: t("Sujet invalide.") };
  const brand = str(form, "brand", 60) || null;
  if (topic === "innovation" && form.get("ipAck") !== "1") return { error: t("Idée de produit : prenez connaissance des conditions de soumission et cochez la case.") };
  const ndaRequested = topic === "innovation" && form.get("nda") === "1";
  // Groupe choisi : l'entité qui couvre le pays de l'expert (et la marque) reçoit la proposition.
  const orgIds: string[] = [];
  for (const v of picked) {
    if (!v.startsWith("group:")) { orgIds.push(v); continue; }
    const entity = pickEntity(await groupEntities(v.slice(6)), { country: prac.country, brand });
    if (!entity) return { error: t("Une des organisations choisies ne reçoit pas de propositions (introuvable ou non référencée).") };
    orgIds.push(entity.id);
  }
  const orgs = await db.organization.findMany({
    where: { id: { in: [...new Set(orgIds)] }, listed: true, verification: "VERIFIED", kind: { not: "PRESTATAIRE" } },
    select: { id: true, name: true, responseDays: true, channels: true, members: { where: { role: { in: PROJECT_ROLES } }, select: { userId: true } } },
  });
  if (orgs.length !== new Set(orgIds).size) return { error: t("Une des organisations choisies ne reçoit pas de propositions (introuvable ou non référencée).") };

  if ((await proposalsThisMonth(prac.id)) >= PROPOSALS_PER_MONTH)
    return { error: t("Vous avez envoyé {n} propositions ces 30 derniers jours, le maximum : attendez les réponses avant d'en envoyer d'autres.", { n: PROPOSALS_PER_MONTH }) };
  // Une proposition à la fois par organisation : la précédente attend sa réponse (ou l'expert la retire).
  const pendingAt = await db.project.findMany({
    where: { organizationId: { in: orgIds }, status: "ATT_IND", origin: PROPOSAL_ORIGIN, experts: { some: { practitionerId: prac.id } } },
    select: { organization: { select: { name: true } } },
  });
  if (pendingAt.length)
    return { error: t("Une proposition attend déjà la réponse de {orgs} : attendez-la, ou retirez-la depuis « Mes propositions », avant d'en envoyer une autre.", { orgs: [...new Set(pendingAt.map((p) => p.organization.name))].join(", ") }) };

  // Pièce jointe facultative (protocole, programme…), déposée dans chaque copie.
  const file = form.get("file");
  let attachment: { bytes: Uint8Array; name: string; type: string } | null = null;
  if (file instanceof File && file.size > 0) {
    if (!storageEnabled()) return { error: t("Le dépôt de documents n'est pas encore activé (stockage non configuré).") };
    if (file.size > MAX_UPLOAD_BYTES) return { error: t("Fichier trop lourd : 10 Mo au maximum.") };
    if (!(file.type in ALLOWED_TYPES)) return { error: t("Format non accepté : PDF, JPEG, PNG, Word, Excel ou PowerPoint.") };
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!matchesType(file.type, bytes))
      return { error: file.type === "application/pdf" ? t("Ce fichier n'est pas un PDF valide.") : t("Format non accepté : PDF, JPEG, PNG, Word, Excel ou PowerPoint.") };
    attachment = { bytes, name: file.name.slice(0, 200), type: file.type };
  }

  const text = proposalText({ description, audience, schedule, logistics });
  const now = new Date();
  const { proposal, copies } = await db.$transaction(async (tx) => {
    const proposal = await tx.expertProposal.create({
      data: {
        practitionerId: prac.id, title, typeId, therapeuticArea: area || null, description, audience: audience || null, schedule: schedule || null, logistics: logistics || null, feeCents: fee, units,
        topic, ipAckAt: topic === "innovation" ? now : null, ndaRequested,
      },
    });
    const copies: { projectId: string; linkId: string; orgId: string }[] = [];
    for (const org of orgs) {
      // Canal du sujet : son responsable (et son suppléant), encore membres, deviennent responsables du dossier.
      const channel = pickChannel(org.channels, topic);
      const team = new Set(org.members.map((m) => m.userId));
      const leads = channel ? [channel.ownerId, channel.backupId].filter((u): u is string => !!u && team.has(u)) : [];
      const days = channel?.responseDays ?? org.responseDays ?? null;
      const project = await tx.project.create({
        data: {
          organizationId: org.id, title, typeId, therapeuticArea: area || prac.specialty, description: text,
          origin: PROPOSAL_ORIGIN, status: "ATT_IND", createdById: user.id, proposalId: proposal.id,
          channelId: channel?.id ?? null, responseDue: days ? responseDue(now, days) : null,
          leads: { create: [...new Set(leads)].map((userId) => ({ userId })) },
          experts: { create: { practitionerId: prac.id, status: "ACCORD", feeCents: fee, days: units, respondedAt: now } },
        },
        include: { experts: { select: { id: true } } },
      });
      const linkId = project.experts[0].id;
      await tx.message.create({ data: { projectId: project.id, projectExpertId: linkId, authorId: user.id, body: text } });
      copies.push({ projectId: project.id, linkId, orgId: org.id });
    }
    return { proposal, copies };
  });

  for (const c of copies) {
    if (attachment) {
      const key = `dossiers/${c.projectId}/${randomBytes(8).toString("hex")}-${safeFileName(attachment.name)}`;
      await putObject(key, attachment.bytes, attachment.type);
      await db.document.create({ data: { projectId: c.projectId, projectExpertId: c.linkId, kind: "PIECE", name: attachment.name, contentType: attachment.type, size: attachment.bytes.byteLength, storageKey: key, uploadedById: user.id } });
    }
    await audit(user.id, "project.propose", "Project", c.projectId, { orgId: c.orgId, proposalId: proposal.id });
    notifyProposal(c.projectId);
    revalidatePath(`/organisations/${c.orgId}/dossiers`);
  }
  revalidatePath("/propositions");
  redirect(`/propositions?envoyee=${proposal.id}`);
}

/** L'expert retire sa proposition tant que l'organisation n'a pas répondu : le dossier est clos, elle est prévenue. */
export async function withdrawProposal(form: FormData) {
  const user = await requireUser();
  const link = await db.projectExpert.findFirst({
    where: { id: str(form, "linkId"), practitioner: { userId: user.id }, project: { status: "ATT_IND", origin: PROPOSAL_ORIGIN } },
    select: { id: true, projectId: true, project: { select: { organizationId: true } } },
  });
  if (!link) return;
  const now = new Date();
  await db.$transaction([
    db.project.update({ where: { id: link.projectId }, data: { status: "DECLINE" } }),
    db.projectExpert.update({ where: { id: link.id }, data: { status: "DECLINE", responseNote: PROPOSAL_WITHDRAWN, respondedAt: now } }),
  ]);
  await audit(user.id, "project.withdraw_proposal", "Project", link.projectId, { from: "ATT_IND", to: "DECLINE" });
  notifyProposalWithdrawnByExpert(link.projectId);
  revalidatePath("/propositions");
  revalidatePath(`/sollicitations/${link.id}`);
  revalidatePath(`/organisations/${link.project.organizationId}/dossiers/${link.projectId}`);
}
