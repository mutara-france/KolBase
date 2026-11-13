"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/auth";
import { requireMembership } from "@/lib/orgs";
import { STATS_ROLES } from "@/lib/org-roles";
import { orgHasAddon } from "@/lib/billing";
import { MAX_NAME, str } from "@/lib/form";
import { normName, parseAliases } from "@/lib/intelligence";
import { namedBy } from "@/lib/market";
import { currentImport } from "@/lib/market-data";
import { suggestProduct } from "@/lib/intelligence-advice";
import { productOverview } from "@/lib/intelligence-data";
import { getT } from "@/lib/i18n/server";

export type ActionState = { error?: string; ok?: string } | undefined;

/** Organisations comparées par organisation : au-delà, la comparaison et la veille perdent leur sens. */
const MAX_COMPETITORS = 20;

/** Membre autorisé (rôles des statistiques) d'une organisation qui dispose de l'option ; sinon null. */
async function access(orgId: string) {
  const m = await requireMembership(orgId, STATS_ROLES);
  return (await orgHasAddon(orgId, "intelligence")) ? m : null;
}
const refresh = (orgId: string) => revalidatePath(`/organisations/${orgId}/intelligence`);

/** Entreprises de la base publique (dernier import) dont le nom contient l'une des écritures données. */
async function entitiesNamed(names: readonly string[]) {
  const imp = await currentImport();
  if (!imp) return null;
  const companies = await db.marketLink.findMany({ where: { importId: imp.id }, distinct: ["companyKey"], select: { company: true } });
  return companies.filter((c) => namedBy(c.company, names)).length;
}

/** Organisation ajoutée à la comparaison : nom et autres écritures (marques, filiales) reconnues dans la base publique. */
export async function addCompetitor(_: ActionState, form: FormData): Promise<ActionState> {
  const { t } = await getT();
  const orgId = str(form, "orgId");
  const m = await access(orgId);
  if (!m) return { error: t("Cette page fait partie de l'option KolBase Intelligence.") };
  const name = str(form, "name", MAX_NAME);
  if (normName(name).length < 3) return { error: t("Indiquez le nom de l'organisation (trois caractères au moins).") };
  const existing = await db.competitor.findMany({ where: { organizationId: orgId }, select: { name: true } });
  if (existing.some((c) => normName(c.name) === normName(name))) return { error: t("Cette organisation est déjà dans votre comparaison.") };
  if (existing.length >= MAX_COMPETITORS) return { error: t("Vous comparez déjà {n} organisations : retirez-en une pour en ajouter une autre.", { n: MAX_COMPETITORS }) };
  const aliases = parseAliases(str(form, "aliases", 1500));
  const c = await db.competitor.create({ data: { organizationId: orgId, name, aliases } });
  await audit(m.user.id, "intelligence.competitor_add", "Organization", orgId, { competitorId: c.id, name });
  refresh(orgId);
  const found = await entitiesNamed([name, ...aliases]);
  if (found === 0) return { ok: t("{name} est ajoutée, mais aucune entreprise de la base publique ne porte ce nom : vérifiez son écriture ou ajoutez sa raison sociale.", { name }) };
  return { ok: t("{name} est ajoutée à votre comparaison.", { name }) };
}

/** Organisation retirée de la comparaison. */
export async function removeCompetitor(form: FormData) {
  const orgId = str(form, "orgId");
  const m = await access(orgId);
  if (!m) return;
  const c = await db.competitor.findFirst({ where: { id: str(form, "competitorId"), organizationId: orgId } });
  if (!c) return;
  await db.competitor.delete({ where: { id: c.id } });
  await audit(m.user.id, "intelligence.competitor_remove", "Organization", orgId, { name: c.name });
  refresh(orgId);
}

/**
 * Écritures sous lesquelles l'organisation déclare dans la base publique (raison sociale, filiales) : elles servent à
 * la reconnaître pour la comparer. Vide : son nom dans KolBase.
 */
export async function saveMarketNames(_: ActionState, form: FormData): Promise<ActionState> {
  const { t } = await getT();
  const orgId = str(form, "orgId");
  const m = await access(orgId);
  if (!m) return { error: t("Cette page fait partie de l'option KolBase Intelligence.") };
  const names = parseAliases(str(form, "names", 1500));
  await db.marketProfile.upsert({ where: { organizationId: orgId }, create: { organizationId: orgId, names }, update: { names } });
  await audit(m.user.id, "intelligence.market_names", "Organization", orgId, { names });
  refresh(orgId);
  const found = await entitiesNamed(names.length ? names : [m.org.name]);
  if (found === 0) return { error: t("Enregistré, mais aucune entreprise de la base publique ne porte ce nom : essayez la raison sociale exacte de votre déclarant.") };
  return { ok: found === null ? t("Enregistré.") : t(found > 1 ? "Enregistré : {n} entreprises de la base publique vous sont rattachées." : "Enregistré : {n} entreprise de la base publique vous est rattachée.", { n: found }) };
}

/** Produits par organisation : au-delà, c'est une référence d'article, pas un produit à piloter. */
const MAX_PRODUCTS = 60;

/** Produit ou gamme ajouté au catalogue de l'organisation : ses dossiers et ses événements s'y rattachent ensuite. */
export async function addProduct(_: ActionState, form: FormData): Promise<ActionState> {
  const { t } = await getT();
  const orgId = str(form, "orgId");
  const m = await access(orgId);
  if (!m) return { error: t("Cette page fait partie de l'option KolBase Intelligence.") };
  const name = str(form, "name", MAX_NAME);
  if (normName(name).length < 2) return { error: t("Indiquez le nom du produit.") };
  const existing = await db.product.findMany({ where: { organizationId: orgId }, select: { name: true } });
  if (existing.some((p) => normName(p.name) === normName(name))) return { error: t("Ce produit existe déjà.") };
  if (existing.length >= MAX_PRODUCTS) return { error: t("Vous avez atteint {n} produits : regroupez-les par gamme.", { n: MAX_PRODUCTS }) };
  const product = await db.product.create({ data: { organizationId: orgId, name, range: str(form, "range", MAX_NAME) || null } });
  await audit(m.user.id, "intelligence.product_add", "Organization", orgId, { productId: product.id, name });
  refresh(orgId);
  return { ok: t("{name} est ajouté : rattachez-y vos dossiers et vos événements.", { name }) };
}

/** Produit archivé (son historique reste lisible, il n'est plus proposé) ou remis en service. */
export async function archiveProduct(form: FormData) {
  const orgId = str(form, "orgId");
  const m = await access(orgId);
  if (!m) return;
  const product = await db.product.findFirst({ where: { id: str(form, "productId"), organizationId: orgId } });
  if (!product) return;
  await db.product.update({ where: { id: product.id }, data: { archivedAt: product.archivedAt ? null : new Date() } });
  await audit(m.user.id, product.archivedAt ? "intelligence.product_restore" : "intelligence.product_archive", "Organization", orgId, { name: product.name });
  refresh(orgId);
}

/** Dossier ou événement de l'organisation rattaché à l'un de ses produits (ou détaché : produit vide). */
async function attach(orgId: string, kind: string, id: string, productId: string | null) {
  if (kind === "project") return (await db.project.updateMany({ where: { id, organizationId: orgId }, data: { productId } })).count;
  if (kind === "event") return (await db.event.updateMany({ where: { id, organizationId: orgId }, data: { productId } })).count;
  return 0;
}

export async function assignProduct(form: FormData) {
  const orgId = str(form, "orgId");
  const m = await access(orgId);
  if (!m) return;
  const productId = str(form, "productId") || null;
  // Le produit doit être celui de l'organisation : jamais celui d'une autre.
  if (productId && !(await db.product.findFirst({ where: { id: productId, organizationId: orgId }, select: { id: true } }))) return;
  if (await attach(orgId, str(form, "kind"), str(form, "id"), productId)) await audit(m.user.id, "intelligence.product_assign", "Organization", orgId, { kind: str(form, "kind"), id: str(form, "id"), productId });
  refresh(orgId);
}

/** Rattache d'un coup les dossiers et événements de l'année dont le titre nomme un produit (propositions affichées). */
export async function assignSuggestedProducts(form: FormData) {
  const orgId = str(form, "orgId");
  const m = await access(orgId);
  if (!m) return;
  const year = Number(str(form, "year"));
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return;
  const o = await productOverview(orgId, year);
  let done = 0;
  for (const item of o.toAttach) {
    const product = suggestProduct(item.title, o.products);
    if (product) done += await attach(orgId, item.kind, item.id, product.id);
  }
  if (done) await audit(m.user.id, "intelligence.product_assign_suggested", "Organization", orgId, { year, count: done });
  refresh(orgId);
}
