"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/auth";
import { requireMembership } from "@/lib/orgs";
import { requirePlatformAdmin } from "@/lib/platform";
import { str } from "@/lib/form";
import { checkoutUrl, portalUrl, stripeEnabled } from "@/lib/billing";
import { asInterval, planFor } from "@/lib/billing-plans";

/** Activation de l'abonnement par un administrateur : page de paiement Stripe. */
export async function startSubscription(form: FormData) {
  const orgId = str(form, "orgId");
  const { user, isAdmin } = await requireMembership(orgId, undefined, { allowSupplier: true });
  if (!isAdmin || !stripeEnabled()) redirect(`/organisations/${orgId}/abonnement`);
  const interval = asInterval(form.get("interval"));
  const url = await checkoutUrl(orgId, user.email, interval);
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

/** Gratuité accordée par KolBase jusqu'à une date (pilote, partenaire), ou retirée. */
export async function setExemption(form: FormData) {
  const admin = await requirePlatformAdmin();
  const orgId = str(form, "orgId");
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { kind: true } });
  if (!org) return;
  const remove = form.get("remove") === "1";
  const until = str(form, "until");
  const date = /^\d{4}-\d{2}-\d{2}$/.test(until) ? new Date(`${until}T23:59:59Z`) : null;
  if (!remove && (!date || date < new Date())) return;
  const data = remove ? { exemptUntil: null, exemptNote: null } : { exemptUntil: date, exemptNote: str(form, "note").slice(0, 200) || null };
  await db.subscription.upsert({ where: { organizationId: orgId }, update: data, create: { organizationId: orgId, plan: planFor(org.kind), ...data } });
  await audit(admin.id, remove ? "billing.exempt_remove" : "billing.exempt", "Organization", orgId, { until: remove ? undefined : until });
  revalidatePath("/admin");
}
