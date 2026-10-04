"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit, requireUser } from "@/lib/auth";
import { requireMembership } from "@/lib/orgs";
import { collabType, MATERIAL_KINDS, PROJECT_ROLES, REVIEW_ROLES } from "@/lib/projects";

export type ActionState = { error?: string; ok?: string } | undefined;
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const eurToCents = (v: string) => {
  const n = Number(v.replace(/\s/g, "").replace(",", "."));
  return v && Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
};
const okUrl = (u: string) => !u || /^https?:\/\/\S+$/i.test(u);

async function loadProjectForOrg(orgId: string, projectId: string) {
  const p = await db.project.findFirst({ where: { id: projectId, organizationId: orgId } });
  if (!p) throw new Error("Dossier introuvable");
  return p;
}
const refresh = (orgId: string, projectId: string) => {
  revalidatePath(`/organisations/${orgId}/dossiers/${projectId}`);
  revalidatePath(`/organisations/${orgId}`);
};

// ─── Budget et dépenses ────────────────────────────────────────────────────

export async function setBudget(_: ActionState, form: FormData): Promise<ActionState> {
  const orgId = str(form, "orgId"); const projectId = str(form, "projectId");
  const { user } = await requireMembership(orgId, PROJECT_ROLES);
  await loadProjectForOrg(orgId, projectId);
  const cents = eurToCents(str(form, "budget"));
  if (str(form, "budget") && cents === null) return { error: "Montant invalide." };
  await db.project.update({ where: { id: projectId }, data: { budgetCents: cents } });
  await audit(user.id, "project.budget", "Project", projectId, { budgetCents: cents });
  refresh(orgId, projectId);
  return { ok: "Budget enregistré." };
}

export async function addExpense(_: ActionState, form: FormData): Promise<ActionState> {
  const orgId = str(form, "orgId"); const projectId = str(form, "projectId");
  const { user } = await requireMembership(orgId, PROJECT_ROLES);
  await loadProjectForOrg(orgId, projectId);
  const label = str(form, "label");
  const amount = eurToCents(str(form, "amount"));
  const date = str(form, "date") ? new Date(`${str(form, "date")}T12:00:00Z`) : new Date();
  if (!label) return { error: "Indiquez le poste de dépense." };
  if (amount === null) return { error: "Montant invalide." };
  if (Number.isNaN(date.getTime())) return { error: "Date invalide." };
  const e = await db.expense.create({ data: { projectId, label, amountCents: amount, date, status: "engagee" } });
  await audit(user.id, "expense.add", "Project", projectId, { expenseId: e.id, amount });
  refresh(orgId, projectId);
  return { ok: "Dépense ajoutée." };
}

export async function updateExpense(form: FormData) {
  const orgId = str(form, "orgId"); const projectId = str(form, "projectId"); const id = str(form, "expenseId");
  const { user } = await requireMembership(orgId, PROJECT_ROLES);
  await loadProjectForOrg(orgId, projectId);
  if (form.get("remove") === "1") {
    await db.expense.deleteMany({ where: { id, projectId } });
    await audit(user.id, "expense.remove", "Project", projectId, { expenseId: id });
  } else {
    const status = str(form, "status") === "payee" ? "payee" : "engagee";
    await db.expense.updateMany({ where: { id, projectId }, data: { status } });
  }
  refresh(orgId, projectId);
}

// ─── Supports et relecture ─────────────────────────────────────────────────

/** Vérifie que l'utilisateur peut déposer un support : rôle « projet » dans l'organisation, ou expert engagé sur le dossier. */
async function canSubmit(userId: string, projectId: string) {
  const user = await requireUser();
  const project = await db.project.findUnique({ where: { id: projectId }, include: { experts: { include: { practitioner: true } } } });
  if (!project) return null;
  const isOrg = user.memberships.some((m) => m.organizationId === project.organizationId && PROJECT_ROLES.includes(m.role));
  const isExpert = project.experts.some((e) => e.practitioner.userId === userId && !["ATT_EXPERTS", "DECLINE"].includes(e.status));
  return isOrg || isExpert ? project : null;
}

export async function addMaterial(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const projectId = str(form, "projectId");
  const project = await canSubmit(user.id, projectId);
  if (!project) return { error: "Accès refusé." };
  const title = str(form, "title"); const kind = str(form, "kind"); const url = str(form, "url");
  if (!title) return { error: "Donnez un titre au support." };
  if (!(kind in MATERIAL_KINDS)) return { error: "Type de support invalide." };
  if (!okUrl(url)) return { error: "Le lien doit commencer par http:// ou https://." };
  if (!url && !str(form, "notes")) return { error: "Indiquez un lien vers le document ou son contenu." };
  const m = await db.material.create({
    data: { projectId, title, kind, versions: { create: { version: 1, url: url || null, notes: str(form, "notes") || null, submittedById: user.id } } },
  });
  await audit(user.id, "material.submit", "Project", projectId, { materialId: m.id, version: 1, title });
  revalidatePath(`/organisations/${project.organizationId}/dossiers/${projectId}`);
  revalidatePath("/sollicitations", "layout");
  return { ok: "Support soumis à la relecture." };
}

export async function addMaterialVersion(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const materialId = str(form, "materialId");
  const material = await db.material.findUnique({ where: { id: materialId }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } });
  if (!material) return { error: "Support introuvable." };
  const project = await canSubmit(user.id, material.projectId);
  if (!project) return { error: "Accès refusé." };
  const url = str(form, "url");
  if (!okUrl(url)) return { error: "Le lien doit commencer par http:// ou https://." };
  if (!url && !str(form, "notes")) return { error: "Indiquez un lien ou décrivez les modifications." };
  const version = (material.versions[0]?.version ?? 0) + 1;
  await db.materialVersion.create({ data: { materialId, version, url: url || null, notes: str(form, "notes") || null, submittedById: user.id } });
  await audit(user.id, "material.submit", "Project", material.projectId, { materialId, version, title: material.title });
  revalidatePath(`/organisations/${project.organizationId}/dossiers/${material.projectId}`);
  revalidatePath("/sollicitations", "layout");
  return { ok: `Version ${version} soumise.` };
}

export async function reviewMaterial(form: FormData) {
  const orgId = str(form, "orgId");
  const { user } = await requireMembership(orgId, REVIEW_ROLES);
  const versionId = str(form, "versionId");
  const v = await db.materialVersion.findFirst({ where: { id: versionId, material: { project: { organizationId: orgId } } }, include: { material: true } });
  if (!v || v.status !== "submitted") return;
  const decision = str(form, "decision") === "approve" ? "approved" : "changes";
  const comment = str(form, "comment");
  if (decision === "changes" && !comment) return;
  await db.materialVersion.update({ where: { id: v.id }, data: { status: decision, reviewerId: user.id, reviewComment: comment || null, reviewedAt: new Date() } });
  await audit(user.id, decision === "approved" ? "material.approve" : "material.changes", "Project", v.material.projectId, { materialId: v.materialId, version: v.version, title: v.material.title, note: comment || undefined });
  refresh(orgId, v.material.projectId);
  revalidatePath("/sollicitations", "layout");
}

// ─── Proposition de collaboration par l'expert ─────────────────────────────

export async function proposeCollaboration(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  if (!user.practitioner?.listed) return { error: "Référencez-vous comme expert pour proposer une collaboration." };
  const orgId = str(form, "orgId");
  const org = await db.organization.findFirst({ where: { id: orgId, listed: true } });
  if (!org) return { error: "Organisation introuvable." };
  const title = str(form, "title"); const typeId = str(form, "typeId"); const message = str(form, "message");
  if (!title) return { error: "Donnez un titre à votre proposition." };
  if (!collabType(typeId)) return { error: "Type de collaboration invalide." };
  if (message.length < 30) return { error: "Décrivez votre proposition en quelques lignes (30 caractères minimum)." };
  const fee = eurToCents(str(form, "fee"));
  const units = Number(str(form, "units").replace(",", ".")) || 1;
  const project = await db.project.create({
    data: {
      organizationId: orgId, title, typeId, therapeuticArea: str(form, "therapeuticArea") || user.practitioner.specialty, description: message,
      origin: "Proposition de l'expert", status: "ATT_IND", createdById: user.id,
      experts: { create: { practitionerId: user.practitioner.id, status: "ACCORD", feeCents: fee, days: units, respondedAt: new Date() } },
    },
    include: { experts: true },
  });
  await db.message.create({ data: { projectId: project.id, projectExpertId: project.experts[0].id, authorId: user.id, body: message } });
  await audit(user.id, "project.propose", "Project", project.id, { orgId });
  redirect(`/sollicitations/${project.experts[0].id}`);
}
