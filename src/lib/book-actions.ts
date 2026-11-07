"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/auth";
import { requireMembership } from "@/lib/orgs";
import { EVENT_ORGANIZER_ROLES } from "@/lib/events";
import { eurToCents, str } from "@/lib/form";
import { sniffLogo } from "@/lib/logos";
import { EQUIPMENT, OFFER_UNITS, PHOTO_MAX, PHOTO_MAX_BYTES, readCapacities } from "@/lib/supplier-book";
import { notifySupplierReview } from "@/lib/notifications";
import { getT } from "@/lib/i18n/server";

export type FormState = { error?: string; ok?: string } | undefined;

/** Administrateur d'une organisation prestataire. */
async function requireSupplierAdmin(orgId: string) {
  const ctx = await requireMembership(orgId, ["ADMIN"], { allowSupplier: true });
  if (ctx.org.kind !== "PRESTATAIRE") throw new Error("Réservé aux prestataires.");
  return ctx;
}
const refresh = (orgId: string) => {
  revalidatePath(`/organisations/${orgId}/book`);
  revalidatePath(`/structures/${orgId}`);
};

export async function updateSupplierBook(_: FormState, form: FormData): Promise<FormState> {
  const { t } = await getT();
  const orgId = str(form, "orgId");
  const { user } = await requireSupplierAdmin(orgId);
  const capacities = readCapacities({ seats: str(form, "seats"), cocktail: str(form, "cocktail"), banquet: str(form, "banquet"), rooms: str(form, "rooms") });
  const equipment = form.getAll("equipment").map(String).filter((e) => (EQUIPMENT as readonly string[]).includes(e));
  await db.organization.update({
    where: { id: orgId },
    data: { capacities, equipment, accessible: form.get("accessible") === "on", priceHint: str(form, "priceHint").slice(0, 120) || null },
  });
  await audit(user.id, "supplier.book", "Organization", orgId);
  refresh(orgId);
  return { ok: t("Book enregistré.") };
}

export async function addSupplierPhoto(_: FormState, form: FormData): Promise<FormState> {
  const { t } = await getT();
  const orgId = str(form, "orgId");
  const { user } = await requireSupplierAdmin(orgId);
  const file = form.get("photo");
  if (!(file instanceof File) || file.size === 0) return { error: t("Choisissez une photo.") };
  if (file.size > PHOTO_MAX_BYTES) return { error: t("Photo trop lourde : 800 Ko au maximum.") };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffLogo(bytes);
  if (!type) return { error: t("Format non reconnu : PNG, JPEG ou WebP uniquement.") };
  const count = await db.organizationPhoto.count({ where: { organizationId: orgId } });
  if (count >= PHOTO_MAX) return { error: t("{PHOTO_MAX} photos au maximum : retirez-en une d'abord.", { PHOTO_MAX }) };
  const photo = await db.organizationPhoto.create({ data: { organizationId: orgId, data: bytes, contentType: type, caption: str(form, "caption").slice(0, 120) || null, position: count } });
  await audit(user.id, "supplier.photo", "OrganizationPhoto", photo.id, { size: bytes.byteLength });
  refresh(orgId);
  return { ok: t("Photo ajoutée.") };
}

export async function removeSupplierPhoto(form: FormData) {
  const orgId = str(form, "orgId");
  const { user } = await requireSupplierAdmin(orgId);
  const { count } = await db.organizationPhoto.deleteMany({ where: { id: str(form, "photoId"), organizationId: orgId } });
  if (count) await audit(user.id, "supplier.photo_remove", "OrganizationPhoto", str(form, "photoId"));
  refresh(orgId);
}

export async function addSupplierOffer(_: FormState, form: FormData): Promise<FormState> {
  const { t } = await getT();
  const orgId = str(form, "orgId");
  const { user } = await requireSupplierAdmin(orgId);
  const label = str(form, "label").slice(0, 120);
  const unit = str(form, "unit");
  const cents = eurToCents(str(form, "price"), { allowZero: false });
  if (!label) return { error: t("Indiquez la prestation.") };
  if (!cents) return { error: t("Prix invalide.") };
  if (!(unit in OFFER_UNITS)) return { error: t("Unité invalide.") };
  if ((await db.supplierOffer.count({ where: { organizationId: orgId } })) >= 40) return { error: t("40 forfaits au maximum.") };
  const offer = await db.supplierOffer.create({ data: { organizationId: orgId, label, unit, unitCents: cents } });
  await audit(user.id, "supplier.offer", "SupplierOffer", offer.id);
  refresh(orgId);
  return { ok: t("Forfait ajouté au catalogue.") };
}

export async function removeSupplierOffer(form: FormData) {
  const orgId = str(form, "orgId");
  const { user } = await requireSupplierAdmin(orgId);
  const { count } = await db.supplierOffer.deleteMany({ where: { id: str(form, "offerId"), organizationId: orgId } });
  if (count) await audit(user.id, "supplier.offer_remove", "SupplierOffer", str(form, "offerId"));
  refresh(orgId);
}

/**
 * Avis vérifié : seule l'organisation qui a retenu le prestataire le dépose, une fois la prestation passée,
 * une fois par demande. Il est publié avec le nom de l'organisation.
 */
export async function reviewSupplier(_: FormState, form: FormData): Promise<FormState> {
  const { t } = await getT();
  const orgId = str(form, "orgId");
  const { user } = await requireMembership(orgId, EVENT_ORGANIZER_ROLES);
  const rfq = await db.rfq.findFirst({
    where: { id: str(form, "rfqId"), organizationId: orgId, status: "awarded", review: null },
    include: { event: true, quotes: { where: { status: "retained" } } },
  });
  const kept = rfq?.quotes[0];
  if (!rfq || !kept) return { error: t("Demande introuvable ou déjà évaluée.") };
  if (rfq.event && rfq.event.startsAt > new Date()) return { error: t("L'avis se dépose après la prestation.") };
  const rating = Number(str(form, "rating"));
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return { error: t("Choisissez une note de 1 à 5.") };
  const review = await db.supplierReview.create({ data: { supplierId: kept.supplierId, clientId: orgId, rfqId: rfq.id, authorId: user.id, rating, comment: str(form, "comment").slice(0, 1000) || null } });
  await audit(user.id, "supplier.review", "SupplierReview", review.id, { rating });
  notifySupplierReview(review.id);
  revalidatePath(`/organisations/${orgId}/prestataires`, "layout");
  revalidatePath(`/structures/${kept.supplierId}`);
  return { ok: t("Merci : votre avis est publié sur la page du prestataire.") };
}
