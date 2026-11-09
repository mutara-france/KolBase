"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit, requireUser } from "@/lib/auth";
import { isVerifiedOrg, notVerified, requireMembership } from "@/lib/orgs";
import { fetchOrcidWorks, normTitle, ORCID_RE, orcidOAuth } from "@/lib/orcid";
import { COMPANY_VIS_FIELDS, KOL_VIS_FIELDS, companyVisibility, kolVisibility } from "@/lib/visibility";
import { str } from "@/lib/form";
import { getT } from "@/lib/i18n/server";
import { PHOTO_MAX_BYTES, PHOTO_MIN_SIDE, processPortrait } from "@/lib/photos";

export type ActionState = { error?: string; ok?: string } | undefined;

export async function updateKolVisibility(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const { t } = await getT();
  if (!user.practitioner) return { error: t("Réservé aux praticiens.") };
  const raw: Record<string, string> = { projets: str(form, "projets") };
  for (const f of KOL_VIS_FIELDS) raw[f.key] = str(form, f.key);
  const visibility = kolVisibility(raw);
  await db.practitionerProfile.update({ where: { id: user.practitioner.id }, data: { visibility } });
  await audit(user.id, "practitioner.visibility", "PractitionerProfile", user.practitioner.id, visibility);
  revalidatePath("/compte");
  return { ok: t("Visibilité enregistrée.") };
}

export async function updateOrgVisibility(_: ActionState, form: FormData): Promise<ActionState> {
  const { t } = await getT();
  const orgId = str(form, "orgId");
  const { user, org } = await requireMembership(orgId, ["ADMIN"]);
  if (form.get("listed") === "1" && !isVerifiedOrg(org)) return { error: t("Page publique indisponible pour l'instant : {reason}", { reason: t(notVerified(org)) }) };
  const raw: Record<string, string> = {};
  for (const f of COMPANY_VIS_FIELDS) raw[f.key] = str(form, f.key);
  const visibility = companyVisibility(raw);
  await db.organization.update({ where: { id: orgId }, data: { visibility, listed: form.get("listed") === "1" } });
  await audit(user.id, "org.visibility", "Organization", orgId, visibility);
  revalidatePath(`/organisations/${orgId}`);
  revalidatePath(`/organisations/${orgId}/membres`);
  return { ok: t("Visibilité de la page publique enregistrée.") };
}

export async function addPublication(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const { t } = await getT();
  if (!user.practitioner) return { error: t("Réservé aux praticiens.") };
  const title = str(form, "title");
  if (!title) return { error: t("Le titre est obligatoire.") };
  const yearNum = Number(str(form, "year"));
  const year = Number.isInteger(yearNum) && yearNum >= 1900 && yearNum <= new Date().getFullYear() + 1 ? yearNum : null;
  if (year && (year < 1950 || year > new Date().getFullYear() + 1)) return { error: t("Année invalide.") };
  await db.publication.create({
    data: {
      practitionerId: user.practitioner.id, title, journal: str(form, "journal") || null, year, doi: str(form, "doi") || null,
      keywords: str(form, "keywords").split(",").map((k) => k.trim()).filter(Boolean),
    },
  });
  revalidatePath("/compte");
  return { ok: t("Publication ajoutée.") };
}

/** Importe les publications du profil ORCID public (sans doublon : DOI ou titre identique). */
export async function importOrcid(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const p = user.practitioner;
  const { t } = await getT();
  if (!p) return { error: t("Réservé aux praticiens.") };
  // Avec la connexion ORCID activée, seul l'iD prouvé par le praticien peut être importé.
  if (orcidOAuth() && !p.orcidVerified) return { error: t("Connectez d'abord votre compte ORCID : l'import ne porte que sur votre propre iD.") };
  const orcid = (orcidOAuth() ? p.orcid ?? "" : str(form, "orcid") || p.orcid || "").toUpperCase().replace(/^HTTPS?:\/\/ORCID\.ORG\//i, "");
  if (!ORCID_RE.test(orcid)) return { error: t("Identifiant ORCID invalide (format 0000-0000-0000-0000).") };
  let works: Awaited<ReturnType<typeof fetchOrcidWorks>>;
  try {
    works = await fetchOrcidWorks(orcid);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "ORCID indisponible.";
    const status = /^ORCID indisponible \((\d+)\)\.$/.exec(msg)?.[1];
    return { error: status ? t("ORCID indisponible ({status}).", { status }) : t(msg) };
  }
  const existing = await db.publication.findMany({ where: { practitionerId: p.id }, select: { title: true, doi: true } });
  const dois = new Set(existing.map((x) => x.doi?.toLowerCase()).filter(Boolean));
  const titles = new Set(existing.map((x) => normTitle(x.title)));
  const fresh = works.filter((w) => !(w.doi && dois.has(w.doi.toLowerCase())) && !titles.has(normTitle(w.title)));
  if (fresh.length) {
    await db.publication.createMany({ data: fresh.map((w) => ({ practitionerId: p.id, title: w.title, journal: w.journal, year: w.year, doi: w.doi, keywords: [], source: "orcid" })) });
  }
  await db.practitionerProfile.update({ where: { id: p.id }, data: { orcid, orcidSyncedAt: new Date(), ...(orcid !== p.orcid ? { orcidVerified: false } : {}) } });
  await audit(user.id, "orcid.import", "PractitionerProfile", p.id, { found: works.length, imported: fresh.length });
  revalidatePath("/compte");
  const dup = works.length - fresh.length;
  const imported = fresh.length > 1 ? t("{n} publications importées", { n: fresh.length }) : t("{n} publication importée", { n: fresh.length });
  const already = dup > 1 ? t("{n} déjà présentes", { n: dup }) : t("{n} déjà présente", { n: dup });
  return { ok: works.length === 0 ? t("Aucune publication publique sur ce profil ORCID.") : `${imported} (${already}).` };
}

export async function removePublication(form: FormData) {
  const user = await requireUser();
  if (!user.practitioner) return;
  await db.publication.deleteMany({ where: { id: str(form, "id"), practitionerId: user.practitioner.id } });
  revalidatePath("/compte");
}

export async function addStructure(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const { t } = await getT();
  if (!user.practitioner) return { error: t("Réservé aux praticiens.") };
  const name = str(form, "name");
  const legalForm = str(form, "legalForm");
  if (!name || !legalForm) return { error: t("Nom et forme juridique sont obligatoires.") };
  const siren = str(form, "siren").replace(/\s/g, "");
  if (siren && !/^\d{9}$/.test(siren)) return { error: t("Le SIREN comporte 9 chiffres.") };
  const share = str(form, "sharePercent") ? Math.min(100, Math.max(0, Math.round(Number(str(form, "sharePercent"))))) : null;
  // Coordonnées de facturation et choix par défaut : Mes revenus › Notes d'honoraires.
  const s = await db.practitionerStructure.create({
    data: { practitionerId: user.practitioner.id, name, legalForm, siren: siren || null, role: str(form, "role") || null, sharePercent: share },
  });
  await audit(user.id, "practitioner.structure_add", "PractitionerStructure", s.id);
  revalidatePath("/compte");
  return { ok: t("Structure ajoutée.") };
}

export async function removeStructure(form: FormData) {
  const user = await requireUser();
  if (!user.practitioner) return;
  // Structure choisie pour une convention pas encore facturée : gardée (la convention et sa note la reprennent).
  await db.practitionerStructure.deleteMany({ where: { id: str(form, "id"), practitionerId: user.practitioner.id, billedLinks: { none: { status: { not: "DECLINE" }, feeNote: { is: null } } } } });
  revalidatePath("/compte");
  revalidatePath("/revenus");
}

// ─── Photo du praticien ────────────────────────────────────────────────────

const refreshPhoto = (practitionerId: string) => {
  revalidatePath("/", "layout");
  revalidatePath("/compte");
  revalidatePath(`/experts/${practitionerId}`);
  revalidatePath("/experts");
  revalidatePath("/");
};

/**
 * Photo du praticien : JPEG, PNG ou WebP vérifié sur son contenu, recadrée et réencodée par KolBase (aucune
 * métadonnée conservée). Visible selon le réglage « Photo » de la visibilité du profil.
 */
export async function updateExpertPhoto(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const { t } = await getT();
  const p = user.practitioner;
  if (!p) return { error: t("Réservé aux praticiens.") };
  const file = form.get("photo");
  if (!(file instanceof File) || file.size === 0) return { error: t("Choisissez une photo.") };
  if (file.size > PHOTO_MAX_BYTES) return { error: t("Photo trop lourde : 10 Mo au maximum.") };
  const result = await processPortrait(new Uint8Array(await file.arrayBuffer()));
  if ("error" in result) return { error: t(result.error, { min: PHOTO_MIN_SIDE }) };
  const now = new Date();
  const data = new Uint8Array(result.data);
  const thumb = new Uint8Array(result.thumb);
  await db.$transaction([
    db.practitionerPhoto.upsert({ where: { practitionerId: p.id }, update: { data, thumb }, create: { practitionerId: p.id, data, thumb } }),
    db.practitionerProfile.update({ where: { id: p.id }, data: { photoUpdatedAt: now } }),
  ]);
  await audit(user.id, "practitioner.photo", "PractitionerProfile", p.id, { size: data.byteLength });
  refreshPhoto(p.id);
  return { ok: t("Photo enregistrée.") };
}

export async function removeExpertPhoto() {
  const user = await requireUser();
  const p = user.practitioner;
  if (!p) return;
  await db.$transaction([
    db.practitionerPhoto.deleteMany({ where: { practitionerId: p.id } }),
    db.practitionerProfile.update({ where: { id: p.id }, data: { photoUpdatedAt: null, photoConsentAt: null } }),
  ]);
  await audit(user.id, "practitioner.photo_remove", "PractitionerProfile", p.id);
  refreshPhoto(p.id);
}

/**
 * Photo d'un compte sans profil praticien (membre d'organisation) : même contrôle et même traitement que celle d'un
 * praticien ; visible de la personne, des membres de ses organisations et de l'équipe KolBase.
 */
export async function updateUserPhoto(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const { t } = await getT();
  if (user.practitioner) return updateExpertPhoto(_, form);
  const file = form.get("photo");
  if (!(file instanceof File) || file.size === 0) return { error: t("Choisissez une photo.") };
  if (file.size > PHOTO_MAX_BYTES) return { error: t("Photo trop lourde : 10 Mo au maximum.") };
  const result = await processPortrait(new Uint8Array(await file.arrayBuffer()));
  if ("error" in result) return { error: t(result.error, { min: PHOTO_MIN_SIDE }) };
  const data = new Uint8Array(result.data);
  const thumb = new Uint8Array(result.thumb);
  await db.$transaction([
    db.userPhoto.upsert({ where: { userId: user.id }, update: { data, thumb }, create: { userId: user.id, data, thumb } }),
    db.user.update({ where: { id: user.id }, data: { photoUpdatedAt: new Date() } }),
  ]);
  await audit(user.id, "user.photo", "User", user.id, { size: data.byteLength });
  revalidatePath("/", "layout");
  return { ok: t("Photo enregistrée.") };
}

export async function removeUserPhoto() {
  const user = await requireUser();
  if (user.practitioner) return removeExpertPhoto();
  await db.$transaction([db.userPhoto.deleteMany({ where: { userId: user.id } }), db.user.update({ where: { id: user.id }, data: { photoUpdatedAt: null } })]);
  await audit(user.id, "user.photo_remove", "User", user.id);
  revalidatePath("/", "layout");
}

/** Accord pour l'usage de la photo dans la communication des interventions (révocable à tout moment). */
export async function setPhotoConsent(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const { t } = await getT();
  const p = user.practitioner;
  if (!p) return { error: t("Réservé aux praticiens.") };
  const consent = form.get("consent") === "1";
  if (consent && !p.photoUpdatedAt) return { error: t("Ajoutez d'abord une photo.") };
  await db.practitionerProfile.update({ where: { id: p.id }, data: { photoConsentAt: consent ? (p.photoConsentAt ?? new Date()) : null } });
  await audit(user.id, consent ? "practitioner.photo_consent" : "practitioner.photo_consent_withdrawn", "PractitionerProfile", p.id);
  revalidatePath("/compte");
  return { ok: t(consent ? "Accord enregistré." : "Accord retiré : votre photo ne sera plus proposée pour la communication de vos interventions.") };
}
