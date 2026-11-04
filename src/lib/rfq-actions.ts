"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/auth";
import { isSuspendedOrg, isVerifiedOrg, notVerified, ORG_SUSPENDED, requireMembership } from "@/lib/orgs";
import { EVENT_MANAGER_ROLES, EVENT_ORGANIZER_ROLES, eventScope, parseParisDateTime } from "@/lib/events";
import { canCancelRfq, SUPPLIER_CATEGORIES } from "@/lib/suppliers";
import { eurToCents, intOrNull, str } from "@/lib/form";
import { isVatBp, linesTotal, MAX_LINES, withVat, type QuoteLine } from "@/lib/quotes";
import { MAX_UPLOAD_BYTES, putObject, safeFileName, storageEnabled } from "@/lib/storage";
import { engagementGate, gateMessage, markSupplierTriggered, stripeEnabled, supplierCanQuote } from "@/lib/billing";
import type { GateLink } from "@/lib/billing-plans";
import { awardRight } from "@/lib/mandates";
import { notifyAward, notifyProposalWithdrawn, notifyQuote, notifyRfqDeclined, notifyQuoteProposed, notifyRfqCancelled, notifyRfqMessage, notifyRfqSent, notifySupplierBilling } from "@/lib/notifications";

export type ActionState = { error?: string; ok?: string; fix?: GateLink } | undefined;

// ─── Côté organisation ──────────────────────────────────────────────────────

/** Un prestataire mandaté n'agit que sur les demandes liées aux événements qui lui sont confiés. */
function rfqScope(user: Parameters<typeof eventScope>[0], roles: Parameters<typeof eventScope>[1]) {
  const scope = eventScope(user, roles);
  return Object.keys(scope).length ? { event: scope } : {};
}

/** Organisations prestataires dont l'utilisateur est membre (une agence, par exemple). */
const ownSuppliers = (user: Parameters<typeof eventScope>[0]) => user.memberships.filter((m) => m.organization.kind === "PRESTATAIRE").map((m) => m.organizationId);

/**
 * Conflit d'intérêts : l'organisation de l'utilisateur (agence de l'événement) est consultée sur la demande.
 * Elle y répond comme prestataire, depuis son espace ; elle n'agit pas pour le client sur cette demande.
 */
async function rfqConflicted(rfqId: string, user: Parameters<typeof eventScope>[0]) {
  const own = ownSuppliers(user);
  return own.length > 0 && (await db.rfqSupplier.count({ where: { rfqId, supplierId: { in: own } } })) > 0;
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
  const suppliers = await db.organization.findMany({ where: { id: { in: supplierIds }, kind: "PRESTATAIRE", listed: true, verification: "VERIFIED", supplierCategories: { has: category } } });
  if (suppliers.length !== supplierIds.length) return { error: "Un des prestataires sélectionnés n'est pas référencé dans cette catégorie." };
  // Une agence mandatée ne se consulte pas elle-même : l'organisation la consulte directement si elle le souhaite.
  const own = suppliers.find((s) => user.memberships.some((m) => m.organizationId === s.id));
  if (own) return { error: `${own.name} est votre propre organisation : vous ne pouvez pas la consulter pour le compte du client. Retirez-la de la sélection.` };
  const needs = str(form, "needs");
  if (needs.length < 10) return { error: "Décrivez votre besoin." };
  const deadlineRaw = str(form, "deadline");
  const deadline = deadlineRaw ? parseParisDateTime(`${deadlineRaw}T23:59`) : null;
  if (deadlineRaw && (!deadline || deadline < new Date())) return { error: "Date de réponse invalide ou passée." };
  const headcount = intOrNull(str(form, "headcount")) || event?.capacity || null;
  const send = str(form, "intent") === "send";
  if (send && !isVerifiedOrg(org)) return { error: `Envoi impossible pour l'instant : ${notVerified(org)} Enregistrez la demande en brouillon.` };
  const gate = send ? await engagementGate(orgId, "devis") : null;
  if (gate) return { ...gate, error: `${gate.error} Vous pouvez l'enregistrer en brouillon.` };

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
  if (await rfqConflicted(rfqId, user)) return;
  const gate = await engagementGate(orgId, "devis", rfqId);
  if (gate) redirect(gate.fix.href);
  const { count } = await db.rfq.updateMany({ where: { id: rfqId, organizationId: orgId, ...rfqScope(user, roles), status: "draft" }, data: { status: "sent", sentAt: new Date() } });
  if (!count) return;
  await audit(user.id, "rfq.send", "Rfq", rfqId);
  notifyRfqSent(rfqId);
  revalidatePath(`/organisations/${orgId}/prestataires`);
}

/**
 * Annuler une demande : réservé à l'organisation cliente (organisateurs) et à l'auteur de la demande ; jamais à
 * une agence consultée sur la demande. Les organisateurs sont prévenus quand ce n'est pas l'un d'eux qui annule.
 */
export async function cancelRfq(form: FormData) {
  const orgId = str(form, "orgId");
  const { user, roles } = await requireMembership(orgId, EVENT_MANAGER_ROLES);
  const rfqId = str(form, "rfqId");
  const rfq = await db.rfq.findFirst({ where: { id: rfqId, organizationId: orgId, ...rfqScope(user, roles), status: { in: ["draft", "sent"] } }, select: { createdById: true } });
  if (!rfq) return;
  const organizer = roles.some((r) => EVENT_ORGANIZER_ROLES.includes(r));
  if (!canCancelRfq({ organizer, author: rfq.createdById === user.id, conflicted: await rfqConflicted(rfqId, user) })) return;
  const { count } = await db.rfq.updateMany({ where: { id: rfqId, status: { in: ["draft", "sent"] } }, data: { status: "cancelled", cancelledAt: new Date(), cancelledById: user.id } });
  if (!count) return;
  await audit(user.id, "rfq.cancel", "Rfq", rfqId);
  notifyRfqCancelled(rfqId, user.id);
  revalidatePath(`/organisations/${orgId}/prestataires`);
}

/** Retenir un devis : les autres propositions passent en « non retenu ». */
export async function awardQuote(form: FormData) {
  const orgId = str(form, "orgId");
  const { user, roles } = await requireMembership(orgId, EVENT_MANAGER_ROLES);
  const quote = await db.quote.findFirst({ where: { id: str(form, "quoteId"), rfq: { organizationId: orgId, ...rfqScope(user, roles), status: "sent" } }, include: { rfq: { select: { event: { select: { agencyId: true } } } } } });
  if (!quote) return;
  // Une offre expirée n'engage plus le prestataire : il faut d'abord lui demander une version à jour.
  if (quote.validUntil && quote.validUntil < new Date()) return;
  // Conflit d'intérêts : un membre d'un prestataire consulté (agence mandatée, par exemple) ne retient aucun devis
  // de la demande, ni le sien ni celui d'un concurrent.
  if (await rfqConflicted(quote.rfqId, user)) return;
  // Agence mandatée sans le droit de retenir : elle propose, l'organisateur décide.
  if ((await awardRight(orgId, roles, quote.rfq.event?.agencyId)) !== "award") return;
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
  notifyAward(quote.rfqId, user.id);
  // Premier devis retenu : l'abonnement prestataire devient à activer (le référencement reste gratuit).
  if (stripeEnabled() && (await db.quote.count({ where: { supplierId: quote.supplierId, status: "retained" } })) === 1) {
    const client = (await db.organization.findUnique({ where: { id: orgId }, select: { name: true } }))?.name ?? "Une organisation";
    if (await markSupplierTriggered(quote.supplierId, `Premier devis retenu par ${client}`)) notifySupplierBilling(quote.supplierId, client);
  }
  revalidatePath(`/organisations/${orgId}/prestataires`);
}

/** Agence mandatée sans droit de retenir : elle propose un devis aux organisateurs, qui décident. */
export async function proposeQuote(form: FormData) {
  const orgId = str(form, "orgId");
  const { user, roles } = await requireMembership(orgId, EVENT_MANAGER_ROLES);
  const quote = await db.quote.findFirst({ where: { id: str(form, "quoteId"), rfq: { organizationId: orgId, ...rfqScope(user, roles), status: "sent" } }, include: { rfq: { select: { event: { select: { agencyId: true } } } } } });
  if (!quote || (quote.validUntil && quote.validUntil < new Date())) return;
  if (await rfqConflicted(quote.rfqId, user)) return;
  if ((await awardRight(orgId, roles, quote.rfq.event?.agencyId)) !== "propose") return;
  await db.rfq.update({ where: { id: quote.rfqId }, data: { proposedQuoteId: quote.id, proposedById: user.id, proposedAt: new Date() } });
  await audit(user.id, "rfq.propose", "Rfq", quote.rfqId, { quoteId: quote.id, supplierId: quote.supplierId, amountCents: quote.amountCents });
  notifyQuoteProposed(quote.rfqId, user.id);
  revalidatePath(`/organisations/${orgId}/prestataires`);
}

/**
 * Report du coût réel d'un devis retenu dans la valeur déclarée d'une hospitalité de l'événement.
 * Les inscriptions déjà déclarées (Transparence Santé) gardent leur valeur ; les autres sont mises à jour.
 */
export async function applyQuoteToBenefit(form: FormData) {
  const orgId = str(form, "orgId");
  const { user } = await requireMembership(orgId, EVENT_ORGANIZER_ROLES);
  const quote = await db.quote.findFirst({ where: { id: str(form, "quoteId"), status: "retained", rfq: { organizationId: orgId, eventId: { not: null } } }, include: { rfq: true } });
  if (!quote?.rfq.eventId) return;
  const benefit = await db.eventBenefit.findFirst({ where: { id: str(form, "benefitId"), eventId: quote.rfq.eventId } });
  if (!benefit) return;
  const valueCents = eurToCents(str(form, "value"), { allowZero: false });
  if (!valueCents || valueCents > 1_000_000) return;
  await db.$transaction([
    db.eventBenefit.update({ where: { id: benefit.id }, data: { valueCents } }),
    db.registrationBenefit.updateMany({ where: { benefitId: benefit.id, registration: { declared: false } }, data: { valueCents } }),
  ]);
  await audit(user.id, "event.benefit_value", "Event", quote.rfq.eventId, { benefit: benefit.label, from: benefit.valueCents, to: valueCents, quoteId: quote.id, ttcCents: withVat(quote.amountCents, quote.vatBp) });
  revalidatePath(`/organisations/${orgId}/evenements/${quote.rfq.eventId}`);
}

// ─── Questions et échanges sur une demande ─────────────────────────────────

/** Message dans le fil privé entre le demandeur et un prestataire consulté (de part et d'autre). */
export async function postRfqMessage(_: ActionState, form: FormData): Promise<ActionState> {
  const orgId = str(form, "orgId");
  const rfqId = str(form, "rfqId");
  const supplierId = str(form, "supplierId");
  const body = str(form, "body");
  if (!body) return { error: "Écrivez votre message." };
  if (body.length > 4000) return { error: "Message trop long (4 000 caractères au maximum)." };
  const { user, roles, org } = await requireMembership(orgId);
  const fromSupplier = org.kind === "PRESTATAIRE" && orgId === supplierId;
  if (!fromSupplier && (org.kind === "PRESTATAIRE" || !roles.some((r) => EVENT_MANAGER_ROLES.includes(r)))) return { error: "Action non autorisée." };
  const invite = await db.rfqSupplier.findFirst({
    where: { rfqId, supplierId, rfq: { status: { in: ["sent", "awarded"] }, ...(fromSupplier ? {} : { organizationId: orgId, ...rfqScope(user, roles) }) } },
  });
  if (!invite) return { error: "Cette demande n'accepte plus de messages." };
  // Agence consultée sur la demande : elle n'écrit pas aux prestataires au nom du client.
  if (!fromSupplier && (await rfqConflicted(rfqId, user))) return { error: "Votre organisation est consultée sur cette demande : vous y répondez comme prestataire, depuis vos demandes de devis." };
  await db.rfqMessage.create({ data: { rfqId, supplierId, authorId: user.id, body, fromSupplier } });
  await audit(user.id, "rfq.message", "Rfq", rfqId, { supplierId, fromSupplier });
  notifyRfqMessage(rfqId, supplierId, fromSupplier, user.id);
  revalidatePath(fromSupplier ? `/organisations/${orgId}/devis` : `/organisations/${orgId}/prestataires`);
  return { ok: "Message envoyé." };
}

// ─── Côté prestataire ───────────────────────────────────────────────────────

async function requireSupplier(orgId: string) {
  const ctx = await requireMembership(orgId);
  if (ctx.org.kind !== "PRESTATAIRE") redirect(`/organisations/${orgId}`);
  return ctx;
}

export async function submitQuote(_: ActionState, form: FormData): Promise<ActionState> {
  const orgId = str(form, "orgId");
  const { user, org } = await requireSupplier(orgId);
  if (isSuspendedOrg(org)) return { error: ORG_SUSPENDED };
  const rfqId = str(form, "rfqId");
  const invite = await db.rfqSupplier.findUnique({ where: { rfqId_supplierId: { rfqId, supplierId: orgId } }, include: { rfq: true } });
  if (!invite || invite.rfq.status !== "sent") return { error: "Cette demande n'accepte plus de devis." };
  // Après un premier devis retenu, répondre à une nouvelle demande suppose l'abonnement (les révisions restent libres).
  if (!(await db.quote.findFirst({ where: { rfqId, supplierId: orgId }, select: { id: true } })) && !(await supplierCanQuote(orgId))) return { error: gateMessage("reponse") };

  // Devis détaillé (lignes) ou montant global.
  const labels = form.getAll("line_label").map((v) => String(v).trim().slice(0, 200));
  const qtys = form.getAll("line_qty").map(String);
  const units = form.getAll("line_unit").map(String);
  const lines: QuoteLine[] = [];
  for (let i = 0; i < labels.length && i < MAX_LINES; i++) {
    if (!labels[i] && !units[i]) continue;
    const qty = Number((qtys[i] ?? "1").replace(",", "."));
    const unitCents = eurToCents(units[i] ?? "");
    if (!labels[i] || !Number.isFinite(qty) || qty <= 0 || qty > 100000 || unitCents === null) return { error: `Ligne ${i + 1} incomplète : désignation, quantité positive et prix unitaire.` };
    lines.push({ label: labels[i], qty, unitCents });
  }
  const amountCents = lines.length ? linesTotal(lines) : eurToCents(str(form, "amount"), { allowZero: false });
  if (!amountCents) return { error: "Détaillez votre offre ligne par ligne : désignation, quantité et prix unitaire." };
  if (amountCents > 1_000_000_000) return { error: "Montant trop élevé." };
  const vatBp = Number(str(form, "vat") || "2000");
  if (!isVatBp(vatBp)) return { error: "Taux de TVA invalide." };
  const validRaw = str(form, "validUntil");
  const validUntil = validRaw ? parseParisDateTime(`${validRaw}T23:59`) : null;
  if (validRaw && (!validUntil || validUntil < new Date())) return { error: "Date de validité invalide ou passée." };

  // Pièce jointe : le devis signé au format PDF (si le stockage de documents est configuré).
  const file = form.get("file");
  let upload: { bytes: Uint8Array; name: string } | null = null;
  if (file instanceof File && file.size > 0) {
    if (!storageEnabled()) return { error: "Le dépôt de fichiers n'est pas encore activé : détaillez votre devis ligne par ligne." };
    if (file.size > MAX_UPLOAD_BYTES) return { error: "Fichier trop lourd : 10 Mo au maximum." };
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (String.fromCharCode(...bytes.subarray(0, 5)) !== "%PDF-") return { error: "Joignez le devis au format PDF." };
    upload = { bytes, name: safeFileName(file.name || "devis.pdf") };
  }

  const existing = await db.quote.findUnique({ where: { rfqId_supplierId: { rfqId, supplierId: orgId } } });
  const data = {
    amountCents, lines, vatBp, validUntil, conditions: str(form, "conditions") || null,
    delay: str(form, "delay") || null, note: str(form, "note") || null, authorId: user.id, status: "submitted" as const,
  };
  const q = existing
    ? await db.quote.update({ where: { id: existing.id }, data: { ...data, revision: existing.revision + 1 } })
    : await db.quote.create({ data: { rfqId, supplierId: orgId, ...data } });
  // Devis révisé alors que l'agence l'avait proposé : la proposition portait sur l'ancienne version, elle tombe.
  if (existing && invite.rfq.proposedQuoteId === existing.id) {
    const { count } = await db.rfq.updateMany({ where: { id: rfqId, proposedQuoteId: existing.id }, data: { proposedQuoteId: null, proposedById: null, proposedAt: null } });
    if (count && invite.rfq.proposedById) notifyProposalWithdrawn(rfqId, orgId, invite.rfq.proposedById);
  }
  if (upload) {
    const key = `devis/${q.id}/${Date.now()}-${upload.name}`;
    await putObject(key, upload.bytes, "application/pdf");
    await db.quote.update({ where: { id: q.id }, data: { fileKey: key, fileName: upload.name } });
  }
  if (invite.declined) await db.rfqSupplier.update({ where: { rfqId_supplierId: { rfqId, supplierId: orgId } }, data: { declined: false, declineNote: null, declinedAt: null } });
  await audit(user.id, existing ? "quote.revise" : "quote.submit", "Quote", q.id, { rfqId, amountCents, revision: existing ? existing.revision + 1 : 1 });
  notifyQuote(rfqId, orgId, !!existing);
  revalidatePath(`/organisations/${orgId}/devis`);
  return { ok: existing ? `Devis révisé (version ${existing.revision + 1}).` : "Devis transmis." };
}

/** Le prestataire décline une demande (motif facultatif, montré au client) : les interlocuteurs de la demande sont prévenus. */
export async function declineRfq(form: FormData) {
  const orgId = str(form, "orgId");
  const { user } = await requireSupplier(orgId);
  const rfqId = str(form, "rfqId");
  const declineNote = str(form, "note").slice(0, 500) || null;
  const { count } = await db.rfqSupplier.updateMany({ where: { rfqId, supplierId: orgId, declined: false, rfq: { status: "sent" } }, data: { declined: true, declineNote, declinedAt: new Date() } });
  if (!count) return;
  await audit(user.id, "rfq.decline", "Rfq", rfqId, { supplierId: orgId, note: declineNote ?? undefined });
  notifyRfqDeclined(rfqId, orgId, user.id);
  revalidatePath(`/organisations/${orgId}/devis`);
}

export async function updateSupplierProfile(_: ActionState, form: FormData): Promise<ActionState> {
  const orgId = str(form, "orgId");
  const { user, isAdmin, org: ctxOrg } = await requireSupplier(orgId);
  if (!isAdmin) return { error: "Réservé aux administrateurs." };
  const categories = form.getAll("categories").map(String).filter((c) => SUPPLIER_CATEGORIES.some((x) => x.id === c));
  const listed = form.get("listed") === "on";
  if (listed && categories.length === 0) return { error: "Choisissez au moins une catégorie pour être référencé." };
  if (listed && !isVerifiedOrg(ctxOrg)) return { error: `Référencement impossible pour l'instant : ${notVerified(ctxOrg)}` };
  await db.organization.update({ where: { id: orgId }, data: { supplierCategories: categories, coverage: str(form, "coverage") || null, listed } });
  await audit(user.id, "supplier.profile", "Organization", orgId, { categories, listed });
  revalidatePath(`/organisations/${orgId}/devis`);
  return { ok: "Fiche prestataire enregistrée." };
}

