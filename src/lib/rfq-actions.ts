"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/auth";
import { requireMembership } from "@/lib/orgs";
import { EVENT_MANAGER_ROLES, parseParisDateTime } from "@/lib/events";
import { SUPPLIER_CATEGORIES } from "@/lib/suppliers";

export type ActionState = { error?: string; ok?: string } | undefined;

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const eurToCents = (v: string) => {
  const n = Number(v.replace(/\s/g, "").replace(",", "."));
  return v && Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
};

// ─── Côté organisation ──────────────────────────────────────────────────────

export async function createRfq(_: ActionState, form: FormData): Promise<ActionState> {
  const orgId = str(form, "orgId");
  const { user } = await requireMembership(orgId, EVENT_MANAGER_ROLES);
  const category = str(form, "category");
  if (!SUPPLIER_CATEGORIES.some((c) => c.id === category)) return { error: "Type de prestation invalide." };
  const eventId = str(form, "eventId") || null;
  const event = eventId ? await db.event.findFirst({ where: { id: eventId, organizationId: orgId } }) : null;
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
  const headcount = Number(str(form, "headcount")) || event?.capacity || null;
  const send = str(form, "intent") === "send";

  const rfq = await db.rfq.create({
    data: {
      organizationId: orgId, eventId, category, needs, deadline, headcount, city: str(form, "city") || event?.city || null,
      status: send ? "sent" : "draft", sentAt: send ? new Date() : null, createdById: user.id,
      suppliers: { create: supplierIds.map((supplierId) => ({ supplierId })) },
    },
  });
  await audit(user.id, send ? "rfq.send" : "rfq.create", "Rfq", rfq.id, { suppliers: supplierIds.length });
  redirect(`/organisations/${orgId}/prestataires`);
}

export async function sendRfq(form: FormData) {
  const orgId = str(form, "orgId");
  const { user } = await requireMembership(orgId, EVENT_MANAGER_ROLES);
  const rfqId = str(form, "rfqId");
  await db.rfq.updateMany({ where: { id: rfqId, organizationId: orgId, status: "draft" }, data: { status: "sent", sentAt: new Date() } });
  await audit(user.id, "rfq.send", "Rfq", rfqId);
  revalidatePath(`/organisations/${orgId}/prestataires`);
}

export async function cancelRfq(form: FormData) {
  const orgId = str(form, "orgId");
  const { user } = await requireMembership(orgId, EVENT_MANAGER_ROLES);
  const rfqId = str(form, "rfqId");
  await db.rfq.updateMany({ where: { id: rfqId, organizationId: orgId, status: { in: ["draft", "sent"] } }, data: { status: "cancelled" } });
  await audit(user.id, "rfq.cancel", "Rfq", rfqId);
  revalidatePath(`/organisations/${orgId}/prestataires`);
}

/** Retenir un devis : les autres propositions passent en « non retenu ». */
export async function awardQuote(form: FormData) {
  const orgId = str(form, "orgId");
  const { user } = await requireMembership(orgId, EVENT_MANAGER_ROLES);
  const quote = await db.quote.findFirst({ where: { id: str(form, "quoteId"), rfq: { organizationId: orgId, status: "sent" } } });
  if (!quote) return;
  await db.$transaction([
    db.quote.update({ where: { id: quote.id }, data: { status: "retained" } }),
    db.quote.updateMany({ where: { rfqId: quote.rfqId, id: { not: quote.id } }, data: { status: "rejected" } }),
    db.rfq.update({ where: { id: quote.rfqId }, data: { status: "awarded" } }),
  ]);
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
  const amountCents = eurToCents(str(form, "amount"));
  if (amountCents === null) return { error: "Indiquez le montant du devis." };
  const data = { amountCents, delay: str(form, "delay") || null, note: str(form, "note") || null, authorId: user.id, status: "submitted" };
  const q = await db.quote.upsert({ where: { rfqId_supplierId: { rfqId, supplierId: orgId } }, update: data, create: { rfqId, supplierId: orgId, ...data } });
  if (invite.declined) await db.rfqSupplier.update({ where: { rfqId_supplierId: { rfqId, supplierId: orgId } }, data: { declined: false } });
  await audit(user.id, "quote.submit", "Quote", q.id, { rfqId, amountCents });
  revalidatePath(`/organisations/${orgId}/devis`);
  return { ok: "Devis transmis." };
}

export async function declineRfq(form: FormData) {
  const orgId = str(form, "orgId");
  const { user } = await requireSupplier(orgId);
  const rfqId = str(form, "rfqId");
  await db.rfqSupplier.updateMany({ where: { rfqId, supplierId: orgId }, data: { declined: true } });
  await audit(user.id, "rfq.decline", "Rfq", rfqId, { supplierId: orgId });
  revalidatePath(`/organisations/${orgId}/devis`);
}

export async function updateSupplierProfile(_: ActionState, form: FormData): Promise<ActionState> {
  const orgId = str(form, "orgId");
  const { user, isAdmin } = await requireSupplier(orgId);
  if (!isAdmin) return { error: "Réservé aux administrateurs." };
  const categories = form.getAll("categories").map(String).filter((c) => SUPPLIER_CATEGORIES.some((x) => x.id === c));
  const listed = form.get("listed") === "on";
  if (listed && categories.length === 0) return { error: "Choisissez au moins une catégorie pour être référencé." };
  await db.organization.update({ where: { id: orgId }, data: { supplierCategories: categories, coverage: str(form, "coverage") || null, listed } });
  await audit(user.id, "supplier.profile", "Organization", orgId, { categories, listed });
  revalidatePath(`/organisations/${orgId}/devis`);
  return { ok: "Fiche prestataire enregistrée." };
}

