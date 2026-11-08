"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit, requireUser } from "@/lib/auth";
import { requireMembership } from "@/lib/orgs";
import { dayOrNull, eurToCents, str } from "@/lib/form";
import { EVENT_MANAGER_ROLES, EVENT_ORGANIZER_ROLES, eventScope, parseParisDateTime } from "@/lib/events";
import {
  abstractsOpen, isAbstractFormat, isPartnerLevel, isProgramKind, MAX_ABSTRACT_CHARS, MAX_ABSTRACTS_PER_USER, parseTopics, programSlot,
} from "@/lib/congress";
import { notifyAbstractDecision, notifyPartnershipAnswered, notifyPartnershipProposed } from "@/lib/notifications";
import { getT } from "@/lib/i18n/server";

export type ActionState = { error?: string; ok?: string } | undefined;

/** Événement géré par l'utilisateur (organisation, agence mandatée) ; `organizer` : équipe interne seule. */
async function managed(form: FormData, { organizer = false } = {}) {
  const orgId = str(form, "orgId");
  const { user, roles } = await requireMembership(orgId, organizer ? EVENT_ORGANIZER_ROLES : EVENT_MANAGER_ROLES);
  const event = await db.event.findFirst({ where: { id: str(form, "eventId"), organizationId: orgId, internal: false, ...eventScope(user, roles) } });
  return { orgId, user, event };
}

const refresh = (orgId: string, eventId: string) => {
  revalidatePath(`/organisations/${orgId}/evenements/${eventId}`);
  revalidatePath(`/evenements/${eventId}`);
  revalidatePath(`/evenements/${eventId}/communications`);
  revalidatePath(`/organisations/${orgId}/dossiers`, "layout");
};

// ─── Programme en salles ──────────────────────────────────────────────────

export async function addRoom(_: ActionState, form: FormData): Promise<ActionState> {
  const { t } = await getT();
  const { orgId, user, event } = await managed(form);
  if (!event) return { error: t("Événement introuvable.") };
  const name = str(form, "name", 80);
  if (!name) return { error: t("Indiquez le nom de la salle.") };
  const n = await db.eventRoom.count({ where: { eventId: event.id } });
  if (n >= 30) return { error: t("Trente salles au plus.") };
  const capacity = Number(str(form, "capacity")) || null;
  await db.eventRoom.create({ data: { eventId: event.id, name, capacity: capacity && capacity > 0 && capacity < 100000 ? Math.round(capacity) : null, position: n } });
  await audit(user.id, "event.room", "Event", event.id, { name });
  refresh(orgId, event.id);
  return { ok: t("Salle ajoutée.") };
}

export async function removeRoom(form: FormData) {
  const { orgId, user, event } = await managed(form);
  if (!event) return;
  const { count } = await db.eventRoom.deleteMany({ where: { id: str(form, "roomId"), eventId: event.id } });
  if (count) await audit(user.id, "event.room_remove", "Event", event.id);
  refresh(orgId, event.id);
}

/** Séance du programme : jour et horaires, salle, nature, titre, intervenants, partenaire d'un symposium. */
export async function addProgramItem(_: ActionState, form: FormData): Promise<ActionState> {
  const { t } = await getT();
  const { orgId, user, event } = await managed(form);
  if (!event) return { error: t("Événement introuvable.") };
  const slot = programSlot(str(form, "day"), str(form, "start"), str(form, "end"));
  if (typeof slot === "string") return { error: t(slot) };
  const kind = str(form, "kind");
  if (!isProgramKind(kind)) return { error: t("Nature de séance invalide.") };
  const title = str(form, "title", 200);
  if (!title) return { error: t("Indiquez le titre de la séance.") };
  const roomId = str(form, "roomId") || null;
  if (roomId && !(await db.eventRoom.count({ where: { id: roomId, eventId: event.id } }))) return { error: t("Salle introuvable.") };
  const partnerId = str(form, "partnerId") || null;
  if (partnerId && !(await db.eventPartner.count({ where: { id: partnerId, eventId: event.id } }))) return { error: t("Partenaire introuvable.") };
  if ((await db.programItem.count({ where: { eventId: event.id } })) >= 400) return { error: t("Programme complet : 400 séances au plus.") };
  await db.programItem.create({ data: { eventId: event.id, ...slot, kind, title, speakers: str(form, "speakers", 400) || null, roomId, partnerId } });
  await audit(user.id, "event.program_item", "Event", event.id, { title });
  refresh(orgId, event.id);
  return { ok: t("Séance ajoutée au programme.") };
}

export async function removeProgramItem(form: FormData) {
  const { orgId, user, event } = await managed(form);
  if (!event) return;
  const { count } = await db.programItem.deleteMany({ where: { id: str(form, "itemId"), eventId: event.id } });
  if (count) await audit(user.id, "event.program_item_remove", "Event", event.id);
  refresh(orgId, event.id);
}

// ─── Appel à communications ───────────────────────────────────────────────

/** Ouverture (ou prolongation) de l'appel à communications : date limite et thèmes. */
export async function openAbstracts(_: ActionState, form: FormData): Promise<ActionState> {
  const { t } = await getT();
  const { orgId, user, event } = await managed(form, { organizer: true });
  if (!event) return { error: t("Événement introuvable.") };
  // Fin de journée à Paris (23 h 59) : la date affichée est incluse.
  const deadline = dayOrNull(str(form, "deadline")) ? parseParisDateTime(`${str(form, "deadline")}T23:59`) : null;
  if (!deadline) return { error: t("Indiquez la date limite de soumission.") };
  if (deadline <= new Date()) return { error: t("La date limite doit être à venir.") };
  if (deadline >= event.startsAt) return { error: t("La date limite précède le début de l'événement.") };
  const topics = parseTopics(str(form, "topics", 4000));
  await db.event.update({ where: { id: event.id }, data: { abstractsDeadline: deadline, abstractTopics: topics } });
  await audit(user.id, "event.abstracts_open", "Event", event.id, { deadline, topics: topics.length });
  refresh(orgId, event.id);
  return { ok: event.publishedAt ? t("Appel à communications ouvert : il figure sur la page de l'événement.") : t("Appel à communications prêt : il s'ouvrira à la publication de l'événement.") };
}

export async function closeAbstracts(form: FormData) {
  const { orgId, user, event } = await managed(form, { organizer: true });
  if (!event?.abstractsDeadline) return;
  await db.event.update({ where: { id: event.id }, data: { abstractsDeadline: new Date() } });
  await audit(user.id, "event.abstracts_close", "Event", event.id);
  refresh(orgId, event.id);
}

/** Soumission d'une communication (résumé) par un utilisateur connecté, tant que l'appel est ouvert. */
export async function submitAbstract(_: ActionState, form: FormData): Promise<ActionState> {
  const { t } = await getT();
  const user = await requireUser();
  const event = await db.event.findUnique({ where: { id: str(form, "eventId") }, select: { id: true, organizationId: true, abstractsDeadline: true, abstractTopics: true, publishedAt: true, cancelledAt: true } });
  if (!event || !abstractsOpen(event)) return { error: t("L'appel à communications est clos.") };
  if ((await db.abstract.count({ where: { eventId: event.id, userId: user.id, status: { not: "withdrawn" } } })) >= MAX_ABSTRACTS_PER_USER) return { error: t("Trois communications au plus par personne.") };
  const title = str(form, "title", 250);
  const authors = str(form, "authors", 600);
  const body = str(form, "body", MAX_ABSTRACT_CHARS + 1);
  if (!title || !authors || !body) return { error: t("Titre, auteurs et résumé sont obligatoires.") };
  if (body.length > MAX_ABSTRACT_CHARS) return { error: t("Résumé trop long : 3 000 caractères au plus.") };
  const format = str(form, "format");
  if (!isAbstractFormat(format)) return { error: t("Format invalide.") };
  const topic = str(form, "topic") || null;
  if (topic && !event.abstractTopics.includes(topic)) return { error: t("Thème invalide.") };
  const a = await db.abstract.create({ data: { eventId: event.id, userId: user.id, title, authors, body, topic, format } });
  await audit(user.id, "abstract.submit", "Event", event.id, { abstractId: a.id });
  refresh(event.organizationId, event.id);
  return { ok: t("Communication soumise : le comité vous répond par e-mail.") };
}

export async function withdrawAbstract(form: FormData) {
  const user = await requireUser();
  const a = await db.abstract.findFirst({ where: { id: str(form, "abstractId"), userId: user.id, status: "submitted" }, include: { event: { select: { organizationId: true } } } });
  if (!a) return;
  await db.abstract.update({ where: { id: a.id }, data: { status: "withdrawn" } });
  await audit(user.id, "abstract.withdraw", "Event", a.eventId, { abstractId: a.id });
  refresh(a.event.organizationId, a.eventId);
}

/** Avis d'un membre du comité (équipe de l'organisation) : note de 1 à 5 et commentaire. */
export async function reviewAbstract(_: ActionState, form: FormData): Promise<ActionState> {
  const { t } = await getT();
  const { orgId, user, event } = await managed(form, { organizer: true });
  if (!event) return { error: t("Événement introuvable.") };
  const a = await db.abstract.findFirst({ where: { id: str(form, "abstractId"), eventId: event.id, status: { not: "withdrawn" } } });
  if (!a) return { error: t("Communication introuvable.") };
  const score = Number(str(form, "score"));
  if (!Number.isInteger(score) || score < 1 || score > 5) return { error: t("Choisissez une note de 1 à 5.") };
  const comment = str(form, "comment", 1000) || null;
  await db.abstractReview.upsert({ where: { abstractId_reviewerId: { abstractId: a.id, reviewerId: user.id } }, create: { abstractId: a.id, reviewerId: user.id, score, comment }, update: { score, comment } });
  refresh(orgId, event.id);
  return { ok: t("Avis enregistré.") };
}

/** Décision sur une communication : retenue (orale ou poster) ou non retenue (motif facultatif) ; l'auteur est prévenu. */
export async function decideAbstract(_: ActionState, form: FormData): Promise<ActionState> {
  const { t } = await getT();
  const { orgId, user, event } = await managed(form, { organizer: true });
  if (!event) return { error: t("Événement introuvable.") };
  const a = await db.abstract.findFirst({ where: { id: str(form, "abstractId"), eventId: event.id, status: { in: ["submitted", "accepted", "rejected"] } } });
  if (!a) return { error: t("Communication introuvable.") };
  const decision = str(form, "decision");
  const note = str(form, "note", 1000) || null;
  if (decision === "accept") {
    const fmt = str(form, "acceptedFormat");
    if (fmt !== "oral" && fmt !== "poster") return { error: t("Choisissez : communication orale ou poster.") };
    await db.abstract.update({ where: { id: a.id }, data: { status: "accepted", acceptedFormat: fmt, decisionNote: note, decidedAt: new Date(), decidedById: user.id } });
  } else if (decision === "reject") {
    await db.abstract.update({ where: { id: a.id }, data: { status: "rejected", acceptedFormat: null, decisionNote: note, decidedAt: new Date(), decidedById: user.id } });
    await db.programItem.deleteMany({ where: { abstractId: a.id } });
  } else return { error: t("Décision invalide.") };
  await audit(user.id, `abstract.${decision}`, "Event", event.id, { abstractId: a.id });
  notifyAbstractDecision(a.id);
  refresh(orgId, event.id);
  return { ok: decision === "accept" ? t("Communication retenue : l'auteur est prévenu.") : t("Communication non retenue : l'auteur est prévenu.") };
}

/** Communication retenue placée au programme (jour, horaires, salle). */
export async function scheduleAbstract(_: ActionState, form: FormData): Promise<ActionState> {
  const { t } = await getT();
  const { orgId, user, event } = await managed(form);
  if (!event) return { error: t("Événement introuvable.") };
  const a = await db.abstract.findFirst({ where: { id: str(form, "abstractId"), eventId: event.id, status: "accepted" } });
  if (!a) return { error: t("Communication introuvable.") };
  const slot = programSlot(str(form, "day"), str(form, "start"), str(form, "end"));
  if (typeof slot === "string") return { error: t(slot) };
  const roomId = str(form, "roomId") || null;
  if (roomId && !(await db.eventRoom.count({ where: { id: roomId, eventId: event.id } }))) return { error: t("Salle introuvable.") };
  const data = { eventId: event.id, ...slot, roomId, kind: "communications", title: a.title, speakers: a.authors };
  await db.programItem.upsert({ where: { abstractId: a.id }, create: { ...data, abstractId: a.id }, update: data });
  await audit(user.id, "abstract.schedule", "Event", event.id, { abstractId: a.id });
  refresh(orgId, event.id);
  return { ok: t("Communication placée au programme.") };
}

// ─── Partenaires ──────────────────────────────────────────────────────────

/** Partenaire d'un événement : organisation présente sur KolBase (la convention lui est proposée) ou autre. */
export async function addPartner(_: ActionState, form: FormData): Promise<ActionState> {
  const { t } = await getT();
  const { orgId, user, event } = await managed(form, { organizer: true });
  if (!event) return { error: t("Événement introuvable.") };
  const partnerOrgId = str(form, "partnerOrgId") || null;
  const partnerOrg = partnerOrgId ? await db.organization.findFirst({ where: { id: partnerOrgId, verification: "VERIFIED", kind: { not: "PRESTATAIRE" } }, select: { id: true, name: true } }) : null;
  if (partnerOrgId && !partnerOrg) return { error: t("Organisation introuvable.") };
  if (partnerOrg?.id === orgId) return { error: t("L'organisation ne peut pas être son propre partenaire.") };
  const name = partnerOrg?.name ?? str(form, "name", 120);
  if (!name) return { error: t("Choisissez une organisation ou indiquez le nom du partenaire.") };
  const level = str(form, "level");
  if (!isPartnerLevel(level)) return { error: t("Niveau de partenariat invalide.") };
  const rawAmount = str(form, "amount");
  const amountCents = rawAmount ? eurToCents(rawAmount) : null;
  if (rawAmount && amountCents == null) return { error: t("Montant invalide.") };
  if ((await db.eventPartner.count({ where: { eventId: event.id } })) >= 100) return { error: t("Cent partenaires au plus.") };
  await db.eventPartner.create({ data: { eventId: event.id, organizationId: partnerOrg?.id ?? null, name, level, amountCents, counterparts: str(form, "counterparts", 1000) || null, showLogo: form.get("showLogo") === "on" } });
  await audit(user.id, "event.partner", "Event", event.id, { name, level, amountCents });
  refresh(orgId, event.id);
  return { ok: partnerOrg ? t("Partenaire ajouté : proposez-lui la convention quand elle est prête.") : t("Partenaire ajouté.") };
}

/**
 * Suivi d'un partenariat par l'organisateur : proposer la convention (organisation présente sur KolBase), noter la
 * signature (partenaire hors KolBase), noter le règlement, retirer (brouillon, décliné ou hors KolBase).
 */
export async function updatePartner(form: FormData) {
  const { orgId, user, event } = await managed(form, { organizer: true });
  if (!event) return;
  const p = await db.eventPartner.findFirst({ where: { id: str(form, "partnerId"), eventId: event.id } });
  if (!p) return;
  const action = str(form, "action");
  const now = new Date();
  if (action === "propose" && p.organizationId && (p.status === "draft" || p.status === "declined")) {
    await db.eventPartner.update({ where: { id: p.id }, data: { status: "proposed", proposedAt: now, declinedAt: null, declineNote: null } });
    notifyPartnershipProposed(p.id);
  } else if (action === "signed" && !p.organizationId && p.status === "draft") {
    await db.eventPartner.update({ where: { id: p.id }, data: { status: "signed", signedAt: now, signedById: user.id } });
  } else if (action === "paid" && p.status === "signed") {
    await db.eventPartner.update({ where: { id: p.id }, data: { status: "paid", paidAt: now } });
  } else if (action === "remove" && (p.status === "draft" || p.status === "declined" || !p.organizationId)) {
    await db.eventPartner.delete({ where: { id: p.id } });
  } else return;
  await audit(user.id, `event.partner_${action}`, "Event", event.id, { partnerId: p.id, name: p.name });
  refresh(orgId, event.id);
}

/** Réponse de l'organisation partenaire à la convention proposée : signée ou déclinée (motif). */
export async function answerPartnership(_: ActionState, form: FormData): Promise<ActionState> {
  const { t } = await getT();
  const orgId = str(form, "orgId");
  const { user } = await requireMembership(orgId, ["ADMIN", "CONFORMITE"]);
  const p = await db.eventPartner.findFirst({ where: { id: str(form, "partnerId"), organizationId: orgId, status: "proposed" }, include: { event: { select: { id: true, organizationId: true } } } });
  if (!p) return { error: t("Proposition introuvable ou déjà traitée.") };
  const answer = str(form, "answer");
  if (answer === "sign") {
    await db.eventPartner.update({ where: { id: p.id }, data: { status: "signed", signedAt: new Date(), signedById: user.id } });
  } else if (answer === "decline") {
    await db.eventPartner.update({ where: { id: p.id }, data: { status: "declined", declinedAt: new Date(), declineNote: str(form, "note", 500) || null } });
  } else return { error: t("Réponse invalide.") };
  await audit(user.id, `partnership.${answer}`, "Event", p.eventId, { partnerId: p.id });
  notifyPartnershipAnswered(p.id);
  revalidatePath(`/organisations/${orgId}/partenariats`);
  refresh(p.event.organizationId, p.eventId);
  return { ok: answer === "sign" ? t("Partenariat signé : l'organisateur est prévenu.") : t("Partenariat décliné : l'organisateur est prévenu.") };
}
