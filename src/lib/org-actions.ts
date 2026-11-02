"use server";

import { createHash, randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit, requireUser } from "@/lib/auth";
import { invitableRoles, requireMembership, SIREN_REQUIRED, sirenFields } from "@/lib/orgs";
import { parseSiren, sirenKeyOk } from "@/lib/siren";
import type { FormState } from "@/lib/auth-actions";
import { OrgKind, type OrgRole } from "@/generated/prisma/enums";
import { eurToCents, str } from "@/lib/form";
import { notifyInvitation, notifyPlatformAdmins } from "@/lib/notifications";

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");
const INVITE_DAYS = 14;

export type InviteState = { error?: string; ok?: string; link?: string } | undefined;

export async function createOrganization(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const name = str(form, "name");
  const kind = str(form, "kind") as OrgKind;
  if (!name) return { error: "Indiquez le nom de l'organisation." };
  if (!Object.values(OrgKind).includes(kind)) return { error: "Type d'organisation invalide." };
  const sirenInput = str(form, "siren");
  const siren = sirenInput ? parseSiren(sirenInput) : null;
  if (!sirenInput && SIREN_REQUIRED.includes(kind)) return { error: "Indiquez le SIREN (ou le SIRET) de l'organisation : KolBase le vérifie avant d'ouvrir les sollicitations." };
  if (sirenInput && (!siren || !sirenKeyOk(siren))) return { error: "SIREN invalide : 9 chiffres (ou SIRET de 14 chiffres), vérifiez la saisie." };
  const check = siren ? await sirenFields(siren) : null;
  if (check?.lookup && !check.lookup.found) return { error: "Ce SIREN est introuvable dans le répertoire des entreprises." };
  if (check?.lookup?.found && check.lookup.active === false) return { error: `L'entreprise ${check.lookup.name} est fermée selon le répertoire des entreprises.` };
  const { lookup: _lookup, ...sirenData } = check ?? { lookup: null };
  const org = await db.organization.create({
    data: {
      name,
      kind,
      ...sirenData,
      sector: str(form, "sector") || null,
      headquarters: str(form, "headquarters") || null,
      contactEmail: str(form, "contactEmail") || null,
      members: { create: { userId: user.id, role: "ADMIN" } },
    },
  });
  await audit(user.id, "org.create", "Organization", org.id, { name, siren });
  notifyPlatformAdmins(`Organisation à valider : ${name}`, `${user.firstName} ${user.lastName} a créé l'organisation « ${name} »${siren ? ` (SIREN ${siren}${check?.legalName ? `, ${check.legalName}` : ""})` : " sans SIREN"}.`, "/admin");
  redirect(`/organisations/${org.id}`);
}

export async function updateOrganization(_: FormState, form: FormData): Promise<FormState> {
  const orgId = str(form, "orgId");
  const { user, org } = await requireMembership(orgId, ["ADMIN"], { allowSupplier: true });
  const name = str(form, "name");
  if (!name) return { error: "Le nom est obligatoire." };
  // Changer le nom d'une organisation validée relance la validation (usurpation d'un nom connu).
  const renamed = org.verification === "VERIFIED" && name !== org.name;
  await db.organization.update({
    where: { id: orgId },
    data: {
      name,
      ...(renamed ? { verification: "PENDING", verificationNote: `Nom modifié : « ${org.name} » → « ${name} »`, listed: false } : {}),
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
  const siren = parseSiren(str(form, "siren"));
  if (!siren || !sirenKeyOk(siren)) return { error: "SIREN invalide : 9 chiffres (ou SIRET de 14 chiffres), vérifiez la saisie." };
  const { lookup, ...data } = await sirenFields(siren);
  if (lookup && !lookup.found) return { error: "Ce SIREN est introuvable dans le répertoire des entreprises." };
  if (lookup?.found && lookup.active === false) return { error: `L'entreprise ${lookup.name} est fermée selon le répertoire des entreprises.` };
  // Un SIREN modifié sur une organisation validée repasse en validation.
  const resubmit = org.verification !== "VERIFIED" || org.siren !== siren;
  await db.organization.update({
    where: { id: orgId },
    data: { ...data, ...(resubmit ? { verification: "PENDING", verificationNote: null, ...(org.verification === "VERIFIED" ? { listed: false } : {}) } : {}) },
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
  const token = randomBytes(24).toString("base64url");
  const inv = await db.invitation.create({
    data: {
      organizationId: orgId,
      role,
      email: str(form, "email").toLowerCase() || null,
      tokenHash: sha256(token),
      invitedById: user.id,
      expiresAt: new Date(Date.now() + INVITE_DAYS * 864e5),
    },
  });
  await audit(user.id, "org.invite", "Invitation", inv.id, { role });
  revalidatePath(`/organisations/${orgId}`);
  revalidatePath(`/organisations/${orgId}/membres`);
  const link = `${process.env.APP_URL ?? ""}/invitation/${token}`;
  const email = str(form, "email").toLowerCase();
  if (email) notifyInvitation(email, org.name, `${user.firstName} ${user.lastName}`, link);
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
  // On ne retire pas le dernier administrateur.
  if (m.role === "ADMIN") {
    const admins = await db.membership.count({ where: { organizationId: orgId, role: "ADMIN" } });
    if (admins <= 1) return;
  }
  await db.membership.delete({ where: { id } });
  await audit(user.id, "org.member_remove", "Membership", id, { userId: m.userId, role: m.role });
  revalidatePath(`/organisations/${orgId}`);
  revalidatePath(`/organisations/${orgId}/membres`);
}

export async function acceptInvitation(form: FormData) {
  const user = await requireUser();
  const token = str(form, "token");
  const inv = await db.invitation.findUnique({ where: { tokenHash: sha256(token) } });
  if (!inv || inv.acceptedAt || inv.revokedAt || inv.expiresAt < new Date()) redirect(`/invitation/${token}`);
  await db.$transaction([
    db.membership.upsert({
      where: { userId_organizationId_role: { userId: user.id, organizationId: inv.organizationId, role: inv.role } },
      update: {},
      create: { userId: user.id, organizationId: inv.organizationId, role: inv.role },
    }),
    db.invitation.update({ where: { id: inv.id }, data: { acceptedAt: new Date(), acceptedById: user.id } }),
  ]);
  await audit(user.id, "org.invite_accept", "Invitation", inv.id);
  redirect(`/organisations/${inv.organizationId}`);
}

export async function updateExpertProfile(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  if (!user.practitioner) return { error: "Réservé aux praticiens." };
  const rateNum = eurToCents(str(form, "dayRate"));
  if (str(form, "dayRate") && rateNum === null) return { error: "Tarif journalier invalide." };
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
  return { ok: "Profil expert enregistré." };
}
