"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/auth";
import { str } from "@/lib/form";
import { sirenFields } from "@/lib/orgs";
import { requirePlatformAdmin } from "@/lib/platform";

const refresh = () => {
  revalidatePath("/admin");
  revalidatePath("/", "layout");
};

/** Valider, refuser ou suspendre une organisation. */
export async function reviewOrganization(form: FormData) {
  const admin = await requirePlatformAdmin();
  const orgId = str(form, "orgId");
  const decision = str(form, "decision");
  const note = str(form, "note") || null;
  const org = await db.organization.findUnique({ where: { id: orgId } });
  if (!org) return;
  if (decision === "verify") {
    await db.organization.update({ where: { id: orgId }, data: { verification: "VERIFIED", verifiedAt: new Date(), verifiedById: admin.id, verificationNote: note } });
  } else if (decision === "reject" || decision === "suspend") {
    if (decision === "reject" && !note) return; // un refus est toujours motivé
    await db.organization.update({
      where: { id: orgId },
      data: { verification: decision === "reject" ? "REJECTED" : "PENDING", verifiedAt: null, verifiedById: admin.id, verificationNote: note, listed: false },
    });
  } else return;
  await audit(admin.id, `platform.org_${decision}`, "Organization", orgId, { note: note ?? undefined });
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
  const rpps = str(form, "rpps");
  // Le RPPS contrôlé est celui affiché à l'administrateur : s'il a changé entre-temps, on ne valide rien.
  const { count } = await db.practitionerProfile.updateMany({
    where: { id: practitionerId, rpps },
    data: { rppsVerified: decision === "verify", rppsCheckedAt: new Date(), rppsCheckNote: decision === "reject" ? note : null },
  });
  if (count) await audit(admin.id, `platform.rpps_${decision}`, "PractitionerProfile", practitionerId, { rpps, note: note ?? undefined });
  refresh();
}
