"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit, requireUser } from "@/lib/auth";
import { requireMembership } from "@/lib/orgs";
import { BENEFIT_CATALOG, COMPLIANCE_ROLES, EVENT_MANAGER_ROLES, EVENT_ORGANIZER_ROLES, eventScope, EVENT_TYPES, parseParisDateTime } from "@/lib/events";
import { EventFormat } from "@/generated/prisma/enums";

export type ActionState = { error?: string; ok?: string } | undefined;

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const intOrNull = (v: string) => (v && Number.isFinite(Number(v)) ? Math.max(0, Math.round(Number(v))) : null);
const eurToCents = (v: string) => {
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
};

export async function createEvent(_: ActionState, form: FormData): Promise<ActionState> {
  const orgId = str(form, "orgId");
  const { user } = await requireMembership(orgId, EVENT_ORGANIZER_ROLES);

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

  const publish = form.get("publish") === "1";
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
      publishedAt: publish ? new Date() : null,
      benefits: { create: benefits },
    },
  });
  await audit(user.id, "event.create", "Event", event.id, { publish, benefits: benefits.length });
  redirect(`/organisations/${orgId}/evenements/${event.id}`);
}

/** Publier / dépublier, ouvrir / fermer les inscriptions. */
export async function setEventFlag(form: FormData) {
  const orgId = str(form, "orgId");
  const eventId = str(form, "eventId");
  const { user, roles } = await requireMembership(orgId, EVENT_MANAGER_ROLES);
  const flag = str(form, "flag");
  const data =
    flag === "publish" ? { publishedAt: new Date() } :
    flag === "unpublish" ? { publishedAt: null } :
    flag === "open" ? { registrationOpen: true } :
    flag === "close" ? { registrationOpen: false } : null;
  if (!data) return;
  await db.event.updateMany({ where: { id: eventId, organizationId: orgId, ...eventScope(user, roles) }, data });
  await audit(user.id, `event.${flag}`, "Event", eventId);
  revalidatePath(`/organisations/${orgId}/evenements/${eventId}`);
  revalidatePath("/evenements");
}

/** Confier l'événement à une agence mandatée (ses membres « Prestataire » n'accèdent qu'aux événements confiés). */
export async function setEventAgency(form: FormData) {
  const orgId = str(form, "orgId");
  const eventId = str(form, "eventId");
  const { user } = await requireMembership(orgId, EVENT_ORGANIZER_ROLES);
  const agencyId = str(form, "agencyId") || null;
  if (agencyId && !(await db.mandate.findFirst({ where: { mandatorId: orgId, agencyId } }))) return;
  await db.event.updateMany({ where: { id: eventId, organizationId: orgId }, data: { agencyId } });
  await audit(user.id, "event.agency", "Event", eventId, { agencyId });
  revalidatePath(`/organisations/${orgId}/evenements/${eventId}`);
}

/** Inscription nominative d'un utilisateur connecté, avec les avantages qu'il accepte. */
export async function registerToEvent(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const eventId = str(form, "eventId");
  const event = await db.event.findFirst({
    where: { id: eventId, publishedAt: { not: null } },
    include: { benefits: true, _count: { select: { registrations: true } } },
  });
  if (!event) return { error: "Événement introuvable." };
  if (!event.registrationOpen) return { error: "Les inscriptions sont closes." };
  if (event.startsAt < new Date()) return { error: "Cet événement a déjà eu lieu." };
  if (event.capacity && event._count.registrations >= event.capacity) return { error: "L'événement est complet." };
  if (await db.registration.findUnique({ where: { eventId_userId: { eventId, userId: user.id } } }))
    return { error: "Vous êtes déjà inscrit." };

  const accepted = event.benefits.filter((b) => form.get(`accept_${b.id}`));
  if (accepted.length > 0 && user.practitioner && !form.get("ackHcp"))
    return { error: "Merci de confirmer avoir pris connaissance de l'information sur les avantages." };

  const reg = await db.registration.create({
    data: {
      eventId,
      userId: user.id,
      profession: user.practitioner?.profession ?? null,
      structure: str(form, "structure") || user.practitioner?.hospital || null,
      benefits: { create: accepted.map((b) => ({ benefitId: b.id, valueCents: b.valueCents })) },
    },
  });
  await audit(user.id, "registration.create", "Registration", reg.id, {
    eventId,
    benefits: accepted.map((b) => b.catalogId),
    totalCents: accepted.reduce((s, b) => s + b.valueCents, 0),
  });
  revalidatePath(`/evenements/${eventId}`);
  return { ok: "Inscription confirmée." };
}

export async function cancelRegistration(form: FormData) {
  const user = await requireUser();
  const eventId = str(form, "eventId");
  const reg = await db.registration.findUnique({ where: { eventId_userId: { eventId, userId: user.id } } });
  // Une inscription déjà déclarée ne peut plus être annulée en ligne.
  if (reg && !reg.declared) {
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
