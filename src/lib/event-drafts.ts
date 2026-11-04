import "server-only";
import { db } from "@/lib/db";

/** Compteurs nécessaires pour savoir si un brouillon peut être supprimé. */
export const DRAFT_COUNTS = { _count: { select: { registrations: true, rfqs: true, calls: true, serviceOrders: true } } } as const;

/** Brouillon supprimable : jamais publié (journal d'audit), sans inscrit ni devis, appel ou service rattaché. */
export async function deletableDraft(e: { id: string; publishedAt: Date | null; _count: { registrations: number; rfqs: number; calls: number; serviceOrders: number } }) {
  if (e.publishedAt || e._count.registrations || e._count.rfqs || e._count.calls || e._count.serviceOrders) return false;
  const published = await db.auditLog.count({
    where: { entityType: "Event", entityId: e.id, OR: [{ action: "event.publish" }, { action: "event.create", data: { path: ["publish"], equals: true } }] },
  });
  return published === 0;
}
