"use server";

import { createHash, randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit, requireUser } from "@/lib/auth";
import { requireMembership } from "@/lib/orgs";
import type { FormState } from "@/lib/auth-actions";
import { OrgKind, OrgRole } from "@/generated/prisma/enums";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");
const INVITE_DAYS = 14;

export type InviteState = { error?: string; ok?: string; link?: string } | undefined;

export async function createOrganization(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const name = str(form, "name");
  const kind = str(form, "kind") as OrgKind;
  if (!name) return { error: "Indiquez le nom de l'organisation." };
  if (!Object.values(OrgKind).includes(kind)) return { error: "Type d'organisation invalide." };
  const org = await db.organization.create({
    data: {
      name,
      kind,
      sector: str(form, "sector") || null,
      headquarters: str(form, "headquarters") || null,
      contactEmail: str(form, "contactEmail") || null,
      members: { create: { userId: user.id, role: "ADMIN" } },
    },
  });
  await audit(user.id, "org.create", "Organization", org.id, { name });
  redirect(`/organisations/${org.id}`);
}

export async function updateOrganization(_: FormState, form: FormData): Promise<FormState> {
  const orgId = str(form, "orgId");
  const { user } = await requireMembership(orgId, ["ADMIN"]);
  const name = str(form, "name");
  if (!name) return { error: "Le nom est obligatoire." };
  await db.organization.update({
    where: { id: orgId },
    data: {
      name,
      sector: str(form, "sector") || null,
      headquarters: str(form, "headquarters") || null,
      contactEmail: str(form, "contactEmail") || null,
      about: str(form, "about") || null,
      policy: str(form, "policy") || null,
      areas: str(form, "areas").split(",").map((a) => a.trim()).filter(Boolean),
    },
  });
  await audit(user.id, "org.update", "Organization", orgId);
  revalidatePath(`/organisations/${orgId}`);
  revalidatePath(`/organisations/${orgId}/membres`);
  return { ok: "Organisation mise à jour." };
}

export async function createInvitation(_: InviteState, form: FormData): Promise<InviteState> {
  const orgId = str(form, "orgId");
  const { user } = await requireMembership(orgId, ["ADMIN"]);
  const role = str(form, "role") as OrgRole;
  if (!Object.values(OrgRole).includes(role)) return { error: "Rôle invalide." };
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
  const base = process.env.APP_URL ?? "";
  return { ok: `Lien valable ${INVITE_DAYS} jours, à usage unique. Copiez-le maintenant : il ne sera plus affiché.`, link: `${base}/invitation/${token}` };
}

export async function revokeInvitation(form: FormData) {
  const orgId = str(form, "orgId");
  const { user } = await requireMembership(orgId, ["ADMIN"]);
  const id = str(form, "invitationId");
  await db.invitation.updateMany({ where: { id, organizationId: orgId, acceptedAt: null }, data: { revokedAt: new Date() } });
  await audit(user.id, "org.invite_revoke", "Invitation", id);
  revalidatePath(`/organisations/${orgId}`);
  revalidatePath(`/organisations/${orgId}/membres`);
}

export async function removeMembership(form: FormData) {
  const orgId = str(form, "orgId");
  const { user } = await requireMembership(orgId, ["ADMIN"]);
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
  const rate = str(form, "dayRate").replace(",", ".");
  const rateNum = rate ? Math.round(Number(rate) * 100) : null;
  if (rateNum !== null && (!Number.isFinite(rateNum) || rateNum < 0)) return { error: "Tarif journalier invalide." };
  await db.practitionerProfile.update({
    where: { userId: user.id },
    data: {
      bio: str(form, "bio") || null,
      hospital: str(form, "hospital") || null,
      subspecialty: str(form, "subspecialty") || null,
      orcid: str(form, "orcid") || null,
      languages: str(form, "languages").split(",").map((l) => l.trim()).filter(Boolean),
      interventionTypes: form.getAll("interventionTypes").map(String),
      dayRateCents: rateNum,
    },
  });
  await audit(user.id, "practitioner.update_expert", "PractitionerProfile", user.practitioner.id);
  revalidatePath("/compte");
  return { ok: "Profil expert enregistré." };
}
