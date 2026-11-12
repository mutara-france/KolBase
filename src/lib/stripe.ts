import "server-only";
import { encodeForm } from "@/lib/stripe-core";

/**
 * Client Stripe minimal (API REST, sans SDK). Facturation active seulement si STRIPE_SECRET_KEY est défini ;
 * STRIPE_API_URL permet de pointer vers un faux Stripe (tests).
 */
export const stripeEnabled = () => !!process.env.STRIPE_SECRET_KEY;

export async function stripe<T = Record<string, unknown>>(method: "GET" | "POST" | "DELETE", path: string, params: Record<string, unknown> = {}): Promise<T> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Stripe non configuré");
  const body = encodeForm(params);
  const url = `${process.env.STRIPE_API_URL ?? "https://api.stripe.com"}${path}${method === "GET" && body.size ? `?${body}` : ""}`;
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded", "Stripe-Version": "2024-06-20" },
    body: method === "GET" ? undefined : body,
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(`Stripe ${res.status} : ${data.error?.message ?? "erreur"}`);
  return data;
}

export type StripeSubscription = { id: string; status: string; customer: string; trial_end: number | null; current_period_end: number | null; cancel_at_period_end: boolean; metadata?: Record<string, string>; items?: { data: { id?: string; price?: { product?: string | null; recurring?: { interval?: string } | null } }[] } };
