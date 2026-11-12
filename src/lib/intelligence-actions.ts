"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/auth";
import { requireMembership } from "@/lib/orgs";
import { STATS_ROLES } from "@/lib/org-roles";
import { orgHasAddon } from "@/lib/billing";
import { MAX_NAME, str } from "@/lib/form";
import { MAX_UPLOAD_BYTES } from "@/lib/storage";
import { readTable, TabularError } from "@/lib/tabular";
import { detectColumns, FIELD_LABEL, matchCompetitor, normName, parseAliases, parseLink } from "@/lib/intelligence";
import { getT } from "@/lib/i18n/server";

export type ActionState = { error?: string; ok?: string } | undefined;

/** Concurrents suivis par organisation : au-delà, la veille perd son sens (et les imports leur mesure). */
const MAX_COMPETITORS = 20;

/** Membre autorisé (rôles des statistiques) d'une organisation qui dispose de l'option ; sinon null. */
async function access(orgId: string) {
  const m = await requireMembership(orgId, STATS_ROLES);
  return (await orgHasAddon(orgId, "intelligence")) ? m : null;
}
const refresh = (orgId: string) => revalidatePath(`/organisations/${orgId}/intelligence`);

/** Concurrent ajouté à la veille : nom et autres écritures (marques, filiales) reconnues dans les fichiers importés. */
export async function addCompetitor(_: ActionState, form: FormData): Promise<ActionState> {
  const { t } = await getT();
  const orgId = str(form, "orgId");
  const m = await access(orgId);
  if (!m) return { error: t("Cette page fait partie de l'option KolBase Intelligence.") };
  const name = str(form, "name", MAX_NAME);
  if (normName(name).length < 3) return { error: t("Indiquez le nom du concurrent (trois caractères au moins).") };
  const existing = await db.competitor.findMany({ where: { organizationId: orgId }, select: { name: true } });
  if (existing.some((c) => normName(c.name) === normName(name))) return { error: t("Ce concurrent est déjà suivi.") };
  if (existing.length >= MAX_COMPETITORS) return { error: t("Vous suivez déjà {n} concurrents : retirez-en un pour en ajouter un autre.", { n: MAX_COMPETITORS }) };
  const c = await db.competitor.create({ data: { organizationId: orgId, name, aliases: parseAliases(str(form, "aliases", 1500)) } });
  await audit(m.user.id, "intelligence.competitor_add", "Organization", orgId, { competitorId: c.id, name });
  refresh(orgId);
  return { ok: t("{name} est suivi. Importez un fichier Transparence Santé pour lire ses déclarations.", { name }) };
}

/** Concurrent retiré de la veille : ses déclarations importées sont effacées avec lui. */
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
 * Import d'un fichier de la base publique Transparence Santé (CSV ou Excel téléchargé par l'organisation sur le site
 * officiel). Seules les lignes déclarées par un concurrent suivi sont conservées ; un fichier déjà importé n'ajoute
 * rien. Le membre atteste de l'origine du fichier et du respect de sa licence de réutilisation.
 */
export async function importPublicFile(_: ActionState, form: FormData): Promise<ActionState> {
  const { t } = await getT();
  const orgId = str(form, "orgId");
  const m = await access(orgId);
  if (!m) return { error: t("Cette page fait partie de l'option KolBase Intelligence.") };
  if (form.get("licence") !== "1") return { error: t("Confirmez l'origine du fichier et le respect de sa licence de réutilisation.") };
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: t("Choisissez un fichier.") };
  if (file.size > MAX_UPLOAD_BYTES) return { error: t("Fichier trop lourd : 10 Mo au maximum. Filtrez l'export sur vos concurrents ou sur une année avant de le télécharger.") };
  const competitors = await db.competitor.findMany({ where: { organizationId: orgId }, select: { id: true, name: true, aliases: true } });
  if (competitors.length === 0) return { error: t("Ajoutez d'abord au moins un concurrent à suivre : seules ses déclarations sont conservées.") };
  let table: string[][];
  try {
    table = readTable(new Uint8Array(await file.arrayBuffer()));
  } catch (e) {
    if (e instanceof TabularError && e.message === "rows") return { error: t("Fichier trop volumineux : filtrez l'export sur vos concurrents ou sur une année avant de le télécharger.") };
    return { error: t("Fichier illisible : déposez l'export CSV ou Excel (.xlsx) du site Transparence Santé.") };
  }
  if (table.length < 2) return { error: t("Ce fichier ne contient aucune ligne.") };
  const { columns, missing } = detectColumns(table[0]);
  if (missing.length) return { error: t("Colonnes introuvables : {missing}. En-têtes lus : {headers}.", { missing: missing.map((f) => t(FIELD_LABEL[f])).join(", "), headers: table[0].slice(0, 30).join(", ").slice(0, 600) }) };
  const kept = new Map<string, { competitorId: string; link: NonNullable<ReturnType<typeof parseLink>> }>();
  for (const row of table.slice(1)) {
    const link = parseLink(row, columns);
    const competitor = link && matchCompetitor(link.company, competitors);
    if (link && competitor) kept.set(`${competitor.id}:${link.sourceKey}`, { competitorId: competitor.id, link });
  }
  const rows = table.length - 1;
  if (kept.size === 0) return { error: t("{rows} lignes lues, aucune déclarée par un concurrent suivi. Vérifiez le nom ou les autres écritures de vos concurrents.", { rows }) };
  const imp = await db.publicImport.create({ data: { organizationId: orgId, fileName: file.name.slice(0, 200), rows, kept: 0, importedById: m.user.id } });
  const all = [...kept.values()];
  let created = 0;
  for (let i = 0; i < all.length; i += 1000) {
    const r = await db.publicLink.createMany({
      data: all.slice(i, i + 1000).map(({ competitorId, link }) => ({ organizationId: orgId, competitorId, importId: imp.id, kind: link.kind, date: link.date, amountCents: link.amountCents, beneficiaryId: link.beneficiaryId, beneficiaryName: link.beneficiaryName, category: link.category, purpose: link.purpose, sourceKey: link.sourceKey })),
      skipDuplicates: true,
    });
    created += r.count;
  }
  await db.publicImport.update({ where: { id: imp.id }, data: { kept: created } });
  await audit(m.user.id, "intelligence.import", "Organization", orgId, { importId: imp.id, file: imp.fileName, rows, matched: all.length, created });
  refresh(orgId);
  return { ok: t("{rows} lignes lues, {matched} déclarées par vos concurrents suivis, dont {created} nouvelles.", { rows, matched: all.length, created }) };
}

/** Import retiré : ses lignes sont effacées. */
export async function removeImport(form: FormData) {
  const orgId = str(form, "orgId");
  const m = await access(orgId);
  if (!m) return;
  const imp = await db.publicImport.findFirst({ where: { id: str(form, "importId"), organizationId: orgId } });
  if (!imp) return;
  await db.publicImport.delete({ where: { id: imp.id } });
  await audit(m.user.id, "intelligence.import_remove", "Organization", orgId, { file: imp.fileName });
  refresh(orgId);
}
