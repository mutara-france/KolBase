"use server";

import { createHash, randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit, requireUser } from "@/lib/auth";
import { invitableRoles, isVerifiedOrg, requireMembership, roleLabel, SIREN_REQUIRED, sirenFields } from "@/lib/orgs";
import { blockedFor, hit } from "@/lib/rate-limit";
import { LOGO_MAX_BYTES, sniffLogo } from "@/lib/logos";
import { parseRna, parseSiren, sirenKeyOk } from "@/lib/siren";
import { rnaAccepted } from "@/lib/org-roles";
import type { FormState } from "@/lib/auth-actions";
import { OrgKind, type OrgRole } from "@/generated/prisma/enums";
import { eurToCents, MAX_NAME, str } from "@/lib/form";
import { notifyInvitation, notifyPlatformAdmins } from "@/lib/notifications";
import { getT } from "@/lib/i18n/server";
import { DPA_VERSION } from "@/lib/dpa";

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");
const INVITE_DAYS = 14;

export type InviteState = { error?: string; ok?: string; link?: string } | undefined;

export async function createOrganization(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  // Création traduite (comme la page /organisations/nouvelle).
  const { t } = await getT();
  const name = str(form, "name", MAX_NAME);
  const kind = str(form, "kind") as OrgKind;
  if (!name) return { error: t("Indiquez le nom de l'organisation.") };
  if (!Object.values(OrgKind).includes(kind)) return { error: t("Type d'organisation invalide.") };
  const sirenInput = str(form, "siren");
  // Société savante ou association : SIREN facultatif, numéro RNA accepté à la place.
  const rna = sirenInput && rnaAccepted(kind) ? parseRna(sirenInput) : null;
  const siren = sirenInput && !rna ? parseSiren(sirenInput) : null;
  if (!sirenInput && SIREN_REQUIRED.includes(kind)) return { error: t("Indiquez le SIREN (ou le SIRET) de l'organisation : KolBase le vérifie avant d'ouvrir les sollicitations.") };
  if (sirenInput && !rna && (!siren || !sirenKeyOk(siren)))
    return { error: rnaAccepted(kind) ? t("Identifiant invalide : SIREN (9 chiffres), SIRET (14 chiffres) ou numéro RNA (W suivi de 9 chiffres), vérifiez la saisie.") : t("SIREN invalide : 9 chiffres (ou SIRET de 14 chiffres), vérifiez la saisie.") };
  const check = siren ? await sirenFields(siren) : null;
  if (check?.lookup && !check.lookup.found) return { error: t("Ce SIREN est introuvable dans le répertoire des entreprises.") };
  if (check?.lookup?.found && check.lookup.active === false) return { error: t("L'entreprise {name} est fermée selon le répertoire des entreprises.", { name: check.lookup.name }) };
  const { lookup: _lookup, ...sirenData } = check ?? { lookup: null };
  const org = await db.organization.create({
    data: {
      name,
      kind,
      ...sirenData,
      rna,
      verificationRequestedAt: new Date(),
      sector: str(form, "sector") || null,
      headquarters: str(form, "headquarters") || null,
      contactEmail: str(form, "contactEmail") || null,
      members: { create: { userId: user.id, role: "ADMIN" } },
    },
  });
  await audit(user.id, "org.create", "Organization", org.id, { name, siren });
  notifyPlatformAdmins(`Organisation à valider : ${name}`, `${user.firstName} ${user.lastName} a créé l'organisation « ${name} »${siren ? ` (SIREN ${siren}${check?.legalName ? `, ${check.legalName}` : ""})` : rna ? ` (RNA ${rna})` : " sans SIREN"}.`, "/admin");
  redirect(`/organisations/${org.id}`);
}

export async function updateOrganization(_: FormState, form: FormData): Promise<FormState> {
  const orgId = str(form, "orgId");
  const { user, org } = await requireMembership(orgId, ["ADMIN"], { allowSupplier: true });
  const name = str(form, "name", MAX_NAME);
  if (!name) return { error: "Le nom est obligatoire." };
  // Suspendue : le nom reste celui que KolBase a validé (il ne repasserait pas par la validation).
  if (org.verification === "SUSPENDED" && name !== org.name) return { error: "Organisation suspendue : le nom ne peut pas être modifié avant la réactivation par KolBase." };
  // Changer le nom d'une organisation validée relance la validation (usurpation d'un nom connu).
  const renamed = org.verification === "VERIFIED" && name !== org.name;
  await db.organization.update({
    where: { id: orgId },
    data: {
      name,
      ...(renamed ? { verification: "PENDING", verificationNote: `Nom modifié : « ${org.name} » → « ${name} »`, listed: false, verificationRequestedAt: new Date() } : {}),
      sector: str(form, "sector") || null,
      headquarters: str(form, "headquarters") || null,
      contactEmail: str(form, "contactEmail") || null,
      about: str(form, "about") || null,
      policy: str(form, "policy") || null,
      areas: str(form, "areas").split(",").map((a) => a.trim()).filter(Boolean),
    },
  });
  await audit(user.id, "org.update", "Organization", orgId, renamed ? { renamed: { from: org.name, to: name } } : undefined);
  if (renamed) notifyPlatformAdmins(`Organisation renommée, à valider : ${name}`, `« ${org.name} » s'appelle désormais « ${name} » et doit être validée à nouveau.`, "/admin");
  revalidatePath(`/organisations/${orgId}`);
  revalidatePath(`/organisations/${orgId}/membres`);
  return { ok: renamed ? "Organisation mise à jour. Le nom ayant changé, KolBase doit la valider à nouveau." : "Organisation mise à jour." };
}

/** SIREN de l'organisation : contrôlé auprès du répertoire, puis soumis à la validation de KolBase. */
export async function submitSiren(_: FormState, form: FormData): Promise<FormState> {
  const orgId = str(form, "orgId");
  const { user, org } = await requireMembership(orgId, ["ADMIN"], { allowSupplier: true });
  // Une suspension se lève par KolBase, pas par une nouvelle demande de validation.
  if (org.verification === "SUSPENDED") return { error: "Organisation suspendue : la réactivation se fait par l'équipe KolBase, répondez à l'e-mail de suspension." };
  // Association ou société savante : un numéro RNA tient lieu de SIREN.
  const rna = rnaAccepted(org.kind) ? parseRna(str(form, "siren")) : null;
  if (rna) {
    const resubmitRna = org.verification !== "VERIFIED" || org.rna !== rna;
    await db.organization.update({
      where: { id: orgId },
      data: { rna, ...(resubmitRna ? { verification: "PENDING", verificationNote: null, verificationRequestedAt: new Date(), ...(org.verification === "VERIFIED" ? { listed: false } : {}) } : {}) },
    });
    await audit(user.id, "org.rna", "Organization", orgId, { rna });
    if (resubmitRna) notifyPlatformAdmins(`Organisation à valider : ${org.name}`, `${org.name} a renseigné le numéro RNA ${rna}.`, "/admin");
    revalidatePath(`/organisations/${orgId}`);
    revalidatePath(`/organisations/${orgId}/membres`);
    return { ok: "Numéro RNA enregistré. Un administrateur KolBase va valider votre organisation." };
  }
  const siren = parseSiren(str(form, "siren"));
  if (!siren || !sirenKeyOk(siren))
    return { error: rnaAccepted(org.kind) ? "Identifiant invalide : SIREN (9 chiffres), SIRET (14 chiffres) ou numéro RNA (W suivi de 9 chiffres), vérifiez la saisie." : "SIREN invalide : 9 chiffres (ou SIRET de 14 chiffres), vérifiez la saisie." };
  const { lookup, ...data } = await sirenFields(siren);
  if (lookup && !lookup.found) return { error: "Ce SIREN est introuvable dans le répertoire des entreprises." };
  if (lookup?.found && lookup.active === false) return { error: `L'entreprise ${lookup.name} est fermée selon le répertoire des entreprises.` };
  // Un SIREN modifié sur une organisation validée repasse en validation.
  const resubmit = org.verification !== "VERIFIED" || org.siren !== siren;
  await db.organization.update({
    where: { id: orgId },
    data: { ...data, ...(resubmit ? { verification: "PENDING", verificationNote: null, verificationRequestedAt: new Date(), ...(org.verification === "VERIFIED" ? { listed: false } : {}) } : {}) },
  });
  await audit(user.id, "org.siren", "Organization", orgId, { siren, found: lookup?.found ?? null });
  if (resubmit) notifyPlatformAdmins(`Organisation à valider : ${org.name}`, `${org.name} a renseigné le SIREN ${siren}${lookup?.found ? ` (${lookup.name})` : ""}.`, "/admin");
  revalidatePath(`/organisations/${orgId}`);
  revalidatePath(`/organisations/${orgId}/membres`);
  return { ok: lookup?.found ? `SIREN reconnu : ${lookup.name}. Un administrateur KolBase va valider votre organisation.` : "SIREN enregistré (répertoire indisponible pour le moment). KolBase le vérifiera lors de la validation." };
}

export async function createInvitation(_: InviteState, form: FormData): Promise<InviteState> {
  const orgId = str(form, "orgId");
  const { user, org } = await requireMembership(orgId, ["ADMIN"], { allowSupplier: true });
  const role = str(form, "role") as OrgRole;
  if (!invitableRoles(org.kind).includes(role)) return { error: "Rôle invalide." };
  const email = str(form, "email", 254).toLowerCase();
  // KolBase n'envoie d'e-mail d'invitation qu'au nom d'une organisation validée, et pas en rafale.
  if (email && !isVerifiedOrg(org)) return { error: "L'envoi d'invitations par e-mail est possible une fois l'organisation validée par KolBase. Générez le lien sans e-mail et transmettez-le vous-même." };
  const rateKey = `invite:${user.id}`;
  if (email && blockedFor(rateKey, 30, 60 * 60 * 1000)) return { error: "Trop d'invitations envoyées en peu de temps : réessayez dans une heure." };
  if (email) hit(rateKey);
  const token = randomBytes(24).toString("base64url");
  const inv = await db.invitation.create({
    data: {
      organizationId: orgId,
      role,
      email: email || null,
      tokenHash: sha256(token),
      invitedById: user.id,
      expiresAt: new Date(Date.now() + INVITE_DAYS * 864e5),
    },
  });
  await audit(user.id, "org.invite", "Invitation", inv.id, { role });
  revalidatePath(`/organisations/${orgId}`);
  revalidatePath(`/organisations/${orgId}/membres`);
  const link = `${process.env.APP_URL ?? ""}/invitation/${token}`;
  if (email) notifyInvitation(email, org.name, `${user.firstName} ${user.lastName}`, link, roleLabel(role, org.kind));
  return {
    ok: `${email ? `Invitation envoyée à ${email}. ` : ""}Lien valable ${INVITE_DAYS} jours, à usage unique. Copiez-le maintenant : il ne sera plus affiché.`,
    link,
  };
}

export async function revokeInvitation(form: FormData) {
  const orgId = str(form, "orgId");
  const { user } = await requireMembership(orgId, ["ADMIN"], { allowSupplier: true });
  const id = str(form, "invitationId");
  const { count } = await db.invitation.updateMany({ where: { id, organizationId: orgId, acceptedAt: null }, data: { revokedAt: new Date() } });
  if (!count) return;
  await audit(user.id, "org.invite_revoke", "Invitation", id);
  revalidatePath(`/organisations/${orgId}`);
  revalidatePath(`/organisations/${orgId}/membres`);
}

export async function removeMembership(form: FormData) {
  const orgId = str(form, "orgId");
  const { user } = await requireMembership(orgId, ["ADMIN"], { allowSupplier: true });
  const id = str(form, "membershipId");
  const m = await db.membership.findFirst({ where: { id, organizationId: orgId } });
  if (!m) return;
  // On ne retire pas le dernier administrateur, même si deux retraits arrivent en même temps (verrou sur l'organisation).
  const removed = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "Organization" WHERE id = ${orgId} FOR UPDATE`;
    if (m.role === "ADMIN" && (await tx.membership.count({ where: { organizationId: orgId, role: "ADMIN" } })) <= 1) return false;
    return (await tx.membership.deleteMany({ where: { id } })).count === 1;
  });
  if (!removed) return;
  await audit(user.id, "org.member_remove", "Membership", id, { userId: m.userId, role: m.role });
  revalidatePath(`/organisations/${orgId}`);
  revalidatePath(`/organisations/${orgId}/membres`);
}

export async function acceptInvitation(form: FormData) {
  const user = await requireUser();
  const token = str(form, "token");
  const inv = await db.invitation.findUnique({ where: { tokenHash: sha256(token) } });
  if (!inv || inv.acceptedAt || inv.revokedAt || inv.expiresAt < new Date()) redirect(`/invitation/${token}`);
  // Invitation nominative : réservée au compte de l'adresse invitée. Le lien, reçu à cette adresse, prouve l'accès à la
  // boîte : l'accepter confirme l'adresse du compte.
  if (inv.email && inv.email.toLowerCase() !== user.email.toLowerCase()) redirect(`/invitation/${token}`);
  // Usage unique garanti même en cas d'acceptations simultanées : seule la première « consomme » le jeton.
  const accepted = await db.$transaction(async (tx) => {
    const { count } = await tx.invitation.updateMany({
      where: { id: inv.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      data: { acceptedAt: new Date(), acceptedById: user.id },
    });
    if (count === 0) return false;
    await tx.membership.upsert({
      where: { userId_organizationId_role: { userId: user.id, organizationId: inv.organizationId, role: inv.role } },
      update: {},
      create: { userId: user.id, organizationId: inv.organizationId, role: inv.role },
    });
    return true;
  });
  if (!accepted) redirect(`/invitation/${token}`);
  await audit(user.id, "org.invite_accept", "Invitation", inv.id);
  if (inv.email && !user.emailVerifiedAt) {
    await db.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
    await audit(user.id, "user.email_verified", "User", user.id, { source: "invitation" });
  }
  redirect(`/organisations/${inv.organizationId}`);
}

export async function updateExpertProfile(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const { t } = await getT();
  if (!user.practitioner) return { error: t("Réservé aux praticiens.") };
  const rateNum = eurToCents(str(form, "dayRate"));
  if (str(form, "dayRate") && rateNum === null) return { error: t("Tarif journalier invalide.") };
  await db.practitionerProfile.update({
    where: { userId: user.id },
    data: {
      bio: str(form, "bio") || null,
      hospital: str(form, "hospital") || null,
      subspecialty: str(form, "subspecialty") || null,
      orcid: str(form, "orcid") || null,
      // Un iD saisi à la main n'est plus celui prouvé par la connexion ORCID.
      ...((str(form, "orcid") || null) !== user.practitioner.orcid ? { orcidVerified: false } : {}),
      languages: str(form, "languages").split(",").map((l) => l.trim()).filter(Boolean),
      interventionTypes: form.getAll("interventionTypes").map(String),
      dayRateCents: rateNum,
    },
  });
  await audit(user.id, "practitioner.update_expert", "PractitionerProfile", user.practitioner.id);
  revalidatePath("/compte");
  return { ok: t("Profil expert enregistré.") };
}

/** Logo de l'organisation : PNG, JPEG ou WebP vérifié sur son contenu, 500 Ko au plus. */
export async function updateOrgLogo(_: FormState, form: FormData): Promise<FormState> {
  const orgId = str(form, "orgId");
  const { user, org } = await requireMembership(orgId, ["ADMIN"], { allowSupplier: true });
  const file = form.get("logo");
  if (!(file instanceof File) || file.size === 0) return { error: "Choisissez une image." };
  if (file.size > LOGO_MAX_BYTES) return { error: "Image trop lourde : 500 Ko au maximum." };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffLogo(bytes);
  if (!type) return { error: "Format non reconnu : PNG, JPEG ou WebP uniquement." };
  const now = new Date();
  await db.$transaction([
    db.organizationLogo.upsert({ where: { organizationId: orgId }, update: { data: bytes, contentType: type }, create: { organizationId: orgId, data: bytes, contentType: type } }),
    db.organization.update({ where: { id: orgId }, data: { logoUpdatedAt: now } }),
  ]);
  await audit(user.id, "org.logo", "Organization", orgId, { type, size: bytes.byteLength });
  // Un logo est une marque : l'équipe KolBase est prévenue pour pouvoir contrôler son usage.
  if (org.verification === "VERIFIED") notifyPlatformAdmins(`Logo modifié : ${org.name}`, `${org.name} a publié un nouveau logo, visible sur le site public.`, "/admin");
  revalidatePath(`/organisations/${orgId}/membres`);
  revalidatePath(`/structures/${orgId}`);
  return { ok: org.verification === "VERIFIED" ? "Logo enregistré." : "Logo enregistré. Il sera visible publiquement une fois l'organisation validée par KolBase." };
}

export async function removeOrgLogo(form: FormData) {
  const orgId = str(form, "orgId");
  const { user } = await requireMembership(orgId, ["ADMIN"], { allowSupplier: true });
  await db.$transaction([
    db.organizationLogo.deleteMany({ where: { organizationId: orgId } }),
    db.organization.update({ where: { id: orgId }, data: { logoUpdatedAt: null } }),
  ]);
  await audit(user.id, "org.logo_remove", "Organization", orgId);
  revalidatePath(`/organisations/${orgId}/membres`);
  revalidatePath(`/structures/${orgId}`);
}

/**
 * Rôles d'un membre, cochés par un administrateur. Aucun rôle : la personne quitte l'organisation.
 * Garde-fous : il reste toujours un administrateur ; une agence mandatée n'a pas de rôle interne.
 */
export async function setMemberRoles(_: FormState, form: FormData): Promise<FormState> {
  const orgId = str(form, "orgId");
  const { user, org } = await requireMembership(orgId, ["ADMIN"], { allowSupplier: true });
  const memberId = str(form, "userId");
  const allowed = invitableRoles(org.kind);
  const wanted = form.get("remove") === "1" ? [] : [...new Set(form.getAll("role").map(String))].filter((r): r is OrgRole => allowed.includes(r as OrgRole));
  // Décocher tous les rôles ne retire pas la personne : le retrait passe par le bouton dédié.
  if (wanted.length === 0 && form.get("remove") !== "1") return { error: "Gardez au moins un rôle, ou retirez la personne de l'organisation." };
  const current = await db.membership.findMany({ where: { organizationId: orgId, userId: memberId }, select: { role: true } });
  if (current.length === 0) return { error: "Membre introuvable." };
  const before = current.map((m) => m.role).sort();
  const result = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "Organization" WHERE id = ${orgId} FOR UPDATE`;
    if (!wanted.includes("ADMIN") && before.includes("ADMIN")) {
      const otherAdmins = await tx.membership.count({ where: { organizationId: orgId, role: "ADMIN", userId: { not: memberId } } });
      if (otherAdmins === 0) return "last-admin" as const;
    }
    await tx.membership.deleteMany({ where: { organizationId: orgId, userId: memberId, role: { notIn: wanted } } });
    for (const role of wanted)
      await tx.membership.upsert({ where: { userId_organizationId_role: { userId: memberId, organizationId: orgId, role } }, update: {}, create: { userId: memberId, organizationId: orgId, role } });
    return "ok" as const;
  });
  if (result === "last-admin") return { error: "L'organisation doit garder au moins un administrateur." };
  await audit(user.id, wanted.length ? "org.member_roles" : "org.member_remove", "Organization", orgId, { userId: memberId, from: before, to: wanted });
  revalidatePath(`/organisations/${orgId}`);
  revalidatePath(`/organisations/${orgId}/membres`);
  return { ok: wanted.length ? "Rôles enregistrés." : "Membre retiré de l'organisation." };
}

/** Contrat de sous-traitance (RGPD) accepté au nom de l'organisation, dans sa version en vigueur. */
export async function acceptDpa(form: FormData) {
  const orgId = str(form, "orgId");
  const { user, isAdmin } = await requireMembership(orgId);
  if (!isAdmin) return;
  await db.organization.update({ where: { id: orgId }, data: { dpaVersion: DPA_VERSION, dpaAcceptedAt: new Date(), dpaAcceptedById: user.id } });
  await audit(user.id, "org.dpa_accept", "Organization", orgId, { version: DPA_VERSION });
  revalidatePath(`/organisations/${orgId}/membres`);
  revalidatePath(`/organisations/${orgId}`);
}
