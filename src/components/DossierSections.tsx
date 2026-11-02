import { AlertTriangle, ExternalLink, FileSignature, FileText, Info, ShieldAlert, Wallet } from "lucide-react";
import { db } from "@/lib/db";
import { detectConflicts } from "@/lib/conflicts";
import { formatDate, formatEUR } from "@/lib/events";
import { MATERIAL_KINDS, MATERIAL_STATUS } from "@/lib/projects";
import { reviewMaterial, updateExpense } from "@/lib/dossier-actions";
import { BudgetForm, DocumentUploadForm, ExpenseForm, MaterialForm, RefreshSignatureForm, SendSignatureForm, VersionForm } from "@/components/DossierForms";
import { deleteDocument } from "@/lib/document-actions";
import { storageEnabled } from "@/lib/storage";
import { drPrefix } from "@/lib/professions";
import { fmtDate, type Locale, type T } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import { canSendAgain, SIGNATURE_LABEL, signatureEnabled } from "@/lib/yousign";
import type { ConventionSignature, ProjectStatus } from "@/generated/prisma/client";

export async function ConflictsPanel({ projectId }: { projectId: string }) {
  const conflicts = await detectConflicts(projectId);
  return (
    <section className="card">
      <h2 className="section-title"><ShieldAlert size={15} /> Points d&apos;attention (conflits d&apos;intérêts possibles)</h2>
      {conflicts.length === 0 ? <p className="todo-empty">Aucun point d&apos;attention dans les données KolBase. Les liens d&apos;intérêts noués en dehors de KolBase ne sont pas connus : l&apos;expert les déclare lui-même.</p> : (
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
  const { t, locale } = await getT();
  return (
    <section className="card">
      <div className="flex-between mb-2">
        <h2 className="section-title" style={{ margin: 0 }}>{t("Supports et relecture")}</h2>
        {canSubmit && <MaterialForm projectId={projectId} kinds={MATERIAL_KINDS} />}
      </div>
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
const fileSize = (n: number, t: T, locale: Locale) => {
  if (n < 1024 * 1024) return t("{n} Ko", { n: Math.max(1, Math.round(n / 1024)) });
  const mb = (n / 1024 / 1024).toFixed(1);
  return t("{n} Mo", { n: locale === "en" ? mb : mb.replace(".", ",") });
};

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
  const { t, locale } = await getT();
  const expertName = new Map(project.experts.map((e) => [e.id, `${drPrefix(e.practitioner.profession)}${e.practitioner.user.firstName} ${e.practitioner.user.lastName}`]));
  const locked = ["SIGNE", "TERMINE"].includes(project.status);
  return (
    <section className="card stack-sm">
      <h2 className="section-title"><FileText size={15} /> Documents</h2>
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
        <DocumentUploadForm projectId={projectId} ownLinkId={linkId} experts={project.experts.map((e) => ({ id: e.id, name: expertName.get(e.id)! }))} />
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
 */
export function ConventionSignatureBlock({ orgId, linkId, signature, projectStatus, canSend }: {
  orgId: string; linkId: string; signature: ConventionSignature | null; projectStatus: ProjectStatus; canSend: boolean;
}) {
  const enabled = signatureEnabled();
  const s = signature;
  const sendable = enabled && canSend && projectStatus === "SIGNATURE" && canSendAgain(s?.status);
  if (!s && !sendable) return null;
  return (
    <div className="stack-sm mt-3">
      <p className="text-sm">
        <FileSignature size={14} /> Signature électronique{" "}
        {s && <span className={`pill ${SIGNATURE_TONE[s.status]}`}>{SIGNATURE_LABEL[s.status]}</span>}
      </p>
      {s?.status === "ongoing" && (
        <p className="text-xs">Envoyée{s.sentAt ? ` le ${formatDate(s.sentAt)}` : ""} : Yousign a écrit à chaque signataire (l&apos;expert et la personne qui a envoyé la convention), qui signe depuis le lien reçu.</p>
      )}
      {s?.status === "done" && (
        <p className="text-xs">
          Signée par les deux parties{s.completedAt ? ` le ${formatDate(s.completedAt)}` : ""}. <a href={`/signatures/${linkId}`}>Convention signée (PDF)</a>
        </p>
      )}
      {s?.status === "declined" && <p className="text-xs">Un signataire a refusé de signer{s.note ? ` : « ${s.note} »` : ""}.</p>}
      {s?.status === "expired" && <p className="text-xs">La demande a expiré sans être signée.</p>}
      {s?.status === "canceled" && <p className="text-xs">La demande a été annulée chez Yousign.</p>}
      {s?.status === "draft" && <p className="text-xs">{s.note ? "L'envoi précédent a échoué." : "Envoi en cours ou interrompu."}</p>}
      {enabled && s?.status === "ongoing" && <RefreshSignatureForm linkId={linkId} />}
      {sendable && <SendSignatureForm orgId={orgId} linkId={linkId} again={!!s && s.status !== "draft"} />}
    </div>
  );
}

/** Côté expert : où en est la signature électronique de sa convention. */
export async function ExpertSignatureBlock({ linkId, signature, email }: { linkId: string; signature: ConventionSignature | null; email: string }) {
  const s = signature;
  if (!s || s.status === "draft") return null;
  const { t, locale } = await getT();
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
        <h2 className="section-title"><FileSignature size={15} /> {t("Convention en attente de votre signature")}</h2>
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
