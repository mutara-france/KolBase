"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit, requireUser } from "@/lib/auth";
import { requireMembership } from "@/lib/orgs";
import { COMPANY_VIS_FIELDS, KOL_VIS_FIELDS, companyVisibility, kolVisibility } from "@/lib/visibility";

export type ActionState = { error?: string; ok?: string } | undefined;
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

export async function updateKolVisibility(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  if (!user.practitioner) return { error: "Réservé aux praticiens." };
  const raw: Record<string, string> = { projets: str(form, "projets") };
  for (const f of KOL_VIS_FIELDS) raw[f.key] = str(form, f.key);
  const visibility = kolVisibility(raw);
  await db.practitionerProfile.update({ where: { id: user.practitioner.id }, data: { visibility } });
  await audit(user.id, "practitioner.visibility", "PractitionerProfile", user.practitioner.id, visibility);
  revalidatePath("/compte");
  return { ok: "Visibilité enregistrée." };
}

export async function updateOrgVisibility(_: ActionState, form: FormData): Promise<ActionState> {
  const orgId = str(form, "orgId");
  const { user } = await requireMembership(orgId, ["ADMIN"]);
  const raw: Record<string, string> = {};
  for (const f of COMPANY_VIS_FIELDS) raw[f.key] = str(form, f.key);
  const visibility = companyVisibility(raw);
  await db.organization.update({ where: { id: orgId }, data: { visibility, listed: form.get("listed") === "1" } });
  await audit(user.id, "org.visibility", "Organization", orgId, visibility);
  revalidatePath(`/organisations/${orgId}`);
  revalidatePath(`/organisations/${orgId}/membres`);
  return { ok: "Visibilité de la page publique enregistrée." };
}

export async function addPublication(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  if (!user.practitioner) return { error: "Réservé aux praticiens." };
  const title = str(form, "title");
  if (!title) return { error: "Le titre est obligatoire." };
  const year = Number(str(form, "year")) || null;
  if (year && (year < 1950 || year > new Date().getFullYear() + 1)) return { error: "Année invalide." };
  await db.publication.create({
    data: {
      practitionerId: user.practitioner.id, title, journal: str(form, "journal") || null, year, doi: str(form, "doi") || null,
      keywords: str(form, "keywords").split(",").map((k) => k.trim()).filter(Boolean),
    },
  });
  revalidatePath("/compte");
  return { ok: "Publication ajoutée." };
}

export async function removePublication(form: FormData) {
  const user = await requireUser();
  if (!user.practitioner) return;
  await db.publication.deleteMany({ where: { id: str(form, "id"), practitionerId: user.practitioner.id } });
  revalidatePath("/compte");
}

export async function addStructure(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  if (!user.practitioner) return { error: "Réservé aux praticiens." };
  const name = str(form, "name");
  const legalForm = str(form, "legalForm");
  if (!name || !legalForm) return { error: "Nom et forme juridique sont obligatoires." };
  const siren = str(form, "siren").replace(/\s/g, "");
  if (siren && !/^\d{9}$/.test(siren)) return { error: "Le SIREN comporte 9 chiffres." };
  const share = str(form, "sharePercent") ? Math.min(100, Math.max(0, Math.round(Number(str(form, "sharePercent"))))) : null;
  const isPayee = form.get("isPayee") === "1";
  if (isPayee) await db.practitionerStructure.updateMany({ where: { practitionerId: user.practitioner.id }, data: { isPayee: false } });
  const s = await db.practitionerStructure.create({
    data: { practitionerId: user.practitioner.id, name, legalForm, siren: siren || null, role: str(form, "role") || null, sharePercent: share, isPayee },
  });
  await audit(user.id, "practitioner.structure_add", "PractitionerStructure", s.id);
  revalidatePath("/compte");
  return { ok: "Structure ajoutée." };
}

export async function removeStructure(form: FormData) {
  const user = await requireUser();
  if (!user.practitioner) return;
  await db.practitionerStructure.deleteMany({ where: { id: str(form, "id"), practitionerId: user.practitioner.id } });
  revalidatePath("/compte");
}
