import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { appUrl } from "@/lib/ics";
import { hasAddon } from "@/lib/billing-plans";
import { logoSrc } from "@/lib/logos";
import { hostOf, type Brand } from "@/lib/brand";

/** Hôte de l'adresse publique de KolBase (APP_URL), "" si elle manque. */
export function appHost() {
  try {
    return new URL(appUrl()).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Marques par hôte, gardées une minute par instance : la mise en page les lit à chaque requête. La table est posée sur
 * globalThis : les pages, les actions et les routes (robots.txt) sont compilées à part et auraient chacune la leur —
 * une activation ne serait alors vue des autres qu'une minute plus tard.
 */
const TTL_MS = 60_000;
export type HostBrand = { claimed: boolean; brand: Brand | null };
const shared = globalThis as unknown as { kolbaseBrands?: Map<string, { at: number; value: HostBrand }> };
const known = (shared.kolbaseBrands ??= new Map());
const FREE: HostBrand = { claimed: false, brand: null };
/** Après un changement de marque ou de domaine : la nouvelle valeur est lue à la requête suivante (sur cette instance). */
export const forgetBrand = (domain?: string | null) => (domain ? known.delete(domain) : known.clear());

/**
 * Ce qu'est un hôte pour KolBase Business :
 * - `claimed` : c'est le nom de domaine d'une organisation (demandé, actif ou retiré mais pas encore détaché du
 *   service). Son DNS appartient à cette organisation : on n'y ouvre jamais une session KolBase ordinaire (voir
 *   createSession, lib/auth).
 * - `brand` : la marque servie — domaine activé par KolBase, organisation validée, option en cours. L'option retirée
 *   ou l'organisation suspendue, le domaine cesse d'afficher la marque sans autre action.
 */
export async function hostBrand(host: string): Promise<HostBrand> {
  if (!host || host === appHost() || host === `www.${appHost()}` || !host.includes(".")) return FREE;
  const hit = known.get(host);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const row = await db.orgBrand.findUnique({
    where: { domain: host },
    select: { displayName: true, color: true, domainStatus: true, organization: { select: { id: true, name: true, verification: true, logoUpdatedAt: true, subscription: { select: { status: true, addons: true, addonsGranted: true } } } } },
  });
  const served = !!row && row.domainStatus === "active" && row.organization.verification === "VERIFIED" && hasAddon(row.organization.subscription, "business");
  const value: HostBrand = row ? { claimed: true, brand: served ? { orgId: row.organization.id, name: row.displayName || row.organization.name, logo: logoSrc(row.organization), color: row.color } : null } : FREE;
  if (known.size > 500) known.clear();
  known.set(host, { at: Date.now(), value });
  return value;
}

/** Hôte de la requête en cours (transmis par le répartiteur de l'hébergeur, sinon en-tête Host). */
export const currentHost = cache(async (): Promise<HostBrand> => {
  const h = await headers();
  return hostBrand(hostOf(h.get("x-forwarded-host") ?? h.get("host")));
});
/** Marque de la requête en cours, null sur KolBase. */
export const currentBrand = async (): Promise<Brand | null> => (await currentHost()).brand;
