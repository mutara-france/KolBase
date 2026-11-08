"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/auth";
import { requireMembership } from "@/lib/orgs";
import { requirePlatformAdmin } from "@/lib/platform";
import { str } from "@/lib/form";
import { checkoutUrl, portalUrl, stripeEnabled, syncStripePause } from "@/lib/billing";
import { asInterval, asMotive, asObjectId, exempt, planFor } from "@/lib/billing-plans";
import { notifyExemption } from "@/lib/notifications";
import { parseParisDateTime } from "@/lib/events";
import { getT } from "@/lib/i18n/server";

/** Activation de l'abonnement par un administrateur : page de paiement Stripe. */
export async function startSubscription(form: FormData) {
  const orgId = str(form, "orgId");
  const { user, isAdmin } = await requireMembership(orgId, undefined, { allowSupplier: true });
  if (!isAdmin || !stripeEnabled()) redirect(`/organisations/${orgId}/abonnement`);
  const interval = asInterval(form.get("interval"));
  const url = await checkoutUrl(orgId, user.email, interval, { motive: asMotive(form.get("motif")), objet: asObjectId(form.get("objet")) });
  await audit(user.id, "billing.checkout", "Organization", orgId, { interval });
  redirect(url);
}

/** Espace client Stripe (moyen de paiement, factures, résiliation). */
export async function openBillingPortal(form: FormData) {
  const orgId = str(form, "orgId");
  const { isAdmin } = await requireMembership(orgId, undefined, { allowSupplier: true });
  if (!isAdmin || !stripeEnabled()) redirect(`/organisations/${orgId}/abonnement`);
  const url = await portalUrl(orgId);
  redirect(url ?? `/organisations/${orgId}/abonnement`);
}

export type ExemptionState = { error?: string } | undefined;

/**
 * Gratuité accordée par KolBase jusqu'à une date (pilote, partenaire), ou retirée. La date saisie est le dernier
 * jour offert : fin de journée à Paris ; absente ou passée, elle est refusée avec un message. Abonnement Stripe en
 * cours : facturation en pause jusqu'à la fin de la gratuité, puis reprise (en pause tant que l'organisation est
 * suspendue).
 */
async function applyExemption(form: FormData): Promise<ExemptionState> {
  const { t } = await getT();
  const admin = await requirePlatformAdmin();
  const orgId = str(form, "orgId");
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { kind: true } });
  if (!org) return { error: t("Organisation introuvable.") };
  const remove = form.get("remove") === "1";
  const until = str(form, "until");
  // Fin de la journée choisie, heure de Paris (la date affichée est bien celle saisie).
  const date = /^\d{4}-\d{2}-\d{2}$/.test(until) ? parseParisDateTime(`${until}T23:59`) : null;
  if (!remove && !date) return { error: t("Indiquez le dernier jour offert.") };
  if (!remove && date! < new Date()) return { error: t("Date passée : choisissez aujourd'hui ou un jour à venir.") };
  const data = remove ? { exemptUntil: null, exemptNote: null } : { exemptUntil: date, exemptNote: str(form, "note").slice(0, 200) || null };
  const before = await db.subscription.findUnique({ where: { organizationId: orgId }, select: { status: true, exemptUntil: true } });
  await db.subscription.upsert({ where: { organizationId: orgId }, update: data, create: { organizationId: orgId, plan: planFor(org.kind), ...data } });
  let stripeBilling: Awaited<ReturnType<typeof syncStripePause>> = null;
  try {
    stripeBilling = await syncStripePause(orgId);
  } catch (e) {
    // La gratuité vaut dans KolBase ; la pause Stripe se rattrape depuis le tableau de bord Stripe.
    console.error("[gratuité : pause Stripe]", e);
    await audit(admin.id, "billing.stripe_pause_failed", "Organization", orgId, { remove });
  }
  await audit(admin.id, remove ? "billing.exempt_remove" : "billing.exempt", "Organization", orgId, { until: remove ? undefined : until, stripe: stripeBilling ?? undefined });
  // L'organisation est prévenue : gratuité offerte (ou prolongée), ou retirée alors qu'elle était en cours.
  if (!remove || exempt(before)) notifyExemption(orgId, remove ? null : date, remove ? null : data.exemptNote ?? null, stripeBilling);
  revalidatePath("/admin", "layout");
}

/** Retrait de la gratuité (formulaire simple, avec confirmation). */
export async function setExemption(form: FormData) {
  await applyExemption(form);
}

/** Gratuité offerte : date obligatoire, à venir ; l'erreur est affichée à côté du formulaire. */
export async function offerExemption(_: ExemptionState, form: FormData): Promise<ExemptionState> {
  return applyExemption(form);
}
