"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/auth";
import { requireMembership } from "@/lib/orgs";
import { requirePlatformAdmin } from "@/lib/platform";
import { orgHasAddon } from "@/lib/billing";
import { MAX_NAME, str } from "@/lib/form";
import { asBrandColor, asBrandDomain, contrastWithWhite, DOMAIN_REFUSAL, MIN_CONTRAST } from "@/lib/brand";
import { appHost, forgetBrand } from "@/lib/brand-server";
import { notifyPlatformAdmins } from "@/lib/notifications";
import { getT } from "@/lib/i18n/server";

export type ActionState = { error?: string; ok?: string } | undefined;

/** Administrateur d'une organisation qui dispose de l'option KolBase Business ; sinon null. */
async function access(orgId: string) {
  const m = await requireMembership(orgId, ["ADMIN"]);
  return (await orgHasAddon(orgId, "business")) ? m : null;
}
const refresh = (orgId: string) => {
  revalidatePath(`/organisations/${orgId}/marque`);
  revalidatePath("/admin/abonnements");
};

/** Nom affiché et couleur principale de la marque (vides : nom de l'organisation, couleurs de KolBase). */
export async function saveBrand(_: ActionState, form: FormData): Promise<ActionState> {
  const { t } = await getT();
  const orgId = str(form, "orgId");
  const m = await access(orgId);
  if (!m) return { error: t("Cette page fait partie de l'option KolBase Business.") };
  const displayName = str(form, "displayName", MAX_NAME) || null;
  const raw = str(form, "color");
  const color = form.get("useColor") === "1" ? asBrandColor(raw) : null;
  if (form.get("useColor") === "1" && !color) return { error: t("Couleur invalide : choisissez une couleur (#rrggbb).") };
  if (color && contrastWithWhite(color) < MIN_CONTRAST) return { error: t("Cette couleur est trop claire : le texte blanc des boutons n'y serait pas lisible. Choisissez une teinte plus soutenue.") };
  const brand = await db.orgBrand.upsert({ where: { organizationId: orgId }, update: { displayName, color }, create: { organizationId: orgId, displayName, color } });
  forgetBrand(brand.domain);
  await audit(m.user.id, "brand.update", "Organization", orgId, { displayName, color });
  refresh(orgId);
  return { ok: t("Marque enregistrée.") };
}

/**
 * Nom de domaine demandé par l'organisation : enregistré « en attente », l'équipe KolBase est prévenue. Il n'est servi
 * à la marque qu'une fois rattaché au service chez l'hébergeur et activé depuis /admin.
 */
export async function requestBrandDomain(_: ActionState, form: FormData): Promise<ActionState> {
  const { t } = await getT();
  const orgId = str(form, "orgId");
  const m = await access(orgId);
  if (!m) return { error: t("Cette page fait partie de l'option KolBase Business.") };
  const parsed = asBrandDomain(str(form, "domain", 300), appHost());
  if ("refusal" in parsed) return { error: t(DOMAIN_REFUSAL[parsed.refusal]) };
  const taken = await db.orgBrand.findUnique({ where: { domain: parsed.domain }, select: { organizationId: true } });
  if (taken && taken.organizationId !== orgId) return { error: t("Ce nom de domaine est déjà utilisé par une autre organisation.") };
  // Un seul nom de domaine à la fois : l'ancien reste réservé tant que KolBase ne l'a pas détaché du service (une
  // adresse encore rattachée mais oubliée ici servirait KolBase sans les garde-fous des domaines d'organisation).
  const before = await db.orgBrand.findUnique({ where: { organizationId: orgId }, select: { domain: true, domainStatus: true } });
  if (before?.domain) return { error: before.domainStatus === "retire" ? t("Votre ancien nom de domaine est en cours de retrait par l'équipe KolBase : vous pourrez en demander un autre ensuite.") : t("Retirez d'abord votre nom de domaine actuel.") };
  const data = { domain: parsed.domain, domainStatus: "demande" as const, domainRequestedAt: new Date(), domainActivatedAt: null };
  await db.orgBrand.upsert({ where: { organizationId: orgId }, update: data, create: { organizationId: orgId, ...data } });
  forgetBrand(parsed.domain);
  await audit(m.user.id, "brand.domain_request", "Organization", orgId, { domain: parsed.domain });
  notifyPlatformAdmins(`Nom de domaine à rattacher : ${parsed.domain}`, `${m.org.name} demande le nom de domaine ${parsed.domain} (KolBase Business). Ajoutez-le au service web chez l'hébergeur, vérifiez son certificat, puis activez-le depuis Abonnements.`, "/admin/abonnements#domaines");
  refresh(orgId);
  return { ok: t("Demande enregistrée : créez l'enregistrement DNS ci-dessous, l'équipe KolBase active ensuite le domaine.") };
}

/**
 * Nom de domaine retiré par l'organisation : il cesse aussitôt d'afficher sa marque et n'ouvre plus de session. Il
 * reste réservé (« retiré ») jusqu'à ce que l'équipe KolBase, prévenue, l'ait détaché du service chez l'hébergeur.
 */
export async function removeBrandDomain(form: FormData) {
  const orgId = str(form, "orgId");
  // Sans l'option (retirée entre-temps), un administrateur peut encore retirer son domaine.
  const admin = await requireMembership(orgId, ["ADMIN"]);
  const brand = await db.orgBrand.findUnique({ where: { organizationId: orgId }, select: { domain: true, domainStatus: true } });
  if (!brand?.domain || brand.domainStatus === "retire") return;
  await db.orgBrand.update({ where: { organizationId: orgId }, data: { domainStatus: "retire", domainActivatedAt: null } });
  await db.session.deleteMany({ where: { brandOrgId: orgId } });
  forgetBrand(brand.domain);
  await audit(admin.user.id, "brand.domain_remove", "Organization", orgId, { domain: brand.domain });
  notifyPlatformAdmins(`Nom de domaine à détacher : ${brand.domain}`, `${admin.org.name} a retiré le nom de domaine ${brand.domain} (KolBase Business). Détachez-le du service web chez l'hébergeur, puis libérez-le depuis Abonnements.`, "/admin/abonnements#domaines");
  refresh(orgId);
}

/**
 * Nom de domaine d'une organisation, côté administrateur KolBase : activé une fois rattaché au service chez
 * l'hébergeur et son certificat émis ; remis en attente ; ou libéré une fois détaché du service (l'adresse n'est alors
 * plus connue de KolBase). Les sessions ouvertes sur ce domaine sont fermées dès qu'il cesse d'être actif.
 */
export async function setBrandDomainStatus(form: FormData) {
  const admin = await requirePlatformAdmin();
  const orgId = str(form, "orgId");
  const brand = await db.orgBrand.findUnique({ where: { organizationId: orgId }, select: { domain: true, domainStatus: true } });
  if (!brand?.domain) return;
  const op = str(form, "op");
  if (op === "activate" && brand.domainStatus === "demande") await db.orgBrand.update({ where: { organizationId: orgId }, data: { domainStatus: "active", domainActivatedAt: new Date() } });
  else if (op === "suspend" && brand.domainStatus === "active") await db.orgBrand.update({ where: { organizationId: orgId }, data: { domainStatus: "demande", domainActivatedAt: null } });
  else if (op === "release" && brand.domainStatus !== "active") await db.orgBrand.update({ where: { organizationId: orgId }, data: { domain: null, domainStatus: null, domainRequestedAt: null, domainActivatedAt: null } });
  else return;
  if (op !== "activate") await db.session.deleteMany({ where: { brandOrgId: orgId } });
  forgetBrand(brand.domain);
  await audit(admin.id, `admin.brand_domain_${op}`, "Organization", orgId, { domain: brand.domain });
  refresh(orgId);
}
