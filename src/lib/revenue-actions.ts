"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit, requireUser } from "@/lib/auth";
import { requireMembership } from "@/lib/orgs";
import { collabType, PROJECT_ROLES } from "@/lib/projects";
import { eurToCents, str } from "@/lib/form";
import { parisToday, parseParisDateTime } from "@/lib/events";
import { notifyFeeNote, notifyFeePaid, notifyTransparencyIssue } from "@/lib/notifications";
import { licenseRule, practicesInFrance } from "@/lib/countries";
import { billingComplete, formatIban, nextNumber, validIban, validSiret, vatBpOf, type FeeNoteData } from "@/lib/fee-notes";
import { drPrefix } from "@/lib/professions";
import { billingEditable, LEGAL_FORMS, linkPayee, payeeEntity, sirenOf } from "@/lib/structures";
import { blockedFor, hit } from "@/lib/rate-limit";
import { getT } from "@/lib/i18n/server";

export type FormState = { error?: string; ok?: string } | undefined;

// ─── Praticien ──────────────────────────────────────────────────────────────

/** Lien d'intérêts noué hors de KolBase, pour compléter la déclaration. */
export async function addDeclaredInterest(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const { t } = await getT();
  const p = user.practitioner;
  if (!p) return { error: t("Réservé aux praticiens.") };
  const organization = str(form, "organization").slice(0, 120);
  const nature = str(form, "nature").slice(0, 200);
  const year = new Date().getFullYear();
  const startYear = Number(str(form, "startYear"));
  const endRaw = str(form, "endYear");
  const endYear = endRaw ? Number(endRaw) : null;
  if (!organization || !nature) return { error: t("Indiquez l'organisation et la nature du lien.") };
  if (!Number.isInteger(startYear) || startYear < 1980 || startYear > year) return { error: t("Année de début invalide.") };
  if (endYear != null && (!Number.isInteger(endYear) || endYear < startYear || endYear > year)) return { error: t("Année de fin invalide.") };
  if ((await db.declaredInterest.count({ where: { practitionerId: p.id } })) >= 100) return { error: t("Trop de liens déclarés.") };
  const d = await db.declaredInterest.create({ data: { practitionerId: p.id, organization, nature, startYear, endYear } });
  await audit(user.id, "interest.add", "DeclaredInterest", d.id);
  revalidatePath("/revenus");
  return { ok: t("Lien ajouté.") };
}

export async function removeDeclaredInterest(form: FormData) {
  const user = await requireUser();
  if (!user.practitioner) return;
  const { count } = await db.declaredInterest.deleteMany({ where: { id: str(form, "id"), practitionerId: user.practitioner.id } });
  if (count) await audit(user.id, "interest.remove", "DeclaredInterest", str(form, "id"));
  revalidatePath("/revenus");
}

/** Signaler une erreur dans ce qu'une organisation déclare (ou va déclarer) à son nom sur Transparence Santé. */
export async function reportTransparencyIssue(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const { t } = await getT();
  const p = user.practitioner;
  if (!p) return { error: t("Réservé aux praticiens.") };
  const comment = str(form, "comment").slice(0, 2000);
  if (comment.length < 10) return { error: t("Décrivez l'erreur en quelques mots.") };
  const key = `transparence:${user.id}`;
  if (await blockedFor(key, 10, 60 * 60 * 1000)) return { error: t("Trop de signalements : réessayez plus tard.") };
  const kind = str(form, "kind");
  const id = str(form, "id");
  let target: { orgId: string; label: string } | null = null;
  if (kind === "convention") {
    const l = await db.projectExpert.findFirst({ where: { id, practitionerId: p.id }, include: { project: true } });
    if (l) target = { orgId: l.project.organizationId, label: `Convention « ${l.project.title} »` };
  } else if (kind === "hospitalite") {
    const r = await db.registration.findFirst({ where: { id, userId: user.id }, include: { event: true } });
    if (r) target = { orgId: r.event.organizationId, label: `Hospitalités de l'événement « ${r.event.title} »` };
  }
  if (!target) return { error: t("Élément introuvable.") };
  await hit(key);
  await audit(user.id, "transparency.report", kind === "convention" ? "ProjectExpert" : "Registration", id, { orgId: target.orgId });
  notifyTransparencyIssue(target.orgId, `${user.firstName} ${user.lastName}`, target.label, comment);
  return { ok: t("Signalement envoyé à l'équipe conformité de l'organisation.") };
}

/**
 * Coordonnées de facturation : en nom propre (target « self »), d'une structure existante (son identifiant) ou d'une
 * nouvelle structure (target « new », avec son nom et sa forme juridique). Reprises par les conventions et les notes
 * d'honoraires facturées à ce nom.
 */
export async function updateBilling(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const { t } = await getT();
  const p = user.practitioner;
  if (!p) return { error: t("Réservé aux praticiens.") };
  const billingAddress = str(form, "billingAddress").slice(0, 300);
  const siret = str(form, "siret").replace(/\s/g, "");
  const iban = str(form, "iban").replace(/\s/g, "").toUpperCase();
  const vatRegime = str(form, "vatRegime") === "assujetti" ? "assujetti" : "franchise";
  const vatNumber = str(form, "vatNumber").replace(/\s/g, "").toUpperCase().slice(0, 20);
  if (!billingAddress) return { error: t("Indiquez l'adresse de facturation.") };
  if (siret && !validSiret(siret)) return { error: t("Numéro SIRET invalide (14 chiffres).") };
  if (iban && !validIban(iban)) return { error: t("IBAN invalide.") };
  if (vatRegime === "assujetti" && !/^[A-Z]{2}[A-Z0-9]{8,14}$/.test(vatNumber)) return { error: t("Indiquez le numéro de TVA intracommunautaire.") };
  const coords = { billingAddress, siret: siret || null, iban: iban || null, vatRegime, vatNumber: vatRegime === "assujetti" ? vatNumber : null };
  const target = str(form, "target") || "self";
  if (target === "self") {
    await db.practitionerProfile.update({ where: { id: p.id }, data: coords });
    await audit(user.id, "practitioner.billing", "PractitionerProfile", p.id);
  } else {
    const name = str(form, "name", 120);
    const legalForm = str(form, "legalForm");
    if (!name || !LEGAL_FORMS.includes(legalForm)) return { error: t("Nom et forme juridique sont obligatoires.") };
    if (target === "new") {
      if ((await db.practitionerStructure.count({ where: { practitionerId: p.id } })) >= 20) return { error: t("Vous avez déjà 20 structures.") };
      // Première structure de facturation, sans coordonnées en nom propre : proposée par défaut pour les conventions.
      const isPayee = (await db.practitionerStructure.count({ where: { practitionerId: p.id, isPayee: true } })) === 0 && !billingComplete(p);
      const s = await db.practitionerStructure.create({ data: { practitionerId: p.id, name, legalForm, siren: sirenOf(siret), isPayee, ...coords } });
      await audit(user.id, "practitioner.structure_add", "PractitionerStructure", s.id);
    } else {
      const s = await db.practitionerStructure.findFirst({ where: { id: target, practitionerId: p.id } });
      if (!s) return { error: t("Structure introuvable.") };
      await db.practitionerStructure.update({ where: { id: s.id }, data: { name, legalForm, siren: sirenOf(siret) ?? s.siren, ...coords } });
      await audit(user.id, "practitioner.billing", "PractitionerStructure", s.id);
    }
  }
  revalidatePath("/revenus");
  revalidatePath("/compte");
  return { ok: t("Coordonnées de facturation enregistrées.") };
}

/** Au nom de qui facturer par défaut les nouvelles conventions : nom propre (« self ») ou une structure. */
export async function setDefaultBilling(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const { t } = await getT();
  const p = user.practitioner;
  if (!p) return { error: t("Réservé aux praticiens.") };
  const value = str(form, "payee");
  const s = value === "self" ? null : await db.practitionerStructure.findFirst({ where: { id: value, practitionerId: p.id } });
  if (value !== "self" && !s) return { error: t("Structure introuvable.") };
  await db.$transaction([
    db.practitionerStructure.updateMany({ where: { practitionerId: p.id, isPayee: true }, data: { isPayee: false } }),
    ...(s ? [db.practitionerStructure.update({ where: { id: s.id }, data: { isPayee: true } })] : []),
  ]);
  await audit(user.id, "practitioner.billing_default", "PractitionerProfile", p.id, { structureId: s?.id ?? null });
  revalidatePath("/revenus");
  revalidatePath("/compte");
  return { ok: t("Choix par défaut enregistré.") };
}

/** Au nom de qui facturer une convention : modifiable pendant le recrutement, figé à la soumission à la conformité. */
export async function chooseLinkBilling(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const { t } = await getT();
  const p = user.practitioner;
  if (!p) return { error: t("Réservé aux praticiens.") };
  const link = await db.projectExpert.findFirst({ where: { id: str(form, "linkId"), practitionerId: p.id }, include: { project: { select: { status: true, organizationId: true } } } });
  if (!link) return { error: t("Convention introuvable.") };
  if (!billingEditable(link.project.status, link.status)) return { error: t("Le dossier a été soumis à la conformité : la facturation de la convention ne change plus.") };
  const value = str(form, "payee");
  const s = value === "self" ? null : await db.practitionerStructure.findFirst({ where: { id: value, practitionerId: p.id } });
  if (value !== "self" && !s) return { error: t("Structure introuvable.") };
  await db.projectExpert.update({ where: { id: link.id }, data: s ? { billingStructureId: s.id, billingSelf: false } : { billingStructureId: null, billingSelf: true } });
  await audit(user.id, "expert.billing_choice", "ProjectExpert", link.id, { structureId: s?.id ?? null });
  revalidatePath(`/sollicitations/${link.id}`);
  revalidatePath("/revenus");
  revalidatePath(`/organisations/${link.project.organizationId}/dossiers/${link.projectId}`);
  return { ok: s ? t("La convention sera facturée au nom de {name}.", { name: s.name }) : t("La convention sera facturée en votre nom propre.") };
}

/** Note d'honoraires pour une convention signée : numérotée, figée, transmise à l'organisation. */
export async function issueFeeNote(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const { t } = await getT();
  const p = user.practitioner;
  if (!p) return { error: t("Réservé aux praticiens.") };
  const prof = await db.practitionerProfile.findUnique({ where: { id: p.id }, include: { structures: true } });
  const link = await db.projectExpert.findFirst({
    where: { id: str(form, "linkId"), practitionerId: p.id, status: { in: ["SIGNE", "TERMINE"] } },
    include: { project: { include: { organization: true } }, signature: { select: { completedAt: true } }, feeNote: { select: { id: true } } },
  });
  if (!prof || !link) return { error: t("Convention signée introuvable.") };
  // Au nom de qui la convention est facturée : la structure choisie (ses coordonnées) ou le nom propre (le profil).
  const payee = linkPayee(link, prof.structures);
  const coords = payee ?? prof;
  if (!billingComplete(coords)) return { error: payee ? t("Complétez d'abord les coordonnées de facturation de {name}.", { name: payee.name }) : t("Complétez d'abord vos coordonnées de facturation.") };
  if (link.feeNote) return { ok: t("La note d'honoraires est déjà établie.") };
  if (!link.feeCents) return { error: t("Aucun montant d'honoraires dans la convention.") };
  const signedLog = await db.auditLog.findFirst({ where: { entityType: "Project", entityId: link.projectId, action: { in: ["project.signed", "project.attest"] } }, orderBy: { createdAt: "desc" } });
  const signedAt = link.signature?.completedAt ?? link.project.signatureAttestedAt ?? signedLog?.createdAt ?? null;
  const type = collabType(link.project.typeId);
  const data: FeeNoteData = {
    issuer: { name: `${drPrefix(prof.profession)}${user.firstName} ${user.lastName}`, entity: payeeEntity(payee), address: coords.billingAddress!, siret: coords.siret, vatNumber: coords.vatNumber,
      // Hors de France, l'identifiant du pays d'exercice (INAMI…), comme la convention.
      rpps: practicesInFrance(prof.country) ? prof.rpps : null,
      license: !practicesInFrance(prof.country) && prof.licenseNumber ? `${licenseRule(prof.country).label} ${prof.licenseNumber}` : null,
      iban: coords.iban ? formatIban(coords.iban) : null, vatRegime: coords.vatRegime },
    recipient: { name: link.project.organization.name, siren: link.project.organization.siren, address: link.project.organization.headquarters },
    object: { title: link.project.title, type: type?.label ?? link.project.typeId, unit: type?.unit ?? null, units: link.days, signedAt: signedAt ? signedAt.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "long", year: "numeric" }) : null, projectRef: link.projectId.slice(-8).toUpperCase(), purchaseOrder: link.project.purchaseOrder, costCenter: link.project.costCenter },
  };
  const vatBp = vatBpOf(coords.vatRegime);
  const year = new Date().getFullYear();
  let note: Awaited<ReturnType<typeof db.feeNote.create>> | undefined;
  for (let attempt = 0; attempt < 3 && !note; attempt++) {
    const existing = await db.feeNote.findMany({ where: { practitionerId: p.id, number: { startsWith: `NH-${year}-` } }, select: { number: true } });
    try {
      note = await db.feeNote.create({
        data: { number: nextNumber(year, existing.map((e) => e.number)), practitionerId: p.id, projectExpertId: link.id, organizationId: link.project.organizationId, amountCents: link.feeCents, vatBp, totalCents: link.feeCents + Math.round((link.feeCents * vatBp) / 10000), data },
      });
    } catch (e) {
      if (attempt === 2) throw e; // numéro pris entre-temps (double clic) : on recommence
    }
  }
  await audit(user.id, "feenote.issue", "FeeNote", note!.id, { number: note!.number });
  notifyFeeNote(note!.id);
  revalidatePath("/revenus");
  revalidatePath(`/organisations/${link.project.organizationId}/dossiers/${link.projectId}`);
  return { ok: t("Note {number} établie et transmise à {org}.", { number: note!.number, org: link.project.organization.name }) };
}

// ─── Organisation ───────────────────────────────────────────────────────────

/** Honoraires payés (ou paiement annulé) : l'expert le voit dans « Mes revenus » et en est prévenu. */
export async function markExpertPaid(form: FormData) {
  const orgId = str(form, "orgId");
  const { user } = await requireMembership(orgId, PROJECT_ROLES);
  const link = await db.projectExpert.findFirst({ where: { id: str(form, "linkId"), project: { organizationId: orgId }, status: { in: ["SIGNE", "TERMINE"] } } });
  if (!link) return;
  if (form.get("undo") === "1") {
    await db.projectExpert.update({ where: { id: link.id }, data: { paidAt: null, paidCents: null } });
    await audit(user.id, "expert.unpaid", "ProjectExpert", link.id);
  } else {
    const cents = eurToCents(str(form, "amount"), { allowZero: false }) ?? link.feeCents;
    // Paiement daté du jour : l'heure courante (midi à Paris serait « dans le futur » le matin).
    const now = new Date();
    const dateRaw = str(form, "date");
    if (dateRaw > parisToday(now)) return;
    const date = !dateRaw || dateRaw === parisToday(now) ? now : parseParisDateTime(`${dateRaw}T12:00`);
    if (!cents || !date) return;
    await db.projectExpert.update({ where: { id: link.id }, data: { paidAt: date, paidCents: cents } });
    await audit(user.id, "expert.paid", "ProjectExpert", link.id, { cents });
    notifyFeePaid(link.id);
  }
  revalidatePath(`/organisations/${orgId}/dossiers/${link.projectId}`);
}
