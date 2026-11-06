"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit, requireUser } from "@/lib/auth";
import { str } from "@/lib/form";
import { canCheckIn, checkinOpen } from "@/lib/checkin";
import { getT } from "@/lib/i18n/server";

export type FormState = { error?: string; ok?: string } | undefined;

/** Pointe (ou dé-pointe) un participant : organisateur ou agence mandatée, à partir de la veille de l'événement. */
export async function setPresence(_: FormState, form: FormData): Promise<FormState> {
  const { t } = await getT();
  const user = await requireUser();
  const reg = await db.registration.findUnique({
    where: { id: str(form, "registrationId") },
    include: { event: { select: { id: true, organizationId: true, agencyId: true, startsAt: true, internal: true } }, user: { select: { firstName: true, lastName: true } } },
  });
  if (!reg || !canCheckIn(user, reg.event)) return { error: t("Inscription introuvable.") };
  if (reg.cancelledAt) return { error: t("Inscription annulée avec l'événement.") };
  const undo = form.get("undo") === "1";
  if (!undo && !checkinOpen(reg.event.startsAt)) return { error: t("Le pointage ouvre la veille de l'événement.") };
  if (!undo && reg.checkedInAt) return { ok: t("{firstName} {lastName} est déjà pointé(e).", { firstName: reg.user.firstName, lastName: reg.user.lastName }) };
  await db.registration.update({ where: { id: reg.id }, data: undo ? { checkedInAt: null, checkedInById: null } : { checkedInAt: new Date(), checkedInById: user.id } });
  await audit(user.id, undo ? "registration.checkin_undo" : "registration.checkin", "Registration", reg.id, { eventId: reg.event.id });
  revalidatePath(`/organisations/${reg.event.organizationId}/evenements/${reg.event.id}`);
  // Événement rattaché à un dossier : il se gère aussi dans l'onglet « Événement » du dossier.
  revalidatePath(`/organisations/${reg.event.organizationId}/dossiers`, "layout");
  revalidatePath(`/organisations/${reg.event.organizationId}/evenements/${reg.event.id}/pointage`);
  if (reg.checkinCode) revalidatePath(`/pointage/${reg.checkinCode}`);
  return { ok: undo ? `Pointage annulé pour ${reg.user.firstName} ${reg.user.lastName}.` : `${reg.user.firstName} ${reg.user.lastName} : présence enregistrée.` };
}
