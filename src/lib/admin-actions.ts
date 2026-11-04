"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/auth";
import { str } from "@/lib/form";
import { sirenFields } from "@/lib/orgs";
import { requirePlatformAdmin } from "@/lib/platform";
import { notifyIdentityDecision, notifyOrgDecision, notifyPhotoRemoved } from "@/lib/notifications";
import { syncStripePause } from "@/lib/billing";

const refresh = () => {
  revalidatePath("/admin");
  revalidatePath("/", "layout");
};

/**
 * Valider, refuser, suspendre ou réactiver une organisation. La suspension est réversible : statut à part
 * (SUSPENDED), motif obligatoire ; la page publique, les événements et les appels sont masqués (requêtes publiques
 * limitées aux organisations validées) sans rien modifier, et « Réactiver » rend tout tel quel. La facturation Stripe
 * est en pause pendant la suspension et reprend à la réactivation (sauf gratuité en cours). Une organisation
 * suspendue ne peut pas être refusée (le refus ferme ses appels) : la réactiver ou la laisser suspendue.
 */
export async function reviewOrganization(form: FormData) {
  const admin = await requirePlatformAdmin();
  const orgId = str(form, "orgId");
  const decision = str(form, "decision");
  const note = str(form, "note") || null;
  const org = await db.organization.findUnique({ where: { id: orgId } });
  if (!org) return;
  if (decision === "suspend") {
    if (!note || org.verification !== "VERIFIED") return; // une suspension est toujours motivée
    await db.organization.update({ where: { id: orgId }, data: { verification: "SUSPENDED", verifiedById: admin.id, verificationNote: note } });
  } else if (decision === "reactivate") {
    if (org.verification !== "SUSPENDED") return;
    await db.organization.update({ where: { id: orgId }, data: { verification: "VERIFIED", verifiedAt: org.verifiedAt ?? new Date(), verifiedById: admin.id, verificationNote: null } });
  } else if (decision === "verify") {
    // Validée : la page publique est activée (l'organisation peut se retirer de l'annuaire dans Membres et réglages).
    // Un prestataire n'est référencé que s'il a choisi ses catégories de prestation.
    const listed = org.kind !== "PRESTATAIRE" || org.supplierCategories.length > 0;
    await db.organization.update({ where: { id: orgId }, data: { verification: "VERIFIED", verifiedAt: new Date(), verifiedById: admin.id, verificationNote: note, listed } });
  } else if (decision === "reject") {
    if (!note || org.verification === "SUSPENDED") return; // un refus est toujours motivé
    // Une organisation refusée cesse aussi de recevoir des candidatures.
    await db.$transaction([
      db.organization.update({ where: { id: orgId }, data: { verification: "REJECTED", verifiedAt: null, verifiedById: admin.id, verificationNote: note, listed: false } }),
      db.openCall.updateMany({ where: { organizationId: orgId, status: "open" }, data: { status: "closed" } }),
    ]);
  } else return;
  // Suspension, réactivation : facturation Stripe en pause, puis reprise (ou pause jusqu'à la fin d'une gratuité).
  let billing: Awaited<ReturnType<typeof syncStripePause>> = null;
  if (decision === "suspend" || decision === "reactivate") {
    try {
      billing = await syncStripePause(orgId);
    } catch (e) {
      console.error("[suspension : pause Stripe]", e);
      await audit(admin.id, "billing.stripe_pause_failed", "Organization", orgId, { decision });
    }
  }
  await audit(admin.id, `platform.org_${decision}`, "Organization", orgId, { note: note ?? undefined, stripe: billing ?? undefined });
  notifyOrgDecision(orgId, decision, note, billing);
  refresh();
}

/** Relancer le contrôle du SIREN (répertoire indisponible lors de la saisie, par exemple). */
export async function recheckSiren(form: FormData) {
  const admin = await requirePlatformAdmin();
  const org = await db.organization.findUnique({ where: { id: str(form, "orgId") } });
  if (!org?.siren) return;
  const { lookup: _lookup, ...data } = await sirenFields(org.siren);
  await db.organization.update({ where: { id: org.id }, data });
  await audit(admin.id, "platform.siren_check", "Organization", org.id, { found: data.legalName != null });
  refresh();
}

/** Valider ou refuser le RPPS d'un praticien (contrôle sur l'Annuaire Santé). */
export async function reviewRpps(form: FormData) {
  const admin = await requirePlatformAdmin();
  const practitionerId = str(form, "practitionerId");
  const decision = str(form, "decision");
  const note = str(form, "note") || null;
  if (decision !== "verify" && decision !== "reject") return;
  if (decision === "reject" && !note) return;
  const identifier = str(form, "identifier");
  if (!identifier) return;
  // L'identifiant contrôlé est celui affiché à l'administrateur : s'il a changé entre-temps, on ne valide rien.
  const { count } = await db.practitionerProfile.updateMany({
    where: { id: practitionerId, OR: [{ country: "FR", rpps: identifier }, { country: { not: "FR" }, licenseNumber: identifier }] },
    // Un identifiant refusé retire aussi le praticien de l'annuaire public (il pourra se référencer à nouveau avec un numéro corrigé).
    data: { rppsVerified: decision === "verify", rppsCheckedAt: new Date(), rppsCheckNote: decision === "reject" ? note : null, ...(decision === "reject" ? { listed: false, listedAt: null } : {}) },
  });
  if (count) {
    await audit(admin.id, `platform.rpps_${decision}`, "PractitionerProfile", practitionerId, { identifier, note: note ?? undefined });
    notifyIdentityDecision(practitionerId, decision === "verify", note);
  }
  refresh();
}

/** Photo inadaptée (pas un portrait, image d'un tiers, contenu choquant) : retirée par KolBase, le praticien est prévenu. */
export async function removePractitionerPhoto(form: FormData) {
  const admin = await requirePlatformAdmin();
  const practitionerId = str(form, "practitionerId");
  const note = str(form, "note", 300) || null;
  const p = await db.practitionerProfile.findUnique({ where: { id: practitionerId }, select: { id: true, photoUpdatedAt: true } });
  if (!p?.photoUpdatedAt) return;
  await db.$transaction([
    db.practitionerPhoto.deleteMany({ where: { practitionerId } }),
    db.practitionerProfile.update({ where: { id: practitionerId }, data: { photoUpdatedAt: null, photoConsentAt: null } }),
  ]);
  await audit(admin.id, "admin.photo_remove", "PractitionerProfile", practitionerId, { note });
  notifyPhotoRemoved(practitionerId, note);
  revalidatePath("/admin");
  revalidatePath(`/experts/${practitionerId}`);
}
