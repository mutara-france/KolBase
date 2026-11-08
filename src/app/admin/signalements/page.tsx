import Link from "next/link";
import { db } from "@/lib/db";
import { requirePlatformAdmin } from "@/lib/platform";
import { ReportDecisionForm } from "@/components/ModerationForms";
import { restoreReview } from "@/lib/moderation-actions";
import { decisionLabel, isReportTarget, REMOVAL_LABEL, REPORT_TARGETS, reportReasonLabel, targetHref } from "@/lib/moderation";
import { AdminFrame, ADMIN_HOME } from "../_parts/frame";

export const metadata = { title: "Signalements — Administration KolBase" };
export const dynamic = "force-dynamic";

const time = (d: Date) => d.toLocaleString("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

/**
 * Registre des signalements : contenus signalés (profil, page d'organisation, événement, avis), motif, auteur, et
 * décision motivée de l'équipe KolBase (retrait ou sans suite), communiquée aux deux parties.
 */
export default async function Page({ searchParams }: { searchParams: Promise<{ statut?: string }> }) {
  await requirePlatformAdmin();
  const { statut } = await searchParams;
  const closed = statut === "traites";
  const [list, counts] = await Promise.all([
    db.report.findMany({ where: { status: closed ? "closed" : "open" }, include: { reporter: { select: { id: true, firstName: true, lastName: true, email: true } } }, orderBy: { createdAt: closed ? "desc" : "asc" }, take: 200 }),
    db.report.groupBy({ by: ["status"], _count: true }),
  ]);
  const count = (s: string) => counts.find((c) => c.status === s)?._count ?? 0;
  const handlers = await db.user.findMany({ where: { id: { in: [...new Set(list.map((r) => r.handledById).filter((x): x is string => !!x))] } }, select: { id: true, firstName: true, lastName: true } });
  const reviews = await db.supplierReview.findMany({ where: { id: { in: list.filter((r) => r.targetType === "avis").map((r) => r.targetId) } }, select: { id: true, supplierId: true, comment: true, rating: true, hiddenAt: true } });
  return (
    <AdminFrame title="Signalements" desc="Registre des contenus signalés et des décisions de l'équipe KolBase. Chaque décision est motivée et communiquée à l'auteur du signalement et, en cas de retrait, à celui du contenu." crumbs={[ADMIN_HOME]}>
      <nav className="tabs">
        <Link href="/admin/signalements" className={closed ? "" : "active"}>À traiter ({count("open")})</Link>
        <Link href="/admin/signalements?statut=traites" className={closed ? "active" : ""}>Traités ({count("closed")})</Link>
      </nav>
      {list.length === 0 && <p className="muted">{closed ? "Aucun signalement traité." : "Aucun signalement à traiter."}</p>}
      <ul className="plain stack">
        {list.map((r) => {
          const rev = reviews.find((v) => v.id === r.targetId);
          const href = targetHref(r.targetType, r.targetId, { supplierId: rev?.supplierId });
          const by = handlers.find((h) => h.id === r.handledById);
          return (
            <li key={r.id} className="card stack-sm">
              <div className="flex-between">
                <span><span className="tag">{isReportTarget(r.targetType) ? REPORT_TARGETS[r.targetType] : r.targetType}</span> <strong>{href ? <Link href={href}>{r.targetLabel}</Link> : r.targetLabel}</strong></span>
                <span className={`pill ${r.status === "open" ? "wait" : r.decision === "retire" ? "bad" : "done"}`}>{decisionLabel(r.targetType, r.status === "open" ? null : r.decision)}</span>
              </div>
              <p className="text-sm"><strong>{reportReasonLabel(r.reason)}</strong> · {r.details}</p>
              {rev?.comment && <p className="text-sm muted">Avis en cause ({rev.rating}/5) : « {rev.comment} »</p>}
              <p className="text-xs muted">
                Signalé le {time(r.createdAt)} par {r.reporter ? <Link href={`/admin/comptes/${r.reporter.id}`}>{r.reporter.firstName} {r.reporter.lastName}</Link> : (r.reporterEmail ?? "—")}
                {r.handledAt ? ` · décision du ${time(r.handledAt)}${by ? ` par ${by.firstName} ${by.lastName}` : ""}` : ""}
              </p>
              {r.decisionNote && <p className="text-sm">Motif : {r.decisionNote}</p>}
              {r.status === "open" && isReportTarget(r.targetType) && <ReportDecisionForm reportId={r.id} removal={REMOVAL_LABEL[r.targetType]} />}
              {r.status === "closed" && rev?.hiddenAt && (
                <form action={restoreReview}>
                  <input type="hidden" name="reviewId" value={rev.id} />
                  <button className="btn ghost small">Rétablir l&apos;avis (contestation fondée)</button>
                </form>
              )}
            </li>
          );
        })}
      </ul>
    </AdminFrame>
  );
}
