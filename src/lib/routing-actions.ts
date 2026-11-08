"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/auth";
import { requireMembership } from "@/lib/orgs";
import { str } from "@/lib/form";
import { requirePlatformAdmin } from "@/lib/platform";
import { isCountry } from "@/lib/countries";
import { PROJECT_ROLES, PROPOSAL_ORIGIN } from "@/lib/projects";
import { DEFAULT_RESPONSE_DAYS, isTopic, MAX_RESPONSE_DAYS, parseBrands, parseCountries, pickChannel, responseDue } from "@/lib/routing";
import { notifyProposal, notifyProposalTransferred } from "@/lib/notifications";
import { getT } from "@/lib/i18n/server";

export type ActionState = { error?: string; ok?: string } | undefined;

/** Périmètre d'une entité de groupe : pays couverts (vide : siège, tous pays) et marques. */
export async function savePerimeter(_: ActionState, form: FormData): Promise<ActionState> {
  const { t } = await getT();
  const orgId = str(form, "orgId");
  const { user, org } = await requireMembership(orgId, ["ADMIN"]);
  const coveredCountries = parseCountries(str(form, "countries", 400), isCountry);
  const brands = parseBrands(str(form, "brands", 1500));
  await db.organization.update({ where: { id: org.id }, data: { coveredCountries, brands } });
  await audit(user.id, "org.perimeter", "Organization", org.id, { countries: coveredCountries, brands });
  revalidatePath(`/organisations/${orgId}/canaux`);
  return { ok: t("Périmètre enregistré.") };
}

/** Canal d'un sujet : responsable et suppléant (membres Administrateur ou Projets), délai de réponse, conditions. */
export async function saveChannel(_: ActionState, form: FormData): Promise<ActionState> {
  const { t } = await getT();
  const orgId = str(form, "orgId");
  const { user } = await requireMembership(orgId, ["ADMIN"]);
  const topic = str(form, "topic");
  if (!isTopic(topic)) return { error: t("Sujet invalide.") };
  const team = new Set((await db.membership.findMany({ where: { organizationId: orgId, role: { in: PROJECT_ROLES } }, select: { userId: true } })).map((m) => m.userId));
  const ownerId = str(form, "ownerId");
  if (!team.has(ownerId)) return { error: t("Le responsable est un membre Administrateur ou Projets de l'organisation.") };
  const backupId = str(form, "backupId") || null;
  if (backupId && (!team.has(backupId) || backupId === ownerId)) return { error: t("Le suppléant est un autre membre Administrateur ou Projets.") };
  const days = Number(str(form, "responseDays")) || DEFAULT_RESPONSE_DAYS;
  if (!Number.isInteger(days) || days < 1 || days > MAX_RESPONSE_DAYS) return { error: t("Délai de réponse : de 1 à 60 jours.") };
  const ipPolicy = topic === "innovation" ? str(form, "ipPolicy", 2000) || null : null;
  const data = { ownerId, backupId, responseDays: days, ipPolicy };
  await db.contactChannel.upsert({ where: { organizationId_topic: { organizationId: orgId, topic } }, create: { organizationId: orgId, topic, ...data }, update: data });
  await audit(user.id, "org.channel", "Organization", orgId, { topic, ownerId, days });
  revalidatePath(`/organisations/${orgId}/canaux`);
  return { ok: t("Canal enregistré : les propositions sur ce sujet arrivent à son responsable.") };
}

export async function removeChannel(form: FormData) {
  const orgId = str(form, "orgId");
  const { user } = await requireMembership(orgId, ["ADMIN"]);
  const { count } = await db.contactChannel.deleteMany({ where: { id: str(form, "channelId"), organizationId: orgId } });
  if (count) await audit(user.id, "org.channel_remove", "Organization", orgId);
  revalidatePath(`/organisations/${orgId}/canaux`);
}

/**
 * Transfert d'une proposition d'expert non encore acceptée : à une autre entité du même groupe (pays, marque) ou à un
 * autre canal de l'organisation. Le dossier change de responsable ; le nouvel interlocuteur et l'expert sont prévenus.
 */
export async function transferProposal(_: ActionState, form: FormData): Promise<ActionState> {
  const { t } = await getT();
  const orgId = str(form, "orgId");
  const { user, org } = await requireMembership(orgId, PROJECT_ROLES);
  const project = await db.project.findFirst({ where: { id: str(form, "projectId"), organizationId: orgId, status: "ATT_IND", origin: PROPOSAL_ORIGIN }, include: { proposal: { select: { topic: true } }, experts: { select: { practitionerId: true } } } });
  if (!project) return { error: t("Proposition introuvable ou déjà traitée.") };
  const [targetOrgId, topicRaw] = str(form, "target").split("|");
  const topic = isTopic(topicRaw ?? "") ? topicRaw : project.proposal?.topic ?? "autre";
  const target = await db.organization.findFirst({
    where: { id: targetOrgId, listed: true, verification: "VERIFIED", kind: { not: "PRESTATAIRE" }, ...(targetOrgId === orgId ? {} : { groupId: org.groupId ?? "—" }) },
    include: { channels: true, members: { where: { role: { in: PROJECT_ROLES } }, select: { userId: true } } },
  });
  if (!target) return { error: t("Destinataire invalide : une entité du même groupe, ou un canal de l'organisation.") };
  if (target.id !== orgId && (await db.project.count({ where: { organizationId: target.id, status: "ATT_IND", origin: PROPOSAL_ORIGIN, experts: { some: { practitionerId: { in: project.experts.map((e) => e.practitionerId) } } } } })))
    return { error: t("Cette entité a déjà une proposition de cet expert en attente.") };
  const channel = pickChannel(target.channels, topic);
  if (target.id === orgId && channel?.id === project.channelId) return { error: t("La proposition est déjà sur ce canal.") };
  const team = new Set(target.members.map((m) => m.userId));
  const leads = channel ? [channel.ownerId, channel.backupId].filter((u): u is string => !!u && team.has(u)) : [];
  const days = channel?.responseDays ?? target.responseDays ?? null;
  const now = new Date();
  await db.$transaction([
    db.projectLead.deleteMany({ where: { projectId: project.id } }),
    db.project.update({
      where: { id: project.id },
      data: { organizationId: target.id, channelId: channel?.id ?? null, responseDue: days ? responseDue(now, days) : null, leads: { create: [...new Set(leads)].map((userId) => ({ userId })) } },
    }),
    ...(project.proposalId ? [db.expertProposal.update({ where: { id: project.proposalId }, data: { topic } })] : []),
  ]);
  await audit(user.id, "project.transfer", "Project", project.id, { from: orgId, to: target.id, topic, note: str(form, "note", 500) || undefined });
  notifyProposal(project.id);
  notifyProposalTransferred(project.id, org.name);
  revalidatePath(`/organisations/${orgId}/dossiers`);
  revalidatePath(`/organisations/${target.id}/dossiers`);
  return { ok: target.id === orgId ? t("Proposition transmise au responsable du sujet.") : t("Proposition transmise à {org}.", { org: target.name }) };
}

/** Rattachement d'une organisation à un groupe (équipe KolBase) : groupe existant, nouveau groupe, ou aucun. */
export async function adminSetGroup(_: ActionState, form: FormData): Promise<ActionState> {
  const admin = await requirePlatformAdmin();
  const orgId = str(form, "orgId");
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { id: true, kind: true } });
  if (!org || org.kind === "PRESTATAIRE") return { error: "Organisation introuvable." };
  const choice = str(form, "groupId");
  const name = str(form, "newGroup", 120);
  let groupId: string | null = null;
  if (choice === "nouveau") {
    if (!name) return { error: "Indiquez le nom du nouveau groupe." };
    groupId = (await db.orgGroup.create({ data: { name } })).id;
  } else if (choice) {
    if (!(await db.orgGroup.count({ where: { id: choice } }))) return { error: "Groupe introuvable." };
    groupId = choice;
  }
  await db.organization.update({ where: { id: orgId }, data: { groupId } });
  await audit(admin.id, "admin.org_group", "Organization", orgId, { groupId });
  revalidatePath(`/admin/organisations/${orgId}`);
  return { ok: groupId ? "Organisation rattachée au groupe." : "Organisation détachée de son groupe." };
}
