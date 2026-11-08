"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { mailEnabled } from "@/lib/mail";
import { audit, requireUser } from "@/lib/auth";
import { isVerifiedOrg, notVerified, requireMembership } from "@/lib/orgs";
import { BENEFIT_CATALOG, COMPLIANCE_ROLES, EVENT_MANAGER_ROLES, EVENT_ORGANIZER_ROLES, eventChanges, eventEnded, eventScope, EVENT_TYPES, ONLINE_URL_INVALID, parseOnlineUrl, parseParisDateTime } from "@/lib/events";
import { EventFormat } from "@/generated/prisma/enums";
import { eurToCents, intOrNull, str } from "@/lib/form";
import { getT } from "@/lib/i18n/server";
import type { T } from "@/lib/i18n";
import { engagementGate } from "@/lib/billing";
import type { GateLink } from "@/lib/billing-plans";
import { notifyEventCancelled, notifyEventChanged, notifyEventConfided, notifyEventMessage, notifyEventReview, notifyEventWithdrawn, notifyMandateEnded, notifyRegistration, notifyRegistrationCancelled } from "@/lib/notifications";
import { activeMandate } from "@/lib/mandates";
import { hospitalityGate, normalizeVisa } from "@/lib/belgium";
import { readNeeds } from "@/lib/registration-needs";
import { offerFreedPlaces } from "@/lib/waitlist";
import { SOURCE_COOKIE } from "@/lib/services";
import { deletableDraft, DRAFT_COUNTS } from "@/lib/event-drafts";
import { EVENT_NOT_PUBLISHABLE, eventPublishable } from "@/lib/projects";
import { EVENT_NOT_APPROVED, needsReview, reviewAllowsPublish, REVIEWED_CHANGES } from "@/lib/event-review";
import { FOUR_EYES_BLOCKED, FOUR_EYES_JUSTIFY, fourEyes } from "@/lib/four-eyes";

export type ActionState = { error?: string; ok?: string; fix?: GateLink } | undefined;

/** Champs communs à la création et à la modification d'un événement (valeurs lues et contrôlées). */
function readEventFields(form: FormData, t: T) {
  const title = str(form, "title");
  const typeId = str(form, "typeId");
  const startsAt = parseParisDateTime(str(form, "startsAt"));
  const format = str(form, "format") as EventFormat;
  if (!title) return { error: t("Le titre est obligatoire.") } as const;
  if (!EVENT_TYPES.some((t) => t.id === typeId)) return { error: t("Type d'événement invalide.") } as const;
  if (!startsAt) return { error: t("Date et heure invalides.") } as const;
  if (!Object.values(EventFormat).includes(format)) return { error: t("Format invalide.") } as const;
  // Lien de connexion : pour un événement en ligne ou hybride seulement.
  const onlineUrl = format === "PRESENTIEL" ? null : parseOnlineUrl(str(form, "onlineUrl", 500));
  if (onlineUrl === undefined) return { error: t(ONLINE_URL_INVALID) } as const;
  const benefits: { catalogId: string; label: string; valueCents: number }[] = [];
  for (const b of BENEFIT_CATALOG) {
    if (!form.get(`benefit_${b.id}`)) continue;
    const cents = eurToCents(str(form, `value_${b.id}`) || String(b.typical));
    if (cents === null) return { error: t("Montant invalide pour « {label} ».", { label: t(b.label) }) } as const;
    benefits.push({ catalogId: b.id, label: b.label, valueCents: cents });
  }
  return {
    fields: {
      title, typeId, startsAt, format, onlineUrl,
      therapeuticArea: str(form, "therapeuticArea") || null,
      description: str(form, "description") || null,
      durationMinutes: intOrNull(str(form, "durationMinutes")),
      city: format === "DISTANCIEL" ? null : str(form, "city") || null,
      postalCode: format === "DISTANCIEL" ? null : str(form, "postalCode").replace(/\s/g, "").slice(0, 12) || null,
      venue: format === "DISTANCIEL" ? null : str(form, "venue") || null,
      address: format === "DISTANCIEL" ? null : str(form, "address", 200) || null,
      capacity: intOrNull(str(form, "capacity")),
    },
    benefits,
  } as const;
}

export async function createEvent(_: ActionState, form: FormData): Promise<ActionState> {
  const { t } = await getT();
  const orgId = str(form, "orgId");
  const { user, org } = await requireMembership(orgId, EVENT_ORGANIZER_ROLES);

  const read = readEventFields(form, t);
  if ("error" in read) return { error: read.error };
  const { fields, benefits } = read;
  if (fields.startsAt < new Date()) return { error: t("La date doit être dans le futur.") };

  // Rattachement à un dossier de l'organisation (événement créé depuis la fiche du dossier).
  const projectId = str(form, "projectId");
  const project = projectId ? await db.project.findFirst({ where: { id: projectId, organizationId: orgId }, select: { id: true, status: true } }) : null;

  // Réunion interne (board, comité) : jamais publiée, sans inscriptions en ligne.
  const internal = form.get("internal") === "1";
  const publish = !internal && form.get("publish") === "1";
  if (publish && !isVerifiedOrg(org)) return { error: t("Publication impossible pour l'instant : {v} Enregistrez l'événement en brouillon.", { v: t(notVerified(org)) }) };
  if (publish && !eventPublishable(project?.status)) return { error: t(EVENT_NOT_PUBLISHABLE) };
  // Validation par la conformité exigée : l'événement est d'abord enregistré, puis soumis depuis sa fiche.
  if (publish && needsReview(org, { internal })) return { error: t(EVENT_NOT_APPROVED) };
  // Soumis à la conformité dès sa création (hors événement d'un dossier pas encore validé : il l'est avec le dossier).
  const submitReview = form.get("submitReview") === "1" && needsReview(org, { internal }) && (!project || eventPublishable(project.status));
  const gate = publish ? await engagementGate(orgId, "evenement") : null;
  if (gate) return { ...gate, error: t("{error} Vous pouvez l'enregistrer en brouillon.", { error: gate.error }) };
  const event = await db.event.create({
    data: {
      organizationId: orgId,
      ...fields,
      projectId: project?.id ?? null,
      internal,
      registrationOpen: !internal,
      publishedAt: publish ? new Date() : null,
      ...(submitReview ? { reviewStatus: "submitted", reviewSubmittedAt: new Date(), reviewSubmittedById: user.id } : {}),
      benefits: { create: benefits },
    },
  });
  await audit(user.id, "event.create", "Event", event.id, { publish, benefits: benefits.length, ...(project ? { projectId: project.id } : {}), ...(submitReview ? { review: "submitted" } : {}) });
  if (submitReview) notifyEventReview(event.id, "submitted", user.id);
  // Publié d'emblée : la fiche propose aussitôt de faire connaître l'événement (services KolBase). Créé depuis un
  // dossier : retour à l'onglet « Événement » du dossier, où il se gère.
  if (project) redirect(`/organisations/${orgId}/dossiers/${project.id}?onglet=evenement${publish ? "&publie=1" : ""}`);
  redirect(`/organisations/${orgId}/evenements/${event.id}${publish ? "?publie=1" : ""}`);
}

/**
 * Modifier un événement : mêmes champs qu'à la création, plus le lien de connexion. Les inscrits sont prévenus
 * par e-mail d'un changement de date, d'heure, de lieu, de format ou de lien. Les hospitalités restent modifiables
 * tant qu'aucun inscrit n'en a accepté ; ensuite elles sont figées (valeurs déclarées).
 */
export async function updateEvent(_: ActionState, form: FormData): Promise<ActionState> {
  const { t } = await getT();
  const orgId = str(form, "orgId");
  const eventId = str(form, "eventId");
  const { user, roles, org } = await requireMembership(orgId, EVENT_MANAGER_ROLES);
  const event = await db.event.findFirst({
    where: { id: eventId, organizationId: orgId, ...eventScope(user, roles) },
    include: { benefits: { include: { _count: { select: { accepted: true } } } }, _count: { select: { registrations: true } } },
  });
  if (!event) return { error: t("Événement introuvable.") };
  if (event.cancelledAt) return { error: t("Cet événement est annulé : il ne se modifie plus.") };
  const read = readEventFields(form, t);
  if ("error" in read) return { error: read.error };
  const { fields, benefits } = read;
  // Un événement passé peut être corrigé (lieu, description…) ; une nouvelle date doit être à venir.
  if (fields.startsAt.getTime() !== event.startsAt.getTime() && fields.startsAt < new Date()) return { error: t("La nouvelle date doit être dans le futur.") };
  if (fields.capacity && fields.capacity < event._count.registrations)
    return { error: t("Capacité trop faible : {registrations} personnes sont déjà inscrites.", { registrations: event._count.registrations }) };

  const frozen = event.benefits.some((b) => b._count.accepted > 0);
  const changes = eventChanges(event, fields);
  // Hospitalités modifiées (ajout, retrait, montant) : comptent pour la validation par la conformité.
  const benefitsChanged = !frozen && (benefits.length !== event.benefits.length || benefits.some((b) => event.benefits.find((x) => x.catalogId === b.catalogId)?.valueCents !== b.valueCents));
  const reviewChanges = [...changes, ...(benefitsChanged ? ["hospitalités"] : [])].filter((c) => (REVIEWED_CHANGES as readonly string[]).includes(c));
  const backToReview = event.reviewStatus === "approved" && reviewChanges.length > 0 && needsReview(org, event);
  await db.$transaction(async (tx) => {
    await tx.event.update({
      where: { id: event.id },
      // Validé puis modifié (date, lieu, format, hospitalités) : de nouveau soumis à la conformité ; un événement déjà en
      // ligne y reste, la conformité réexamine les changements.
      data: { ...fields, ...(backToReview ? { reviewStatus: "submitted", reviewSubmittedAt: new Date(), reviewSubmittedById: user.id, reviewNote: null, reviewChanges } : {}) },
    });
    // Nouvelle date : le rappel de la veille repartira à la bonne date.
    if (changes.includes("date")) await tx.registration.updateMany({ where: { eventId: event.id }, data: { reminderSentAt: null } });
    if (!frozen) {
      const keep = new Set(benefits.map((b) => b.catalogId));
      await tx.eventBenefit.deleteMany({ where: { eventId: event.id, catalogId: { notIn: [...keep] } } });
      for (const b of benefits) {
        const existing = event.benefits.find((x) => x.catalogId === b.catalogId);
        if (existing) await tx.eventBenefit.update({ where: { id: existing.id }, data: { valueCents: b.valueCents } });
        else await tx.eventBenefit.create({ data: { eventId: event.id, ...b } });
      }
    }
  });
  await audit(user.id, "event.update", "Event", event.id, { changes, ...(frozen ? {} : { benefits: benefits.length }), ...(backToReview ? { review: "submitted" } : {}) });
  if (changes.length > 0 && event._count.registrations > 0) notifyEventChanged(event.id, changes);
  if (backToReview) notifyEventReview(event.id, "submitted", user.id);
  // Capacité augmentée : les places nouvelles sont proposées à la liste d'attente.
  if ((fields.capacity ?? Infinity) > (event.capacity ?? Infinity) || (event.capacity && !fields.capacity)) await offerFreedPlaces(event.id);
  revalidatePath(`/organisations/${orgId}/evenements/${eventId}`);
  // Événement rattaché à un dossier : il se gère aussi dans l'onglet « Événement » du dossier.
  revalidatePath(`/organisations/${orgId}/dossiers`, "layout");
  revalidatePath(`/evenements/${eventId}`);
  revalidatePath("/evenements");
  const n = event._count.registrations;
  const told = changes.length > 0 && n > 0 ? (n > 1 ? ` Les ${n} inscrits sont prévenus par e-mail.` : " L'inscrit est prévenu par e-mail.") : "";
  return { ok: t("Événement mis à jour.{told}", { told }) };
}

/** Supprimer un brouillon jamais publié, sans inscrit ni demande rattachée (devis, appel, service). */
export async function deleteEventDraft(form: FormData) {
  const orgId = str(form, "orgId");
  const eventId = str(form, "eventId");
  const { user } = await requireMembership(orgId, EVENT_ORGANIZER_ROLES);
  const event = await db.event.findFirst({
    where: { id: eventId, organizationId: orgId, publishedAt: null },
    include: DRAFT_COUNTS,
  });
  if (!event || !(await deletableDraft(event))) return;
  await db.event.delete({ where: { id: event.id } });
  await audit(user.id, "event.delete", "Event", event.id, { title: event.title });
  redirect(`/organisations/${orgId}/evenements`);
}

/** Publier / dépublier, ouvrir / fermer les inscriptions. */
export async function setEventFlag(form: FormData) {
  const orgId = str(form, "orgId");
  const eventId = str(form, "eventId");
  const { user, roles, org } = await requireMembership(orgId, EVENT_MANAGER_ROLES);
  const flag = str(form, "flag");
  if (flag === "publish" && !isVerifiedOrg(org)) return;
  if (flag === "publish" || flag === "open") {
    const ev = await db.event.findFirst({ where: { id: eventId, organizationId: orgId }, select: { internal: true, reviewStatus: true, project: { select: { status: true } } } });
    if (!eventPublishable(ev?.project?.status)) return;
    if (flag === "publish" && (!ev || !reviewAllowsPublish(org, ev))) return;
  }
  // Contrat de sous-traitance puis abonnement : la page qui lève le blocage ramène ensuite à la publication.
  const gate = flag === "publish" ? await engagementGate(orgId, "evenement", eventId) : null;
  if (gate) redirect(gate.fix.href);
  // Passer en réunion interne (ou l'ouvrir au public) relève de l'équipe organisatrice, pas d'une agence.
  if ((flag === "internal" || flag === "public") && !roles.some((r) => EVENT_ORGANIZER_ROLES.includes(r))) return;
  const data =
    flag === "publish" ? { publishedAt: new Date() } :
    flag === "unpublish" ? { publishedAt: null } :
    flag === "open" ? { registrationOpen: true } :
    flag === "close" ? { registrationOpen: false } :
    // Réunion interne : retirée de l'agenda, inscriptions fermées ; « ouvrir au public » la rend publiable.
    flag === "internal" ? { internal: true, publishedAt: null, registrationOpen: false } :
    flag === "public" ? { internal: false, registrationOpen: true } : null;
  if (!data) return;
  // Une réunion interne n'est ni publiée ni ouverte aux inscriptions.
  const onlyPublic = flag === "publish" || flag === "open" ? { internal: false } : {};
  // Avec des inscrits, on ne retire pas l'événement de l'agenda en silence : on l'annule (motif, e-mail aux inscrits).
  const noRegistrant = flag === "unpublish" ? { registrations: { none: {} } } : {};
  const { count } = await db.event.updateMany({ where: { id: eventId, organizationId: orgId, cancelledAt: null, ...eventScope(user, roles), ...onlyPublic, ...noRegistrant }, data });
  if (!count) return;
  await audit(user.id, `event.${flag}`, "Event", eventId);
  revalidatePath(`/organisations/${orgId}/evenements/${eventId}`);
  // Événement rattaché à un dossier : il se gère aussi dans l'onglet « Événement » du dossier.
  revalidatePath(`/organisations/${orgId}/dossiers`, "layout");
  revalidatePath("/evenements");
  // Depuis l'onglet « Événement » d'un dossier, on y reste.
  const back = str(form, "retour");
  const fromDossier = back.startsWith(`/organisations/${orgId}/dossiers/`) && !back.includes("//") ? back : null;
  if (flag === "publish" && roles.some((r) => EVENT_ORGANIZER_ROLES.includes(r))) redirect(fromDossier ? `${fromDossier}${fromDossier.includes("?") ? "&" : "?"}publie=1` : `/organisations/${orgId}/evenements/${eventId}?publie=1`);
}

/**
 * Annuler un événement publié qui a des inscrits (organisateurs, motif obligatoire) : il quitte l'agenda mais reste
 * lisible à son adresse avec la mention « Événement annulé », sans inscription possible. Les inscriptions sont
 * marquées annulées et chaque inscrit est prévenu ; les hospitalités prévues, non fournies, n'ont plus à être déclarées.
 */
export async function cancelEvent(form: FormData) {
  const orgId = str(form, "orgId");
  const eventId = str(form, "eventId");
  const { user } = await requireMembership(orgId, EVENT_ORGANIZER_ROLES);
  const reason = str(form, "reason", 500);
  if (!reason) return;
  const event = await db.event.findFirst({ where: { id: eventId, organizationId: orgId, cancelledAt: null, internal: false, publishedAt: { not: null } }, include: { _count: { select: { registrations: true } } } });
  if (!event || event._count.registrations === 0 || eventEnded(event)) return;
  const now = new Date();
  const removed = await db.$transaction(async (tx) => {
    const { count } = await tx.event.updateMany({ where: { id: eventId, cancelledAt: null }, data: { cancelledAt: now, cancelReason: reason, publishedAt: null, registrationOpen: false } });
    if (!count) return null;
    await tx.registration.updateMany({ where: { eventId, cancelledAt: null }, data: { cancelledAt: now } });
    // Hospitalités non fournies : retirées des inscriptions non déclarées (rien à déclarer à Transparence Santé).
    return (await tx.registrationBenefit.deleteMany({ where: { registration: { eventId, declared: false } } })).count;
  });
  if (removed === null) return;
  await audit(user.id, "event.cancel", "Event", eventId, { note: reason, registrations: event._count.registrations, benefitsRemoved: removed });
  notifyEventCancelled(eventId);
  revalidatePath(`/organisations/${orgId}/evenements/${eventId}`);
  // Événement rattaché à un dossier : il se gère aussi dans l'onglet « Événement » du dossier.
  revalidatePath(`/organisations/${orgId}/dossiers`, "layout");
  revalidatePath(`/evenements/${eventId}`);
  revalidatePath("/evenements");
}

/** Confier l'événement à une agence mandatée (ses membres « Prestataire » n'accèdent qu'aux événements confiés). */
/**
 * Confier l'événement à une agence, en une seule action : si l'agence n'est pas encore mandatée, le mandat est créé
 * au passage (son équipe accède alors aux seuls événements confiés). L'agence est prévenue par e-mail.
 */
export async function setEventAgency(form: FormData) {
  const orgId = str(form, "orgId");
  const eventId = str(form, "eventId");
  const { user } = await requireMembership(orgId, EVENT_ORGANIZER_ROLES);
  const agencyId = str(form, "agencyId") || null;
  const event = await db.event.findFirst({ where: { id: eventId, organizationId: orgId } });
  if (!event) return;
  if (agencyId) {
    const agency = await db.organization.findFirst({ where: { id: agencyId, kind: "PRESTATAIRE" } });
    if (!agency) return;
    const mandate = await db.mandate.findFirst({ where: { mandatorId: orgId, agencyId, ...activeMandate() } });
    if (!mandate) {
      if (!agency.listed || agency.verification !== "VERIFIED") return;
      const m = await db.mandate.create({ data: { mandatorId: orgId, agencyId, scope: "Événements confiés" } });
      await audit(user.id, "mandate.create", "Mandate", m.id, { agencyId, eventId });
    }
  }
  await db.event.update({ where: { id: eventId }, data: { agencyId } });
  await audit(user.id, "event.agency", "Event", eventId, { agencyId });
  if (agencyId && agencyId !== event.agencyId) notifyEventConfided(eventId);
  // L'agence précédente perd l'accès à l'événement : elle en est prévenue.
  if (event.agencyId && agencyId !== event.agencyId) notifyEventWithdrawn(eventId, event.agencyId);
  revalidatePath(`/organisations/${orgId}/evenements/${eventId}`);
  // Événement rattaché à un dossier : il se gère aussi dans l'onglet « Événement » du dossier.
  revalidatePath(`/organisations/${orgId}/dossiers`, "layout");
  revalidatePath(`/organisations/${orgId}/prestataires`);
}

/** Inscription nominative d'un utilisateur connecté, avec les avantages qu'il accepte. */
export async function registerToEvent(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const { t } = await getT();
  const eventId = str(form, "eventId");
  const event = await db.event.findFirst({
    where: { id: eventId, publishedAt: { not: null }, organization: { verification: "VERIFIED" } },
    include: { benefits: true, organization: { select: { kind: true } }, _count: { select: { registrations: true } } },
  });
  if (!event) return { error: t("Événement introuvable.") };
  if (!event.registrationOpen) return { error: t("Les inscriptions sont closes.") };
  if (event.startsAt < new Date()) return { error: t("Cet événement a déjà eu lieu.") };
  if (event.capacity && event._count.registrations >= event.capacity) return { error: t("L'événement est complet.") };
  if (await db.registration.findUnique({ where: { eventId_userId: { eventId, userId: user.id } } }))
    return { error: t("Vous êtes déjà inscrit.") };

  // Arrivé par le lien suivi d'un service KolBase pour cet événement : inscription attribuée (bilan de l'organisateur).
  const sourceId = (await cookies()).get(SOURCE_COOKIE)?.value;
  const source = sourceId ? await db.serviceOrder.findFirst({ where: { id: sourceId, eventId, status: { in: ["planifiee", "realisee"] } }, select: { id: true } }) : null;

  const accepted = event.benefits.filter((b) => form.get(`accept_${b.id}`));
  // Étudiant (hospitalité interdite) ; praticien exerçant en Belgique sans visa Mdeon communiqué : inscription seule.
  const gate = hospitalityGate(user.practitioner, event);
  if (accepted.length > 0 && gate === "student")
    return { error: t("En tant qu'étudiant, vous ne pouvez accepter aucune prestation (l'hospitalité offerte aux étudiants est interdite) : inscrivez-vous sans les cocher.") };
  if (accepted.length > 0 && gate === "be_no_visa")
    return { error: t("Vous exercez en Belgique : l'organisateur n'a pas encore communiqué le visa Mdeon de cet événement, préalable à toute prise en charge. Inscrivez-vous sans les prestations.") };
  if (accepted.length > 0 && user.practitioner && !form.get("ackHcp"))
    return { error: t("Merci de confirmer avoir pris connaissance de l'information sur les avantages.") };
  // Besoins (régime, allergies, accessibilité) : facultatifs, enregistrés avec l'accord explicite de la personne.
  const needs = readNeeds(form);
  if (needs.error) return { error: t(needs.error) };
  const consented = !!(needs.diet || needs.allergies || needs.needs);

  // L'événement est verrouillé le temps de compter les places et d'inscrire : deux inscriptions
  // simultanées ne peuvent pas dépasser la capacité.
  const reg = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "Event" WHERE id = ${eventId} FOR UPDATE`;
    if (event.capacity && (await tx.registration.count({ where: { eventId } })) >= event.capacity) return null;
    return tx.registration.create({
      data: {
        eventId,
        userId: user.id,
        profession: user.practitioner?.profession ?? null,
        structure: str(form, "structure") || user.practitioner?.hospital || null,
        sourceOrderId: source?.id ?? null,
        diet: needs.diet, allergies: needs.allergies, needs: needs.needs, needsConsentAt: consented ? new Date() : null,
        benefits: { create: accepted.map((b) => ({ benefitId: b.id, valueCents: b.valueCents })) },
      },
    });
  });
  if (!reg) return { error: t("L'événement est complet.") };
  // Inscrit : il quitte la liste d'attente s'il y était.
  await db.waitlistEntry.deleteMany({ where: { eventId, userId: user.id } });
  await audit(user.id, "registration.create", "Registration", reg.id, {
    eventId,
    benefits: accepted.map((b) => b.catalogId),
    totalCents: accepted.reduce((s, b) => s + b.valueCents, 0),
    sourceOrderId: source?.id,
  });
  // Confirmation par e-mail : date, lieu ou lien de connexion, badge, invitation d'agenda.
  notifyRegistration(reg.id);
  revalidatePath(`/evenements/${eventId}`);
  return { ok: mailEnabled() ? t("Inscription confirmée. Un e-mail de confirmation vous est envoyé, avec l'événement pour votre agenda.") : t("Inscription confirmée. Votre badge et l'événement pour votre agenda sont dans « Mes inscriptions ».") };
}

/** Annulation par la personne inscrite (confirmée en deux temps), depuis l'événement ou « Mes inscriptions ». */
export async function cancelRegistration(form: FormData) {
  const user = await requireUser();
  const eventId = str(form, "eventId");
  const reg = await db.registration.findUnique({ where: { eventId_userId: { eventId, userId: user.id } }, include: { event: { select: { startsAt: true } }, _count: { select: { benefits: true } } } });
  // Une inscription déjà déclarée, ou dont l'événement a commencé, ne peut plus être annulée en ligne :
  // les avantages éventuellement reçus doivent rester traçables (correction par l'organisateur).
  let cancelled = false;
  if (reg && !reg.declared && !reg.cancelledAt && reg.event.startsAt > new Date()) {
    await db.registration.delete({ where: { id: reg.id } });
    await audit(user.id, "registration.cancel", "Registration", reg.id, { eventId });
    notifyRegistrationCancelled(user.id, eventId, reg._count.benefits);
    cancelled = true;
    // Place libérée : la liste d'attente est prévenue dans l'ordre.
    await offerFreedPlaces(eventId);
  }
  revalidatePath(`/evenements/${eventId}`);
  revalidatePath("/inscriptions");
  if (cancelled) redirect(str(form, "from") === "inscriptions" ? "/inscriptions?annulee=1" : `/evenements/${eventId}?annulee=1`);
}

/** La conformité marque une inscription comme déclarée (avec la référence de déclaration). */
export async function markDeclared(form: FormData) {
  const orgId = str(form, "orgId");
  const { user } = await requireMembership(orgId, COMPLIANCE_ROLES);
  const registrationId = str(form, "registrationId");
  const ref = str(form, "declarationRef");
  const reg = await db.registration.findFirst({ where: { id: registrationId, event: { organizationId: orgId } } });
  if (!reg) return;
  const declared = form.get("undo") !== "1";
  await db.registration.update({
    where: { id: reg.id },
    data: { declared, declarationRef: declared ? ref || reg.declarationRef : null },
  });
  await audit(user.id, declared ? "registration.declare" : "registration.undeclare", "Registration", reg.id, { ref });
  revalidatePath(`/organisations/${orgId}/hospitalites`);
}

// ─── Mandats d'agence ──────────────────────────────────────────────────────


/** Fin de mandat : l'agence perd l'accès aux événements qui lui étaient confiés. */
export async function endMandate(form: FormData) {
  const orgId = str(form, "orgId");
  const { user } = await requireMembership(orgId, EVENT_ORGANIZER_ROLES);
  const m = await db.mandate.findFirst({ where: { id: str(form, "mandateId"), mandatorId: orgId, ...activeMandate() } });
  if (!m) return;
  const events = await db.event.findMany({ where: { organizationId: orgId, agencyId: m.agencyId }, select: { title: true }, orderBy: { startsAt: "asc" } });
  await db.$transaction([
    db.mandate.update({ where: { id: m.id }, data: { endsAt: new Date() } }),
    db.event.updateMany({ where: { organizationId: orgId, agencyId: m.agencyId }, data: { agencyId: null } }),
  ]);
  await audit(user.id, "mandate.end", "Mandate", m.id, { agencyId: m.agencyId });
  notifyMandateEnded(m.id, events.map((e) => e.title));
  revalidatePath(`/organisations/${orgId}/prestataires`);
}

/** Droit de l'agence de retenir un devis au nom de l'organisation (sinon elle propose, l'organisateur retient). */
export async function setMandateAward(form: FormData) {
  const orgId = str(form, "orgId");
  const { user } = await requireMembership(orgId, EVENT_ORGANIZER_ROLES);
  const m = await db.mandate.findFirst({ where: { id: str(form, "mandateId"), mandatorId: orgId, ...activeMandate() } });
  if (!m) return;
  const canAward = form.get("canAward") === "1";
  await db.mandate.update({ where: { id: m.id }, data: { canAward } });
  await audit(user.id, "mandate.award_right", "Mandate", m.id, { agencyId: m.agencyId, canAward });
  revalidatePath(`/organisations/${orgId}/prestataires`);
}

/** Programme scientifique (déroulé horaire) : rédigé par l'organisateur ou son agence, affiché sur la page publique. */
export async function saveEventProgram(_: ActionState, form: FormData): Promise<ActionState> {
  const { t } = await getT();
  const orgId = str(form, "orgId");
  const eventId = str(form, "eventId");
  const { user, roles } = await requireMembership(orgId, EVENT_MANAGER_ROLES);
  const program = str(form, "program");
  if (program.length > 8000) return { error: t("Programme trop long (8 000 caractères au maximum).") };
  const { count } = await db.event.updateMany({ where: { id: eventId, organizationId: orgId, ...eventScope(user, roles) }, data: { program: program || null } });
  if (!count) return { error: t("Événement introuvable.") };
  await audit(user.id, "event.program", "Event", eventId);
  revalidatePath(`/organisations/${orgId}/evenements/${eventId}`);
  // Événement rattaché à un dossier : il se gère aussi dans l'onglet « Événement » du dossier.
  revalidatePath(`/organisations/${orgId}/dossiers`, "layout");
  revalidatePath(`/evenements/${eventId}`);
  return { ok: program ? t("Programme enregistré.") : t("Programme retiré.") };
}

/**
 * Visa Mdeon de l'événement (praticiens exerçant en Belgique) : saisi par l'organisateur, son agence ou la conformité.
 * Sans numéro, ces praticiens s'inscrivent sans hospitalité ; le numéro leur est communiqué à l'inscription.
 */
export async function setEventMdeonVisa(_: ActionState, form: FormData): Promise<ActionState> {
  const { t } = await getT();
  const orgId = str(form, "orgId");
  const eventId = str(form, "eventId");
  const { user, roles } = await requireMembership(orgId, [...EVENT_MANAGER_ROLES, ...COMPLIANCE_ROLES]);
  const visa = normalizeVisa(str(form, "mdeonVisa"));
  if (visa && !/^[\p{L}\p{N}][\p{L}\p{N} ./_-]{2,}$/u.test(visa)) return { error: t("Numéro de visa invalide : lettres, chiffres, tirets ou barres.") };
  const scope = roles.some((r) => COMPLIANCE_ROLES.includes(r)) ? {} : eventScope(user, roles);
  const { count } = await db.event.updateMany({ where: { id: eventId, organizationId: orgId, ...scope }, data: { mdeonVisa: visa || null, mdeonVisaAt: visa ? new Date() : null } });
  if (!count) return { error: t("Événement introuvable.") };
  await audit(user.id, visa ? "event.mdeon_visa" : "event.mdeon_visa_remove", "Event", eventId, visa ? { visa } : undefined);
  revalidatePath(`/organisations/${orgId}/evenements/${eventId}`);
  revalidatePath(`/organisations/${orgId}/dossiers`, "layout");
  revalidatePath(`/evenements/${eventId}`);
  return { ok: visa ? t("Visa Mdeon enregistré : les praticiens exerçant en Belgique peuvent accepter les prestations.") : t("Visa Mdeon retiré.") };
}

/** Liste d'attente d'un événement complet : inscription de la personne connectée (prévenue quand une place se libère). */
export async function joinWaitlist(form: FormData) {
  const user = await requireUser();
  const eventId = str(form, "eventId");
  const event = await db.event.findFirst({
    where: { id: eventId, publishedAt: { not: null }, cancelledAt: null, registrationOpen: true, startsAt: { gt: new Date() }, organization: { verification: "VERIFIED" } },
    select: { id: true, capacity: true, _count: { select: { registrations: true } } },
  });
  if (!event?.capacity || event._count.registrations < event.capacity) return;
  if (await db.registration.findUnique({ where: { eventId_userId: { eventId, userId: user.id } } })) return;
  const created = await db.waitlistEntry.create({ data: { eventId, userId: user.id } }).then((w) => w, () => null);
  if (created) await audit(user.id, "waitlist.join", "Event", eventId);
  revalidatePath(`/evenements/${eventId}`);
}

/** Quitter la liste d'attente. */
export async function leaveWaitlist(form: FormData) {
  const user = await requireUser();
  const eventId = str(form, "eventId");
  const { count } = await db.waitlistEntry.deleteMany({ where: { eventId, userId: user.id } });
  if (count) {
    await audit(user.id, "waitlist.leave", "Event", eventId);
    await offerFreedPlaces(eventId);
  }
  revalidatePath(`/evenements/${eventId}`);
}

/** Messages aux inscrits : trois au plus par événement sur 24 heures. */
const EVENT_MESSAGES_PER_DAY = 3;

/** Message de l'organisateur (ou de son agence) à tous les inscrits, par e-mail ; gardé dans l'historique de l'événement. */
export async function sendEventMessage(_: ActionState, form: FormData): Promise<ActionState> {
  const { t } = await getT();
  const orgId = str(form, "orgId");
  const eventId = str(form, "eventId");
  const { user, roles } = await requireMembership(orgId, EVENT_MANAGER_ROLES);
  const subject = str(form, "subject", 120);
  const body = str(form, "body");
  if (!subject) return { error: t("Donnez un objet au message.") };
  if (body.length < 10) return { error: t("Écrivez le message (10 caractères au moins).") };
  if (body.length > 4000) return { error: t("Message trop long (4 000 caractères au maximum).") };
  const event = await db.event.findFirst({
    where: { id: eventId, organizationId: orgId, internal: false, cancelledAt: null, ...eventScope(user, roles) },
    select: { id: true, _count: { select: { registrations: { where: { cancelledAt: null } } } } },
  });
  if (!event) return { error: t("Événement introuvable.") };
  if (event._count.registrations === 0) return { error: t("Aucun inscrit à prévenir.") };
  const recent = await db.eventMessage.count({ where: { eventId, createdAt: { gt: new Date(Date.now() - 86400e3) } } });
  if (recent >= EVENT_MESSAGES_PER_DAY) return { error: t("Trois messages au plus par 24 heures : regroupez les informations dans un prochain message.") };
  const m = await db.eventMessage.create({ data: { eventId, authorId: user.id, subject, body, recipients: event._count.registrations } });
  await audit(user.id, "event.message", "Event", eventId, { messageId: m.id, recipients: m.recipients });
  notifyEventMessage(m.id);
  revalidatePath(`/organisations/${orgId}/evenements/${eventId}`);
  revalidatePath(`/organisations/${orgId}/dossiers`, "layout");
  return { ok: t(m.recipients > 1 ? "Message envoyé aux {n} inscrits." : "Message envoyé à l'inscrit.", { n: m.recipients }) };
}

// ─── Validation par la conformité ──────────────────────────────────────────

/** Soumettre un événement à la conformité (organisateurs, agence mandatée) : lieu, date, programme et hospitalités. */
export async function submitEventReview(form: FormData) {
  const orgId = str(form, "orgId");
  const eventId = str(form, "eventId");
  const { user, roles, org } = await requireMembership(orgId, EVENT_MANAGER_ROLES);
  const ev = await db.event.findFirst({ where: { id: eventId, organizationId: orgId, cancelledAt: null, ...eventScope(user, roles) }, select: { internal: true, reviewStatus: true } });
  if (!ev || !needsReview(org, ev) || ev.reviewStatus === "submitted" || ev.reviewStatus === "approved") return;
  await db.event.update({ where: { id: eventId }, data: { reviewStatus: "submitted", reviewSubmittedAt: new Date(), reviewSubmittedById: user.id, reviewNote: null, reviewChanges: [] } });
  await audit(user.id, "event.review_submit", "Event", eventId);
  notifyEventReview(eventId, "submitted", user.id);
  revalidatePath(`/organisations/${orgId}`, "layout");
}

/**
 * Décision de la conformité : valider, ou demander des modifications (motif obligatoire, transmis aux organisateurs).
 * Contrôle à quatre yeux : qui a soumis l'événement ne le valide pas seul (justification s'il est seul habilité).
 */
export async function reviewEvent(_: ActionState, form: FormData): Promise<ActionState> {
  const { t } = await getT();
  const orgId = str(form, "orgId");
  const eventId = str(form, "eventId");
  const decision = str(form, "decision");
  const note = str(form, "note").slice(0, 1000);
  const { user } = await requireMembership(orgId, COMPLIANCE_ROLES);
  const ev = await db.event.findFirst({ where: { id: eventId, organizationId: orgId, reviewStatus: "submitted" }, select: { reviewSubmittedById: true } });
  if (!ev || (decision !== "approve" && decision !== "changes")) return { error: t("Cet événement n'est plus en attente de validation.") };
  if (decision === "changes" && !note) return { error: t("Indiquez les modifications attendues : elles sont transmises à l'équipe qui organise l'événement.") };
  let selfValidated = false;
  if (decision === "approve" && ev.reviewSubmittedById) {
    const rule = await fourEyes(new Set([ev.reviewSubmittedById]), orgId, user.id, COMPLIANCE_ROLES);
    if (rule === "blocked") return { error: t(FOUR_EYES_BLOCKED) };
    if (rule === "justify" && !note) return { error: t(FOUR_EYES_JUSTIFY) };
    selfValidated = rule === "justify";
  }
  const status = decision === "approve" ? "approved" : "changes";
  await db.event.update({ where: { id: eventId }, data: { reviewStatus: status, reviewedAt: new Date(), reviewedById: user.id, reviewNote: note || null, reviewChanges: [] } });
  await audit(user.id, decision === "approve" ? "event.review_approve" : "event.review_changes", "Event", eventId, { note: note || undefined, ...(selfValidated ? { selfValidated: true } : {}) });
  notifyEventReview(eventId, status, user.id);
  revalidatePath(`/organisations/${orgId}`, "layout");
  return { ok: decision === "approve" ? t("Événement validé : il peut être publié.") : t("Demande de modifications envoyée.") };
}

/** Réglage de la conformité : exiger, ou non, la validation des événements avant leur publication. */
export async function setEventReviewRequired(form: FormData) {
  const orgId = str(form, "orgId");
  const { user } = await requireMembership(orgId, COMPLIANCE_ROLES);
  const required = form.get("eventReview") === "1";
  await db.organization.update({ where: { id: orgId }, data: { eventReview: required } });
  await audit(user.id, "compliance.event_review", "Organization", orgId, { required });
  revalidatePath(`/organisations/${orgId}`, "layout");
}
