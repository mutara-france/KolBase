"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/auth";
import { ORG_NOT_VERIFIED, isVerifiedOrg, requireMembership } from "@/lib/orgs";
import { EVENT_MANAGER_ROLES, eventScope, parseParisDateTime } from "@/lib/events";
import { SUPPLIER_CATEGORIES } from "@/lib/suppliers";
import { eurToCents, intOrNull, str } from "@/lib/form";
import { notifyQuote, notifyRfqSent } from "@/lib/notifications";

export type ActionState = { error?: string; ok?: string } | undefined;

// ─── Côté organisation ──────────────────────────────────────────────────────

/** Un prestataire mandaté n'agit que sur les demandes liées aux événements qui lui sont confiés. */
function rfqScope(user: Parameters<typeof eventScope>[0], roles: Parameters<typeof eventScope>[1]) {
  const scope = eventScope(user, roles);
  return Object.keys(scope).length ? { event: scope } : {};
}

export async function createRfq(_: ActionState, form: FormData): Promise<ActionState> {
  const orgId = str(form, "orgId");
  const { user, roles, org } = await requireMembership(orgId, EVENT_MANAGER_ROLES);
  const scope = eventScope(user, roles);
  const category = str(form, "category");
  if (!SUPPLIER_CATEGORIES.some((c) => c.id === category)) return { error: "Type de prestation invalide." };
  const eventId = str(form, "eventId") || null;
  if (!eventId && Object.keys(scope).length) return { error: "Choisissez l'événement qui vous est confié." };
  const event = eventId ? await db.event.findFirst({ where: { id: eventId, organizationId: orgId, ...scope } }) : null;
  if (eventId && !event) return { error: "Événement introuvable." };
  const supplierIds = [...new Set(form.getAll("supplierIds").map(String))];
  if (supplierIds.length === 0) return { error: "Sélectionnez au moins un prestataire." };
  const suppliers = await db.organization.findMany({ where: { id: { in: supplierIds }, kind: "PRESTATAIRE", listed: true, supplierCategories: { has: category } } });
  if (suppliers.length !== supplierIds.length) return { error: "Un des prestataires sélectionnés n'est pas référencé dans cette catégorie." };
  const needs = str(form, "needs");
  if (needs.length < 10) return { error: "Décrivez votre besoin." };
  const deadlineRaw = str(form, "deadline");
  const deadline = deadlineRaw ? parseParisDateTime(`${deadlineRaw}T23:59`) : null;
  if (deadlineRaw && (!deadline || deadline < new Date())) return { error: "Date de réponse invalide ou passée." };
  const headcount = intOrNull(str(form, "headcount")) || event?.capacity || null;
  const send = str(form, "intent") === "send";
  if (send && !isVerifiedOrg(org)) return { error: `Envoi impossible pour l'instant : ${ORG_NOT_VERIFIED} Enregistrez la demande en brouillon.` };

  const rfq = await db.rfq.create({
    data: {
      organizationId: orgId, eventId, category, needs, deadline, headcount, city: str(form, "city") || event?.city || null,
      status: send ? "sent" : "draft", sentAt: send ? new Date() : null, createdById: user.id,
      suppliers: { create: supplierIds.map((supplierId) => ({ supplierId })) },
    },
  });
  await audit(user.id, send ? "rfq.send" : "rfq.create", "Rfq", rfq.id, { suppliers: supplierIds.length });
  if (send) notifyRfqSent(rfq.id);
  redirect(`/organisations/${orgId}/prestataires`);
}

export async function sendRfq(form: FormData) {
  const orgId = str(form, "orgId");
  const { user, roles, org } = await requireMembership(orgId, EVENT_MANAGER_ROLES);
  if (!isVerifiedOrg(org)) return;
  const rfqId = str(form, "rfqId");
  const { count } = await db.rfq.updateMany({ where: { id: rfqId, organizationId: orgId, ...rfqScope(user, roles), status: "draft" }, data: { status: "sent", sentAt: new Date() } });
  if (!count) return;
  await audit(user.id, "rfq.send", "Rfq", rfqId);
  notifyRfqSent(rfqId);
  revalidatePath(`/organisations/${orgId}/prestataires`);
}

export async function cancelRfq(form: FormData) {
  const orgId = str(form, "orgId");
  const { user, roles } = await requireMembership(orgId, EVENT_MANAGER_ROLES);
  const rfqId = str(form, "rfqId");
  const { count } = await db.rfq.updateMany({ where: { id: rfqId, organizationId: orgId, ...rfqScope(user, roles), status: { in: ["draft", "sent"] } }, data: { status: "cancelled" } });
  if (!count) return;
  await audit(user.id, "rfq.cancel", "Rfq", rfqId);
  revalidatePath(`/organisations/${orgId}/prestataires`);
}

/** Retenir un devis : les autres propositions passent en « non retenu ». */
export async function awardQuote(form: FormData) {
  const orgId = str(form, "orgId");
  const { user, roles } = await requireMembership(orgId, EVENT_MANAGER_ROLES);
  const quote = await db.quote.findFirst({ where: { id: str(form, "quoteId"), rfq: { organizationId: orgId, ...rfqScope(user, roles), status: "sent" } } });
  if (!quote) return;
  // Conflit d'intérêts : un membre du prestataire (agence mandatée, par exemple) ne retient pas son propre devis.
  if (user.memberships.some((m) => m.organizationId === quote.supplierId)) return;
  // La demande n'est attribuée qu'une fois : deux décisions simultanées ne retiennent pas deux devis.
  const awarded = await db.$transaction(async (tx) => {
    const { count } = await tx.rfq.updateMany({ where: { id: quote.rfqId, status: "sent" }, data: { status: "awarded" } });
    if (count === 0) return false;
    await tx.quote.update({ where: { id: quote.id }, data: { status: "retained" } });
    await tx.quote.updateMany({ where: { rfqId: quote.rfqId, id: { not: quote.id } }, data: { status: "rejected" } });
    return true;
  });
  if (!awarded) return;
  await audit(user.id, "rfq.award", "Rfq", quote.rfqId, { quoteId: quote.id, supplierId: quote.supplierId, amountCents: quote.amountCents });
  revalidatePath(`/organisations/${orgId}/prestataires`);
}

// ─── Côté prestataire ───────────────────────────────────────────────────────

async function requireSupplier(orgId: string) {
  const ctx = await requireMembership(orgId);
  if (ctx.org.kind !== "PRESTATAIRE") redirect(`/organisations/${orgId}`);
  return ctx;
}

export async function submitQuote(_: ActionState, form: FormData): Promise<ActionState> {
  const orgId = str(form, "orgId");
  const { user } = await requireSupplier(orgId);
  const rfqId = str(form, "rfqId");
  const invite = await db.rfqSupplier.findUnique({ where: { rfqId_supplierId: { rfqId, supplierId: orgId } }, include: { rfq: true } });
  if (!invite || invite.rfq.status !== "sent") return { error: "Cette demande n'accepte plus de devis." };
  const amountCents = eurToCents(str(form, "amount"), { allowZero: false });
  if (amountCents === null) return { error: "Indiquez le montant du devis." };
  const data = { amountCents, delay: str(form, "delay") || null, note: str(form, "note") || null, authorId: user.id, status: "submitted" as const };
  const q = await db.quote.upsert({ where: { rfqId_supplierId: { rfqId, supplierId: orgId } }, update: data, create: { rfqId, supplierId: orgId, ...data } });
  if (invite.declined) await db.rfqSupplier.update({ where: { rfqId_supplierId: { rfqId, supplierId: orgId } }, data: { declined: false } });
  await audit(user.id, "quote.submit", "Quote", q.id, { rfqId, amountCents });
  notifyQuote(rfqId, orgId);
  revalidatePath(`/organisations/${orgId}/devis`);
  return { ok: "Devis transmis." };
}

export async function declineRfq(form: FormData) {
  const orgId = str(form, "orgId");
  const { user } = await requireSupplier(orgId);
  const rfqId = str(form, "rfqId");
  const { count } = await db.rfqSupplier.updateMany({ where: { rfqId, supplierId: orgId }, data: { declined: true } });
  if (!count) return;
  await audit(user.id, "rfq.decline", "Rfq", rfqId, { supplierId: orgId });
  revalidatePath(`/organisations/${orgId}/devis`);
}

export async function updateSupplierProfile(_: ActionState, form: FormData): Promise<ActionState> {
  const orgId = str(form, "orgId");
  const { user, isAdmin, org: ctxOrg } = await requireSupplier(orgId);
  if (!isAdmin) return { error: "Réservé aux administrateurs." };
  const categories = form.getAll("categories").map(String).filter((c) => SUPPLIER_CATEGORIES.some((x) => x.id === c));
  const listed = form.get("listed") === "on";
  if (listed && categories.length === 0) return { error: "Choisissez au moins une catégorie pour être référencé." };
  if (listed && !isVerifiedOrg(ctxOrg)) return { error: `Référencement impossible pour l'instant : ${ORG_NOT_VERIFIED}` };
  await db.organization.update({ where: { id: orgId }, data: { supplierCategories: categories, coverage: str(form, "coverage") || null, listed } });
  await audit(user.id, "supplier.profile", "Organization", orgId, { categories, listed });
  revalidatePath(`/organisations/${orgId}/devis`);
  return { ok: "Fiche prestataire enregistrée." };
}

