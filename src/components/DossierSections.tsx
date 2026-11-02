import { AlertTriangle, ExternalLink, FileText, Info, ShieldAlert, Wallet } from "lucide-react";
import { db } from "@/lib/db";
import { detectConflicts } from "@/lib/conflicts";
import { formatDate, formatEUR } from "@/lib/events";
import { MATERIAL_KINDS, MATERIAL_STATUS } from "@/lib/projects";
import { reviewMaterial, updateExpense } from "@/lib/dossier-actions";
import { BudgetForm, DocumentUploadForm, ExpenseForm, MaterialForm, VersionForm } from "@/components/DossierForms";
import { deleteDocument } from "@/lib/document-actions";
import { storageEnabled } from "@/lib/storage";
import { drPrefix } from "@/lib/professions";

export async function ConflictsPanel({ projectId }: { projectId: string }) {
  const conflicts = await detectConflicts(projectId);
  return (
    <section className="card">
      <h2 className="section-title"><ShieldAlert size={15} /> Conflits d&apos;intérêts et points d&apos;attention</h2>
      {conflicts.length === 0 ? <p className="todo-empty">Aucun conflit détecté.</p> : (
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

export async function BudgetPanel({ orgId, projectId, canEdit }: { orgId: string; projectId: string; canEdit: boolean }) {
  const project = await db.project.findUnique({ where: { id: projectId }, include: { experts: { where: { status: { notIn: ["DECLINE"] } } }, expenses: { orderBy: { date: "asc" } } } });
  if (!project) return null;
  const fees = project.experts.reduce((s, e) => s + (e.feeCents ?? 0), 0);
  const exp = project.expenses.reduce((s, e) => s + e.amountCents, 0);
  const total = fees + exp;
  const budget = project.budgetCents;
  const realPct = budget ? Math.round((total / budget) * 100) : null;
  const pct = realPct != null ? Math.min(100, realPct) : null;
  const over = budget != null && total > budget;
  return (
    <section className="card">
      <div className="flex-between mb-2">
        <h2 className="section-title" style={{ margin: 0 }}><Wallet size={15} /> Budget et dépenses</h2>
        {canEdit && <BudgetForm orgId={orgId} projectId={projectId} budgetCents={budget} />}
      </div>
      <div className="stats-row" style={{ marginBottom: 12 }}>
        <div className="stat-card"><div className="stat-value">{budget != null ? formatEUR(budget) : "—"}</div><div className="stat-label">Budget prévu (HT)</div></div>
        <div className="stat-card"><div className="stat-value">{formatEUR(fees)}</div><div className="stat-label">Honoraires des experts</div></div>
        <div className="stat-card"><div className="stat-value">{formatEUR(exp)}</div><div className="stat-label">Autres dépenses</div></div>
        <div className="stat-card"><div className={`stat-value${over ? " tone-danger" : " tone-electric"}`}>{formatEUR(total)}</div><div className="stat-label">Total engagé{realPct != null ? ` · ${realPct} % du budget` : ""}</div></div>
      </div>
      {pct != null && <div className="gauge-track"><div className={`gauge-fill${over ? " over" : ""}`} style={{ width: `${pct}%` }} /></div>}
      {over && <p className="notice error mt-2">Le total engagé dépasse le budget prévu de {formatEUR(total - budget!)}.</p>}
      {project.expenses.length > 0 && (
        <table className="table mt-3">
          <thead><tr><th>Date</th><th>Poste</th><th>Montant</th><th>Statut</th>{canEdit && <th />}</tr></thead>
          <tbody>
            {project.expenses.map((e) => (
              <tr key={e.id}>
                <td>{formatDate(e.date)}</td><td>{e.label}</td><td>{formatEUR(e.amountCents)}</td>
                <td><span className={`pill ${e.status === "payee" ? "ok" : "wait"}`}>{e.status === "payee" ? "Payée" : "Engagée"}</span></td>
                {canEdit && (
                  <td>
                    <form action={updateExpense} className="inline">
                      <input type="hidden" name="orgId" value={orgId} /><input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="expenseId" value={e.id} />
                      {e.status !== "payee" && <button className="link" name="status" value="payee">Marquer payée</button>}
                      <button className="link danger" name="remove" value="1">Retirer</button>
                    </form>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {canEdit && <div className="mt-3"><ExpenseForm orgId={orgId} projectId={projectId} /></div>}
    </section>
  );
}

export async function MaterialsPanel({ orgId, projectId, canSubmit, canReview }: { orgId: string; projectId: string; canSubmit: boolean; canReview: boolean }) {
  const materials = await db.material.findMany({ where: { projectId }, include: { versions: { orderBy: { version: "desc" } } }, orderBy: { createdAt: "asc" } });
  const users = await db.user.findMany({ where: { id: { in: [...new Set(materials.flatMap((m) => m.versions.flatMap((v) => [v.submittedById, v.reviewerId ?? ""])))] } }, select: { id: true, firstName: true, lastName: true } });
  const who = (id: string | null) => { const u = users.find((x) => x.id === id); return u ? `${u.firstName} ${u.lastName}` : "—"; };
  return (
    <section className="card">
      <div className="flex-between mb-2">
        <h2 className="section-title" style={{ margin: 0 }}>Supports et relecture</h2>
        {canSubmit && <MaterialForm projectId={projectId} kinds={MATERIAL_KINDS} />}
      </div>
      {materials.length === 0 && <p className="muted">Aucun support soumis. Les supports présentés par les experts doivent être relus avant diffusion.</p>}
      <div className="stack">
        {materials.map((m) => {
          const last = m.versions[0];
          return (
            <div key={m.id} className="material">
              <div className="flex-between">
                <span><strong>{m.title}</strong> <span className="tag tag-sm">{MATERIAL_KINDS[m.kind as keyof typeof MATERIAL_KINDS] ?? m.kind}</span></span>
                <span className={`pill ${last.status === "approved" ? "ok" : last.status === "changes" ? "bad" : "wait"}`}>v{last.version} · {MATERIAL_STATUS[last.status as keyof typeof MATERIAL_STATUS]}</span>
              </div>
              <ol className="version-list">
                {m.versions.map((v) => (
                  <li key={v.id}>
                    <span className="text-xs">v{v.version} · {who(v.submittedById)} · {formatDate(v.createdAt)}</span>
                    {v.url && <a href={v.url} target="_blank" rel="noreferrer" className="text-sm"><ExternalLink size={12} /> Ouvrir le document</a>}
                    {v.notes && <p className="text-sm">{v.notes}</p>}
                    {v.reviewedAt && <p className={`review ${v.status}`}>{v.status === "approved" ? "Approuvé" : "Modifications demandées"} par {who(v.reviewerId)} le {formatDate(v.reviewedAt)}{v.reviewComment ? ` : « ${v.reviewComment} »` : ""}</p>}
                    {canReview && v.status === "submitted" && (
                      <form action={reviewMaterial} className="inline wrap mt-2">
                        <input type="hidden" name="orgId" value={orgId} /><input type="hidden" name="versionId" value={v.id} />
                        <input name="comment" placeholder="Commentaire (obligatoire pour demander des modifications)" style={{ width: 320 }} />
                        <button className="btn small" name="decision" value="approve">Approuver</button>
                        <button className="btn ghost small" name="decision" value="changes">Demander des modifications</button>
                      </form>
                    )}
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

const KIND_LABEL = { CONVENTION_SIGNEE: "Convention signée", PIECE: "Pièce" } as const;
const fileSize = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} Ko` : `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} Mo`);

/**
 * Documents du dossier. Côté organisation : tous les documents, dépôt pour un expert ou pour tout le dossier.
 * Côté expert (`linkId`) : les documents qui le concernent, et dépôt de sa convention signée ou d'une pièce.
 */
export async function DocumentsPanel({ projectId, linkId, canUpload }: { projectId: string; linkId?: string; canUpload: boolean }) {
  const project = await db.project.findUnique({
    where: { id: projectId },
    include: {
      documents: { where: linkId ? { projectExpertId: linkId } : {}, orderBy: { createdAt: "desc" } },
      experts: { where: { status: { notIn: ["ATT_EXPERTS", "DECLINE"] } }, include: { practitioner: { include: { user: { select: { firstName: true, lastName: true } } } } } },
    },
  });
  if (!project) return null;
  const enabled = storageEnabled();
  const expertName = new Map(project.experts.map((e) => [e.id, `${drPrefix(e.practitioner.profession)}${e.practitioner.user.firstName} ${e.practitioner.user.lastName}`]));
  const locked = ["SIGNE", "TERMINE"].includes(project.status);
  return (
    <section className="card stack-sm">
      <h2 className="section-title"><FileText size={15} /> Documents</h2>
      {project.documents.length === 0 ? <p className="muted">Aucun document déposé.</p> : (
        <ul className="pub-list">
          {project.documents.map((d) => (
            <li key={d.id} className="flex-between">
              <span>
                <a href={`/documents/${d.id}`}><strong>{d.name}</strong></a>
                <span className="text-xs">
                  {KIND_LABEL[d.kind]}{d.projectExpertId && !linkId ? ` · ${expertName.get(d.projectExpertId) ?? "expert"}` : ""} · {fileSize(d.size)} · {formatDate(d.createdAt)}
                </span>
              </span>
              {canUpload && !(d.kind === "CONVENTION_SIGNEE" && locked) && (
                <form action={deleteDocument}><input type="hidden" name="documentId" value={d.id} /><button className="link danger">Retirer</button></form>
              )}
            </li>
          ))}
        </ul>
      )}
      {canUpload && (enabled ? (
        <DocumentUploadForm projectId={projectId} ownLinkId={linkId} experts={project.experts.map((e) => ({ id: e.id, name: expertName.get(e.id)! }))} />
      ) : (
        <p className="hint">Le dépôt de documents sera disponible une fois le stockage configuré.</p>
      ))}
    </section>
  );
}
