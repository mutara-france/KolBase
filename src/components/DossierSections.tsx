import { AlertTriangle, ExternalLink, FileCheck, FileSignature, FileText, Info, Receipt, ShieldAlert, Users, Wallet } from "lucide-react";
import { SectionHead } from "@/components/UI";
import { markExpertPaid } from "@/lib/revenue-actions";
import { parisToday } from "@/lib/events";
import { db } from "@/lib/db";
import { detectConflicts } from "@/lib/conflicts";
import { MATERIAL_KINDS, MATERIAL_STATUS, recruitmentOpen, REVIEW_ROLES } from "@/lib/projects";
import { expertSplit } from "@/lib/indicators";
import { supplierCategoryLabel } from "@/lib/suppliers";
import { reviewMaterial, updateExpense } from "@/lib/dossier-actions";
import { FOUR_EYES_BLOCKED, fourEyes } from "@/lib/four-eyes";
import { getCurrentUser } from "@/lib/auth";
import { BudgetForm, DocumentUploadForm, ExpenseForm, MaterialForm, RefreshSignatureForm, SendSignatureForm, VersionForm } from "@/components/DossierForms";
import { deleteDocument } from "@/lib/document-actions";
import { storageEnabled } from "@/lib/storage";
import { drPrefix } from "@/lib/professions";
import { fmtDate, fmtEur, type Locale, type T } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import { canSendAgain, SIGNATURE_LABEL, signatureEnabled } from "@/lib/yousign";
import type { ConventionSignature, ProjectStatus } from "@/generated/prisma/client";
import { TableWrap } from "@/components/TableWrap";

export async function ConflictsPanel({ projectId }: { projectId: string }) {
  const { t, locale } = await getT();
  const conflicts = await detectConflicts(projectId, t, locale);
  return (
    <section className="card" aria-labelledby="conflits-titre">
      <SectionHead icon={ShieldAlert} id="conflits-titre" tone={conflicts.some((c) => c.severity === "danger") ? "danger" : conflicts.some((c) => c.severity === "warn") ? "warn" : "brand"} title={t("Points d'attention")} desc={t("Conflits d'intérêts possibles, d'après les données KolBase.")} />
      {conflicts.length === 0 ? <p className="todo-empty">{t("Aucun point d'attention dans les données KolBase. Les liens d'intérêts noués en dehors de KolBase ne sont pas connus : l'expert les déclare lui-même.")}</p> : (
        <ul className="conflict-list">
          {conflicts.map((c, i) => (
            <li key={i} className={`conflict ${c.severity}`}>
              {c.severity === "info" ? <Info size={15} /> : <AlertTriangle size={15} />}
              <span><strong>{c.who}</strong> — {c.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Onglet Budget d'un dossier : tout l'argent au même endroit. Le budget prévu et ce qui est engagé (honoraires,
 * devis retenus pour l'événement, autres dépenses), puis le suivi : paiement des experts et notes d'honoraires,
 * dépenses engagées ou payées.
 */
export async function BudgetTab({ orgId, projectId, canEdit }: { orgId: string; projectId: string; canEdit: boolean }) {
  const { t, locale } = await getT();
  const project = await db.project.findUnique({
    where: { id: projectId },
    include: {
      experts: {
        where: { status: { notIn: ["DECLINE"] } },
        include: {
          practitioner: { select: { profession: true, user: { select: { firstName: true, lastName: true } } } },
          feeNote: { select: { id: true, number: true, totalCents: true, vatBp: true } },
        },
        orderBy: { createdAt: "asc" },
      },
      expenses: { orderBy: { date: "asc" } },
    },
  });
  if (!project) return null;
  // Devis retenus pour les événements rattachés au dossier : ils comptent dans le budget (HT).
  const quotes = await db.quote.findMany({
    where: { status: "retained", rfq: { event: { projectId } } },
    include: { supplier: { select: { name: true } }, rfq: { select: { category: true } } },
    orderBy: { updatedAt: "asc" },
  });
  // Même définition que la vue d'ensemble : honoraires engagés (acceptés par l'expert), proposés à part.
  const open = recruitmentOpen(project.status);
  const { engagedCents: fees, proposedCents: proposed } = expertSplit(project.experts, open);
  const exp = project.expenses.reduce((s, e) => s + e.amountCents, 0);
  const sup = quotes.reduce((s, q) => s + q.amountCents, 0);
  const total = fees + exp + sup;
  const budget = project.budgetCents;
  const realPct = budget ? Math.round((total / budget) * 100) : null;
  const pct = realPct != null ? Math.min(100, realPct) : null;
  const over = budget != null && total > budget;
  const share = (n: number) => (total > 0 ? `${Math.round((n / total) * 100)} %` : "");
  const name = (e: (typeof project.experts)[number]) => `${drPrefix(e.practitioner.profession)}${e.practitioner.user.firstName} ${e.practitioner.user.lastName}`;
  const engaged = project.experts.filter((e) => e.status !== "ATT_EXPERTS");
  const pending = open ? project.experts.filter((e) => e.status === "ATT_EXPERTS") : [];
  const today = parisToday();
  return (
    <div className="page-grid">
      <div className="page-main">
        <section className="card stack-sm" aria-labelledby="honoraires-titre">
          <SectionHead icon={Users} id="honoraires-titre" title={t("Honoraires des experts")} desc={t("Montants HT engagés par convention ; le paiement se note une fois la convention signée.")}>
            <span className="amount-chip">{fmtEur(locale, fees)}{" "}{t("HT")}</span>
          </SectionHead>
          {engaged.length === 0 && pending.length === 0 ? <p className="muted">{t("Aucun expert engagé pour l'instant.")}</p> : (
            <TableWrap label={t("Honoraires des experts")}>
              <table className="table">
                <thead><tr><th>{t("Expert")}</th><th className="num">{t("Honoraires HT")}</th><th>{t("Note d'honoraires")}</th><th>{t("Paiement")}</th></tr></thead>
                <tbody>
                  {engaged.map((e) => {
                    const payable = ["SIGNE", "TERMINE"].includes(e.status);
                    return (
                      <tr key={e.id}>
                        <td data-label="Expert"><strong>{name(e)}</strong></td>
                        <td data-label="Honoraires HT" className="num">{e.feeCents != null ? fmtEur(locale, e.feeCents) : "—"}</td>
                        <td data-label="Note d'honoraires">
                          {e.feeNote
                            ? <a href={`/notes-honoraires/${e.feeNote.id}`}>{t("N° {number} · {montant}", { number: e.feeNote.number, montant: fmtEur(locale, e.feeNote.totalCents) })}{" "}{e.feeNote.vatBp ? "TTC" : t("(TVA non applicable)")}</a>
                            : <span className="muted text-xs">{payable ? t("Pas encore établie par l'expert") : "—"}</span>}
                        </td>
                        <td data-label="Paiement">
                          {e.paidAt ? (
                            <span className="inline wrap">
                              <span className="pill ok">{t("Payés le {date} · {montant}", { date: fmtDate(locale, e.paidAt), montant: fmtEur(locale, e.paidCents ?? 0) })}</span>
                              {canEdit && (
                                <form action={markExpertPaid}>
                                  <input type="hidden" name="orgId" value={orgId} /><input type="hidden" name="linkId" value={e.id} /><input type="hidden" name="undo" value="1" />
                                  <button className="link text-xs">{t("Annuler")}</button>
                                </form>
                              )}
                            </span>
                          ) : !payable ? (
                            <span className="muted text-xs">{t("Après signature de la convention")}</span>
                          ) : canEdit ? (
                            <details className="pay-edit">
                              <summary className="pill wait">{t("À payer")}{" · "}{t("Marquer payé")}</summary>
                              <form action={markExpertPaid} className="inline wrap mt-2">
                                <input type="hidden" name="orgId" value={orgId} /><input type="hidden" name="linkId" value={e.id} />
                                <input name="amount" inputMode="decimal" defaultValue={e.feeCents != null ? String(e.feeCents / 100) : ""} aria-label={t("Montant payé (€ HT)")} />
                                <input name="date" type="date" defaultValue={today} max={today} aria-label={t("Date du paiement")} />
                                <button className="btn ghost small">{t("Marquer payé")}</button>
                              </form>
                            </details>
                          ) : (
                            <span className="pill wait">{t("Honoraires à payer")}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {pending.map((e) => (
                    <tr key={e.id} className="muted-row">
                      <td data-label="Expert">{name(e)}</td>
                      <td data-label="Honoraires HT" className="num">{e.feeCents != null ? fmtEur(locale, e.feeCents) : "—"}</td>
                      <td data-label="Note d'honoraires">—</td>
                      <td data-label="Paiement"><span className="pill wait">{t("Proposés, sans réponse")}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </section>
        <section className="card stack-sm" aria-labelledby="depenses-titre">
          <SectionHead icon={Receipt} id="depenses-titre" title={t("Prestataires et autres dépenses")} desc={t("Devis retenus pour l'événement du dossier et dépenses saisies par l'équipe.")}>
            <span className="amount-chip">{fmtEur(locale, sup + exp)}{" "}{t("HT")}</span>
          </SectionHead>
          {project.expenses.length === 0 && quotes.length === 0 ? <p className="muted">{t("Aucune dépense pour l'instant.")}</p> : (
            <TableWrap label={t("Dépenses et devis retenus")}>
              <table className="table">
                <thead><tr><th>{t("Date")}</th><th>{t("Poste")}</th><th className="num">{t("Montant HT")}</th><th>{t("Statut")}</th>{canEdit && <th />}</tr></thead>
                <tbody>
                  {quotes.map((q) => (
                    <tr key={q.id}>
                      <td data-label="Date">{fmtDate(locale, q.updatedAt)}</td>
                      <td data-label="Poste">{t(supplierCategoryLabel(q.rfq.category))} : {q.supplier.name}</td>
                      <td data-label="Montant HT" className="num">{fmtEur(locale, q.amountCents)}</td>
                      <td data-label="Statut"><span className="pill ok">{t("Devis retenu")}</span></td>
                      {canEdit && <td><a className="link" href={`/organisations/${orgId}/prestataires/${q.rfqId}`}>{t("Voir le devis")}</a></td>}
                    </tr>
                  ))}
                  {project.expenses.map((e) => (
                    <tr key={e.id}>
                      <td data-label="Date">{fmtDate(locale, e.date)}</td><td data-label="Poste">{e.label}</td><td data-label="Montant HT" className="num">{fmtEur(locale, e.amountCents)}</td>
                      <td data-label="Statut"><span className={`pill ${e.status === "payee" ? "ok" : "wait"}`}>{e.status === "payee" ? t("Payée") : t("Engagée")}</span></td>
                      {canEdit && (
                        <td>
                          <form action={updateExpense} className="inline">
                            <input type="hidden" name="orgId" value={orgId} /><input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="expenseId" value={e.id} />
                            {e.status !== "payee" && <button className="link" name="status" value="payee">{t("Marquer payée")}</button>}
                            <button className="link danger" name="remove" value="1">{t("Retirer")}</button>
                          </form>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
          {canEdit && (
            <details className="disclosure">
              <summary>{t("Ajouter une dépense")}</summary>
              <ExpenseForm orgId={orgId} projectId={projectId} />
            </details>
          )}
        </section>
      </div>
      <aside className="page-aside">
        <section className={`card stack-sm budget-card${over ? " over" : ""}`} aria-labelledby="budget-titre">
          <SectionHead icon={Wallet} id="budget-titre" title={t("Budget")} tone={over ? "danger" : "brand"} desc={budget != null ? t("{montant} HT prévus", { montant: fmtEur(locale, budget) }) : t("Budget à renseigner")} />
          <div className="budget-figure">
            <span className="big">{fmtEur(locale, total)}</span>
            <span className="muted text-sm">{t("engagés (HT)")}{realPct != null ? ` · ${t("{realPct} % du budget", { realPct })}` : ""}</span>
          </div>
          {pct != null && <div className="gauge-track" role="img" aria-label={t("{realPct} % du budget", { realPct: realPct ?? 0 })}><div className={`gauge-fill${over ? " over" : ""}`} style={{ width: `${pct}%` }} /></div>}
          {over && <p className="notice error">{t("Le total engagé dépasse le budget prévu de {montant}.", { montant: fmtEur(locale, total - budget!) })}</p>}
          {/* Une ligne par poste, montants alignés à droite, part de chacun dans le total. */}
          <dl className="budget-lines">
            <div><dt>{t("Honoraires engagés")}</dt><dd>{fmtEur(locale, fees)}<small>{share(fees)}</small></dd></div>
            <div><dt>{t("Prestataires (devis retenus)")}</dt><dd>{fmtEur(locale, sup)}<small>{share(sup)}</small></dd></div>
            <div><dt>{t("Autres dépenses")}</dt><dd>{fmtEur(locale, exp)}<small>{share(exp)}</small></dd></div>
            {proposed > 0 && <div className="muted"><dt>{t("Honoraires proposés, sans réponse")}</dt><dd>{fmtEur(locale, proposed)}</dd></div>}
            {budget != null && <div className={`total${over ? " over" : ""}`}><dt>{over ? t("Dépassement") : t("Reste disponible")}</dt><dd>{fmtEur(locale, Math.abs(budget - total))}</dd></div>}
          </dl>
          {canEdit && (
            <details className="inline-edit" open={budget == null}>
              <summary>{budget != null ? t("Modifier le budget") : t("Renseigner le budget")}</summary>
              <BudgetForm orgId={orgId} projectId={projectId} budgetCents={budget} />
            </details>
          )}
        </section>
      </aside>
    </div>
  );
}

export async function MaterialsPanel({ orgId, projectId, canSubmit, canReview }: { orgId: string; projectId: string; canSubmit: boolean; canReview: boolean }) {
  const materials = await db.material.findMany({ where: { projectId }, include: { versions: { orderBy: { version: "desc" } } }, orderBy: { createdAt: "asc" } });
  const users = await db.user.findMany({ where: { id: { in: [...new Set(materials.flatMap((m) => m.versions.flatMap((v) => [v.submittedById, v.reviewerId ?? ""])))] } }, select: { id: true, firstName: true, lastName: true } });
  const who = (id: string | null) => { const u = users.find((x) => x.id === id); return u ? `${u.firstName} ${u.lastName}` : "—"; };
  const { t, locale } = await getT();
  // Quatre yeux : la personne qui a soumis une version ne l'approuve pas (sauf seule habilitée, avec justification).
  const me = (await getCurrentUser())?.id ?? "";
  const ownRule = canReview && me ? await fourEyes(new Set([me]), orgId, me, REVIEW_ROLES) : "ok";
  return (
    <section className="card" aria-labelledby={`supports-${projectId}`}>
      <SectionHead icon={FileCheck} id={`supports-${projectId}`} title={t("Supports et relecture")} desc={t("Présentations et documents des experts, relus avant diffusion.")}>
        {canSubmit && <MaterialForm projectId={projectId} kinds={MATERIAL_KINDS} />}
      </SectionHead>
      {materials.length === 0 && <p className="muted">{t("Aucun support soumis. Les supports présentés par les experts doivent être relus avant diffusion.")}</p>}
      <div className="stack">
        {materials.map((m) => {
          const last = m.versions[0];
          return (
            <div key={m.id} className="material">
              <div className="flex-between">
                <span><strong>{m.title}</strong> <span className="tag tag-sm">{t(MATERIAL_KINDS[m.kind as keyof typeof MATERIAL_KINDS] ?? m.kind)}</span></span>
                <span className={`pill ${last.status === "approved" ? "ok" : last.status === "changes" ? "bad" : "wait"}`}>v{last.version} · {t(MATERIAL_STATUS[last.status as keyof typeof MATERIAL_STATUS] ?? "")}</span>
              </div>
              <ol className="version-list">
                {m.versions.map((v) => (
                  <li key={v.id}>
                    <span className="text-xs">v{v.version} · {who(v.submittedById)} · {fmtDate(locale, v.createdAt)}</span>
                    {v.url && <a href={v.url} target="_blank" rel="noreferrer" className="text-sm"><ExternalLink size={12} /> {t("Ouvrir le document")}</a>}
                    {v.notes && <p className="text-sm">{v.notes}</p>}
                    {v.reviewedAt && (
                      <p className={`review ${v.status}`}>
                        {t(
                          v.status === "approved"
                            ? v.reviewComment ? "Approuvé par {name} le {date} : « {comment} »" : "Approuvé par {name} le {date}"
                            : v.reviewComment ? "Modifications demandées par {name} le {date} : « {comment} »" : "Modifications demandées par {name} le {date}",
                          { name: who(v.reviewerId), date: fmtDate(locale, v.reviewedAt), comment: v.reviewComment },
                        )}
                      </p>
                    )}
                    {canReview && v.status === "submitted" && (() => {
                      const own = v.submittedById === me;
                      if (own && ownRule === "blocked") return <p className="hint mt-2">{t(FOUR_EYES_BLOCKED)}</p>;
                      return (
                        <form action={reviewMaterial} className="inline wrap mt-2">
                          <input type="hidden" name="orgId" value={orgId} /><input type="hidden" name="versionId" value={v.id} />
                          <input name="comment" required={own} placeholder={own ? t("Justification obligatoire (support que vous avez soumis)") : t("Commentaire (obligatoire pour demander des modifications)")} style={{ width: 320 }} />
                          <button className="btn small" name="decision" value="approve">{t("Approuver")}</button>
                          <button className="btn ghost small" name="decision" value="changes">{t("Demander des modifications")}</button>
                        </form>
                      );
                    })()}
                  </li>
                ))}
              </ol>
              {canSubmit && last.status === "changes" && <VersionForm materialId={m.id} />}
            </div>
          );
        })}
      </div>
    </section>
  );
}

const KIND_LABEL = { CONVENTION_SIGNEE: "Convention signée", PIECE: "Pièce", AUTORISATION_CUMUL: "Autorisation de cumul" } as const;
const fileSize = (n: number, t: T, locale: Locale) => {
  if (n < 1024 * 1024) return t("{n} Ko", { n: Math.max(1, Math.round(n / 1024)) });
  const mb = (n / 1024 / 1024).toFixed(1);
  return t("{n} Mo", { n: locale === "en" ? mb : mb.replace(".", ",") });
};

/**
 * Documents du dossier. Côté organisation : tous les documents, dépôt pour un expert ou pour tout le dossier.
 * Côté expert (`linkId`) : les documents qui le concernent, et dépôt de sa convention signée ou d'une pièce.
 */
export async function DocumentsPanel({ projectId, linkId, canUpload, openUpload = false }: { projectId: string; linkId?: string; canUpload: boolean; openUpload?: boolean }) {
  const project = await db.project.findUnique({
    where: { id: projectId },
    include: {
      documents: { where: linkId ? { projectExpertId: linkId } : {}, orderBy: { createdAt: "desc" } },
      experts: { where: { status: { notIn: ["ATT_EXPERTS", "DECLINE"] } }, include: { practitioner: { include: { user: { select: { firstName: true, lastName: true } } } } } },
    },
  });
  if (!project) return null;
  const enabled = storageEnabled();
  const { t, locale } = await getT();
  const expertName = new Map(project.experts.map((e) => [e.id, `${drPrefix(e.practitioner.profession)}${e.practitioner.user.firstName} ${e.practitioner.user.lastName}`]));
  const locked = ["SIGNE", "TERMINE"].includes(project.status);
  // Agents publics (France) : leur autorisation de cumul se dépose ici, avant la déclaration ou la demande à l'Ordre.
  const agents = project.experts.filter((e) => e.practitioner.publicAgent && e.practitioner.country === "FR" && (!linkId || e.id === linkId));
  const cumulMissing = agents.filter((e) => !project.documents.some((d) => d.kind === "AUTORISATION_CUMUL" && d.projectExpertId === e.id));
  const cumulPending = cumulMissing.length > 0 && ["ACCORD", "EN_VALID", "BLOQUE", "VALIDE"].includes(project.status);
  return (
    <section className="card stack-sm" aria-labelledby={`documents-${projectId}`}>
      <SectionHead icon={FileText} id={`documents-${projectId}`} title={t("Documents")} desc={linkId ? t("Votre convention signée et les pièces de la collaboration.") : t("Conventions signées déposées et pièces du dossier.")} />
      {cumulPending && (
        <p className="notice warn">
          {linkId
            ? t("Vous exercez comme agent public : déposez l'autorisation de cumul d'activités de votre employeur (ou l'accusé de votre déclaration). L'organisation la joint à la convention transmise à l'Ordre.")
            : t("Autorisation de cumul à joindre avant la déclaration ou la demande à l'Ordre (expert agent public) : {names}.", { names: cumulMissing.map((e) => expertName.get(e.id)).join(", ") })}
        </p>
      )}
      {project.documents.length === 0 ? <p className="muted">{t("Aucun document déposé.")}</p> : (
        <ul className="pub-list">
          {project.documents.map((d) => (
            <li key={d.id} className="flex-between">
              <span>
                <a href={`/documents/${d.id}`}><strong>{d.name}</strong></a>
                <span className="text-xs">
                  {t(KIND_LABEL[d.kind])}{d.projectExpertId && !linkId ? ` · ${expertName.get(d.projectExpertId) ?? "expert"}` : ""} · {fileSize(d.size, t, locale)} · {fmtDate(locale, d.createdAt)}
                </span>
              </span>
              {canUpload && !(d.kind === "CONVENTION_SIGNEE" && locked) && (
                <form action={deleteDocument}><input type="hidden" name="documentId" value={d.id} /><button className="link danger">{t("Retirer")}</button></form>
              )}
            </li>
          ))}
        </ul>
      )}
      {canUpload && (enabled ? (
        linkId ? (
          <details className="disclosure" open={openUpload || cumulPending}>
            <summary>{t("Déposer un document")}</summary>
            <DocumentUploadForm projectId={projectId} ownLinkId={linkId} experts={[]} cumul={agents.length > 0} defaultKind={project.status === "SIGNATURE" ? "CONVENTION_SIGNEE" : cumulPending ? "AUTORISATION_CUMUL" : "PIECE"} />
          </details>
        ) : (
          // Côté organisation, le formulaire reste replié sauf quand des conventions signées sont attendues.
          <details className="disclosure" open={openUpload}>
            <summary>{t("Déposer un document")}</summary>
            <DocumentUploadForm projectId={projectId} experts={project.experts.map((e) => ({ id: e.id, name: expertName.get(e.id)! }))} cumul={agents.length > 0} defaultKind={project.status === "SIGNATURE" ? "CONVENTION_SIGNEE" : cumulPending ? "AUTORISATION_CUMUL" : "PIECE"} />
          </details>
        )
      ) : (
        <p className="hint">{t("Le dépôt de documents sera disponible une fois le stockage configuré.")}</p>
      ))}
    </section>
  );
}

const SIGNATURE_TONE = { draft: "wait", ongoing: "wait", done: "ok", declined: "bad", expired: "done", canceled: "done" } as const;

/**
 * Signature électronique de la convention d'un expert, côté organisation : envoi (dossier « En signature »),
 * suivi, mise à jour du statut et téléchargement de la convention signée. Rien sans Yousign configuré ni demande passée.
 * Une convention signée déposée à la main clôt la demande (plus d'envoi proposé).
 */
export async function ConventionSignatureBlock({ orgId, linkId, signature, projectStatus, canSend, deposited = false }: {
  orgId: string; linkId: string; signature: ConventionSignature | null; projectStatus: ProjectStatus; canSend: boolean; deposited?: boolean;
}) {
  const { t, locale } = await getT();
  const enabled = signatureEnabled();
  const s = signature;
  const sendable = enabled && canSend && projectStatus === "SIGNATURE" && !deposited && canSendAgain(s?.status);
  if (!s && !sendable) return null;
  return (
    <div className="stack-sm mt-3">
      <p className="text-sm">
        <FileSignature size={14} />{" "}{t("Signature électronique")}
        {s && <span className={`pill ${SIGNATURE_TONE[s.status]}`}>{t(SIGNATURE_LABEL[s.status])}</span>}
      </p>
      {s?.status === "ongoing" && (
        <p className="text-xs">{t("Envoyée")}{s.sentAt ? ` ${t("le {date}", { date: fmtDate(locale, s.sentAt) })}` : ""}{" "}{t(": Yousign a écrit à chaque signataire (l'expert et la personne qui a envoyé la convention), qui signe depuis le lien reçu.")}</p>
      )}
      {s?.status === "done" && (
        <p className="text-xs">
          {t("Signée par les deux parties")}{s.completedAt ? ` ${t("le {date}", { date: fmtDate(locale, s.completedAt) })}` : ""}. <a href={`/signatures/${linkId}`}>{t("Convention signée (PDF)")}</a>
        </p>
      )}
      {s?.status === "declined" && <p className="text-xs">{t("Un signataire a refusé de signer")}{s.note ? ` : « ${s.note} »` : ""}.</p>}
      {s?.status === "expired" && <p className="text-xs">{t("La demande a expiré sans être signée.")}</p>}
      {s?.status === "canceled" && <p className="text-xs">{s.note ?? t("La demande a été annulée chez Yousign.")}</p>}
      {s?.status === "draft" && <p className="text-xs">{s.note ? t("L'envoi précédent a échoué.") : t("Envoi en cours ou interrompu.")}</p>}
      {enabled && s?.status === "ongoing" && <RefreshSignatureForm linkId={linkId} />}
      {sendable && <SendSignatureForm orgId={orgId} linkId={linkId} again={!!s && s.status !== "draft"} />}
    </div>
  );
}

/**
 * Côté expert : où en est la signature électronique de sa convention. Une fois la convention signée (dépôt de la
 * convention signée, dossier « Signé »), plus de demande « en attente » : le lien vers la convention signée.
 */
export async function ExpertSignatureBlock({ linkId, signature, email, projectStatus, signedDocId = null }: { linkId: string; signature: ConventionSignature | null; email: string; projectStatus: ProjectStatus; signedDocId?: string | null }) {
  const s = signature;
  const { t, locale } = await getT();
  if (s?.status !== "done" && (signedDocId || ["SIGNE", "TERMINE"].includes(projectStatus)))
    return (
      <p className="notice ok">
        {t("Convention signée.")}{" "}
        {signedDocId && <a href={`/documents/${signedDocId}`}>{t("Convention signée (PDF)")}</a>}
      </p>
    );
  if (!s || s.status === "draft") return null;
  if (s.status === "done")
    return (
      <p className="notice ok">
        {s.completedAt ? t("Convention signée électroniquement par les deux parties le {date}.", { date: fmtDate(locale, s.completedAt) }) : t("Convention signée électroniquement par les deux parties.")}{" "}
        <a href={`/signatures/${linkId}`}>{t("Télécharger la convention signée (PDF)")}</a>
      </p>
    );
  if (s.status === "ongoing")
    return (
      <section className="card highlight stack-sm">
        <SectionHead icon={FileSignature} title={t("Convention en attente de votre signature")} />
        <p>
          {t("Yousign, notre prestataire de signature électronique, vous a envoyé un e-mail à {email} avec le lien pour signer.", { email })}
          {s.sentAt ? ` ${t("Demande du {date}.", { date: fmtDate(locale, s.sentAt) })}` : ""}{" "}
          {t("Un code de vérification vous est adressé par e-mail au moment de signer. Pensez à regarder dans vos courriers indésirables.")}
        </p>
        <p className="text-xs">{t("Si vous avez déjà signé, la convention attend la signature de l'organisation.")}</p>
        {signatureEnabled() && <RefreshSignatureForm linkId={linkId} />}
      </section>
    );
  const msg =
    s.status === "declined"
      ? s.note ? t("La demande de signature électronique de la convention a été refusée (« {note} »).", { note: s.note }) : t("La demande de signature électronique de la convention a été refusée.")
      : s.status === "expired" ? t("La demande de signature électronique de la convention a expiré.") : t("La demande de signature électronique de la convention a été annulée.");
  return <p className="notice warn">{msg} {t("L'organisation peut vous en adresser une nouvelle.")}</p>;
}
