"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit, requireUser } from "@/lib/auth";
import { ORG_NOT_VERIFIED, isVerifiedOrg, requireMembership } from "@/lib/orgs";
import { BENEFIT_CATALOG, COMPLIANCE_ROLES, EVENT_MANAGER_ROLES, EVENT_ORGANIZER_ROLES, eventScope, EVENT_TYPES, parseParisDateTime } from "@/lib/events";
import { EventFormat } from "@/generated/prisma/enums";
import { eurToCents, intOrNull, str } from "@/lib/form";
import { getT } from "@/lib/i18n/server";
import { engagementAllowed, gateMessage } from "@/lib/billing";
import { notifyEventConfided } from "@/lib/notifications";
import { SOURCE_COOKIE } from "@/lib/services";

export type ActionState = { error?: string; ok?: string } | undefined;

export async function createEvent(_: ActionState, form: FormData): Promise<ActionState> {
  const orgId = str(form, "orgId");
  const { user, org } = await requireMembership(orgId, EVENT_ORGANIZER_ROLES);

  const title = str(form, "title");
  const typeId = str(form, "typeId");
  const startsAt = parseParisDateTime(str(form, "startsAt"));
  const format = str(form, "format") as EventFormat;
  if (!title) return { error: "Le titre est obligatoire." };
  if (!EVENT_TYPES.some((t) => t.id === typeId)) return { error: "Type d'événement invalide." };
  if (!startsAt) return { error: "Date et heure invalides." };
  if (startsAt < new Date()) return { error: "La date doit être dans le futur." };
  if (!Object.values(EventFormat).includes(format)) return { error: "Format invalide." };

  const benefits: { catalogId: string; label: string; valueCents: number }[] = [];
  for (const b of BENEFIT_CATALOG) {
    if (!form.get(`benefit_${b.id}`)) continue;
    const cents = eurToCents(str(form, `value_${b.id}`) || String(b.typical));
    if (cents === null) return { error: `Montant invalide pour « ${b.label} ».` };
    benefits.push({ catalogId: b.id, label: b.label, valueCents: cents });
  }

  // Rattachement à un dossier de l'organisation (événement créé depuis la fiche du dossier).
  const projectId = str(form, "projectId");
  const project = projectId ? await db.project.findFirst({ where: { id: projectId, organizationId: orgId }, select: { id: true } }) : null;

  // Réunion interne (board, comité) : jamais publiée, sans inscriptions en ligne.
  const internal = form.get("internal") === "1";
  const publish = !internal && form.get("publish") === "1";
  if (publish && !isVerifiedOrg(org)) return { error: `Publication impossible pour l'instant : ${ORG_NOT_VERIFIED} Enregistrez l'événement en brouillon.` };
  if (publish && !(await engagementAllowed(orgId))) return { error: `${gateMessage("evenement")} Vous pouvez l'enregistrer en brouillon.` };
  const event = await db.event.create({
    data: {
      organizationId: orgId,
      title,
      typeId,
      startsAt,
      format,
      therapeuticArea: str(form, "therapeuticArea") || null,
      description: str(form, "description") || null,
      durationMinutes: intOrNull(str(form, "durationMinutes")),
      city: format === "DISTANCIEL" ? null : str(form, "city") || null,
      venue: format === "DISTANCIEL" ? null : str(form, "venue") || null,
      capacity: intOrNull(str(form, "capacity")),
      projectId: project?.id ?? null,
      internal,
      registrationOpen: !internal,
      publishedAt: publish ? new Date() : null,
      benefits: { create: benefits },
    },
  });
  await audit(user.id, "event.create", "Event", event.id, { publish, benefits: benefits.length, ...(project ? { projectId: project.id } : {}) });
  // Publié d'emblée : la fiche propose aussitôt de faire connaître l'événement (services KolBase).
  redirect(`/organisations/${orgId}/evenements/${event.id}${publish ? "?publie=1" : ""}`);
}

/** Publier / dépublier, ouvrir / fermer les inscriptions. */
export async function setEventFlag(form: FormData) {
  const orgId = str(form, "orgId");
  const eventId = str(form, "eventId");
  const { user, roles, org } = await requireMembership(orgId, EVENT_MANAGER_ROLES);
  const flag = str(form, "flag");
  if (flag === "publish" && !isVerifiedOrg(org)) return;
  if (flag === "publish" && !(await engagementAllowed(orgId))) redirect(`/organisations/${orgId}/abonnement?motif=evenement`);
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
  const { count } = await db.event.updateMany({ where: { id: eventId, organizationId: orgId, ...eventScope(user, roles), ...onlyPublic }, data });
  if (!count) return;
  await audit(user.id, `event.${flag}`, "Event", eventId);
  revalidatePath(`/organisations/${orgId}/evenements/${eventId}`);
  revalidatePath("/evenements");
  if (flag === "publish" && roles.some((r) => EVENT_ORGANIZER_ROLES.includes(r))) redirect(`/organisations/${orgId}/evenements/${eventId}?publie=1`);
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
      if (!agency.listed) return;
      const m = await db.mandate.create({ data: { mandatorId: orgId, agencyId, scope: "Événements confiés" } });
      await audit(user.id, "mandate.create", "Mandate", m.id, { agencyId, eventId });
    }
  }
  await db.event.update({ where: { id: eventId }, data: { agencyId } });
  await audit(user.id, "event.agency", "Event", eventId, { agencyId });
  if (agencyId && agencyId !== event.agencyId) notifyEventConfided(eventId);
  revalidatePath(`/organisations/${orgId}/evenements/${eventId}`);
  revalidatePath(`/organisations/${orgId}/prestataires`);
}

/** Inscription nominative d'un utilisateur connecté, avec les avantages qu'il accepte. */
export async function registerToEvent(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const { t } = await getT();
  const eventId = str(form, "eventId");
  const event = await db.event.findFirst({
    where: { id: eventId, publishedAt: { not: null }, organization: { verification: "VERIFIED" } },
    include: { benefits: true, _count: { select: { registrations: true } } },
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
  if (accepted.length > 0 && user.practitioner && !form.get("ackHcp"))
    return { error: t("Merci de confirmer avoir pris connaissance de l'information sur les avantages.") };

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
        benefits: { create: accepted.map((b) => ({ benefitId: b.id, valueCents: b.valueCents })) },
      },
    });
  });
  if (!reg) return { error: t("L'événement est complet.") };
  await audit(user.id, "registration.create", "Registration", reg.id, {
    eventId,
    benefits: accepted.map((b) => b.catalogId),
    totalCents: accepted.reduce((s, b) => s + b.valueCents, 0),
    sourceOrderId: source?.id,
  });
  revalidatePath(`/evenements/${eventId}`);
  return { ok: t("Inscription confirmée.") };
}

export async function cancelRegistration(form: FormData) {
  const user = await requireUser();
  const eventId = str(form, "eventId");
  const reg = await db.registration.findUnique({ where: { eventId_userId: { eventId, userId: user.id } }, include: { event: { select: { startsAt: true } } } });
  // Une inscription déjà déclarée, ou dont l'événement a commencé, ne peut plus être annulée en ligne :
  // les avantages éventuellement reçus doivent rester traçables (correction par l'organisateur).
  if (reg && !reg.declared && reg.event.startsAt > new Date()) {
    await db.registration.delete({ where: { id: reg.id } });
    await audit(user.id, "registration.cancel", "Registration", reg.id, { eventId });
  }
  revalidatePath(`/evenements/${eventId}`);
  revalidatePath("/inscriptions");
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

/** Mandats en cours (non terminés) d'une organisation. */
const activeMandate = (now = new Date()) => ({ OR: [{ endsAt: null }, { endsAt: { gt: now } }] });


/** Fin de mandat : l'agence perd l'accès aux événements qui lui étaient confiés. */
export async function endMandate(form: FormData) {
  const orgId = str(form, "orgId");
  const { user } = await requireMembership(orgId, EVENT_ORGANIZER_ROLES);
  const m = await db.mandate.findFirst({ where: { id: str(form, "mandateId"), mandatorId: orgId, ...activeMandate() } });
  if (!m) return;
  await db.$transaction([
    db.mandate.update({ where: { id: m.id }, data: { endsAt: new Date() } }),
    db.event.updateMany({ where: { organizationId: orgId, agencyId: m.agencyId }, data: { agencyId: null } }),
  ]);
  await audit(user.id, "mandate.end", "Mandate", m.id, { agencyId: m.agencyId });
  revalidatePath(`/organisations/${orgId}/prestataires`);
}

/** Programme scientifique (déroulé horaire) : rédigé par l'organisateur ou son agence, affiché sur la page publique. */
export async function saveEventProgram(_: ActionState, form: FormData): Promise<ActionState> {
  const orgId = str(form, "orgId");
  const eventId = str(form, "eventId");
  const { user, roles } = await requireMembership(orgId, EVENT_MANAGER_ROLES);
  const program = str(form, "program");
  if (program.length > 8000) return { error: "Programme trop long (8 000 caractères au maximum)." };
  const { count } = await db.event.updateMany({ where: { id: eventId, organizationId: orgId, ...eventScope(user, roles) }, data: { program: program || null } });
  if (!count) return { error: "Événement introuvable." };
  await audit(user.id, "event.program", "Event", eventId);
  revalidatePath(`/organisations/${orgId}/evenements/${eventId}`);
  revalidatePath(`/evenements/${eventId}`);
  return { ok: program ? "Programme enregistré." : "Programme retiré." };
}
