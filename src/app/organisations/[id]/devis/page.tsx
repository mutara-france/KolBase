import Link from "next/link";
import { redirect } from "next/navigation";
import { Receipt } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { QuoteForm, RfqMessageForm, SupplierProfileForm } from "@/components/RfqForms";
import { Thread } from "@/components/ProjectBits";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/orgs";
import { formatDate, formatEUR } from "@/lib/events";
import { QUOTE_STATUS, SUPPLIER_CATEGORIES, supplierCategoryLabel } from "@/lib/suppliers";
import { declineRfq } from "@/lib/rfq-actions";
import { readLines, withVat } from "@/lib/quotes";
import { storageEnabled } from "@/lib/storage";

export const metadata = { title: "Demandes de devis — KolBase" };

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ onglet?: string }> }) {
  const { id } = await params;
  const { onglet = "en-cours" } = await searchParams;
  const { org, isAdmin, user } = await requireMembership(id);
  if (org.kind !== "PRESTATAIRE") redirect(`/organisations/${id}`);

  const invites = await db.rfqSupplier.findMany({
    where: { supplierId: id, rfq: { status: { not: "draft" } } },
    include: {
      rfq: {
        include: {
          organization: true, event: true, quotes: { where: { supplierId: id } },
          messages: { where: { supplierId: id }, include: { author: { select: { firstName: true, lastName: true } } }, orderBy: { createdAt: "asc" } },
        },
      },
    },
    orderBy: { rfq: { sentAt: "desc" } },
  });
  const todo = invites.filter((i) => i.rfq.status === "sent" && i.rfq.quotes.length === 0 && !i.declined);
  // En cours : demandes ouvertes, et prestations qui vous sont attribuées (à préparer avec l'organisation).
  const current = invites.filter((i) => (i.rfq.status === "sent" && !i.declined) || (i.rfq.status === "awarded" && i.rfq.quotes[0]?.status === "retained" && (!i.rfq.event || i.rfq.event.startsAt >= new Date())));
  const shown = onglet === "en-cours" ? current : invites;
  const won = invites.filter((i) => i.rfq.quotes[0]?.status === "retained");
  const tabs = [["en-cours", `En cours (${current.length})`], ["toutes", `Toutes (${invites.length})`], ["fiche", "Fiche prestataire"]] as const;

  return (
    <>
      <SiteHeader />
      <main className="stack">
        <h1>Demandes de devis</h1>
        {!org.listed && <p className="notice warn">Votre organisation n&apos;apparaît pas dans l&apos;annuaire des prestataires. Complétez la fiche prestataire pour être consulté.</p>}
        <div className="stats">
          <div className="card stat"><span className="muted">À traiter</span><strong>{todo.length}</strong></div>
          <div className="card stat"><span className="muted">Devis retenus</span><strong>{won.length}</strong></div>
          <div className="card stat"><span className="muted">Montant retenu</span><strong>{formatEUR(won.reduce((s, i) => s + i.rfq.quotes[0].amountCents, 0))}</strong></div>
        </div>
        <nav className="tabs">
          {tabs.map(([k, l]) => <Link key={k} href={`?onglet=${k}`} className={k === onglet ? "active" : ""}>{l}</Link>)}
        </nav>

        {onglet === "fiche" ? (
          <SupplierProfileForm
            orgId={id}
            categories={SUPPLIER_CATEGORIES.map((c) => ({ id: c.id, label: c.label }))}
            current={{ categories: org.supplierCategories, coverage: org.coverage ?? "", listed: org.listed }}
            canEdit={isAdmin}
          />
        ) : (
          <>
            {shown.length === 0 && <div className="card empty"><Receipt size={22} /><p className="muted">Aucune demande {onglet === "en-cours" ? "en cours" : "reçue"}.</p></div>}
            {shown.map(({ rfq: r, declined }) => {
              const q = r.quotes[0];
              const closed = r.status !== "sent";
              return (
                <section key={r.id} className="card">
                  <div className="card-head">
                    <div>
                      <div className="eyebrow-sm">{supplierCategoryLabel(r.category)} · {r.organization.name}</div>
                      <h2>{r.event?.title ?? "Demande de devis"}</h2>
                      <div className="muted">
                        {r.event ? `${formatDate(r.event.startsAt)}${r.event.venue ? ` · ${r.event.venue}` : ""}` : ""}
                        {r.city ? ` · ${r.city}` : ""}{r.headcount ? ` · ${r.headcount} participants` : ""}
                      </div>
                    </div>
                    <span className={`pill ${q ? (q.status === "retained" ? "ok" : q.status === "rejected" ? "done" : "electric") : r.status === "cancelled" ? "bad" : declined ? "done" : "wait"}`}>
                      {q ? QUOTE_STATUS[q.status] : r.status === "cancelled" ? "Annulée" : r.status === "awarded" ? "Attribuée à un autre prestataire" : declined ? "Déclinée" : "Devis attendu"}
                    </span>
                  </div>
                  <p>{r.needs}</p>
                  <div className="kv">
                    <div><span>Reçue le</span><span>{r.sentAt ? formatDate(r.sentAt) : "—"}</span></div>
                    <div><span>Réponse attendue</span><span>{r.deadline ? formatDate(r.deadline) : "à définir"}</span></div>
                    {q && <div><span>Votre devis{q.revision > 1 ? ` (version ${q.revision})` : ""}</span><span>{formatEUR(q.amountCents)} HT · {formatEUR(withVat(q.amountCents, q.vatBp))} TTC</span></div>}
                  </div>
                  {!closed && (
                    <>
                      <QuoteForm
                        orgId={id}
                        rfqId={r.id}
                        category={r.category}
                        headcount={r.headcount}
                        uploads={storageEnabled()}
                        current={q ? {
                          amount: String(q.amountCents / 100), delay: q.delay ?? "", note: q.note ?? "", conditions: q.conditions ?? "", vatBp: q.vatBp, revision: q.revision, fileName: q.fileName,
                          validUntil: q.validUntil ? q.validUntil.toISOString().slice(0, 10) : "",
                          lines: readLines(q.lines).map((l) => ({ label: l.label, qty: l.qty, unit: String(l.unitCents / 100) })),
                        } : undefined}
                      />
                      {!q && !declined && (
                        <form action={declineRfq}>
                          <input type="hidden" name="orgId" value={id} />
                          <input type="hidden" name="rfqId" value={r.id} />
                          <button className="link danger">Décliner la demande</button>
                        </form>
                      )}
                    </>
                  )}
                  {q?.status === "retained" && <p className="notice ok">{r.organization.name} a retenu votre devis. Échangez ci-dessous pour préparer la prestation.</p>}
                  {(r.status === "sent" || (r.status === "awarded" && q?.status === "retained") || r.messages.length > 0) && (
                    <details className="rfq-thread" open={r.messages.length > 0}>
                      <summary>
                        <strong>Questions et échanges avec {r.organization.name}</strong>
                        <span className="muted text-xs">{r.messages.length ? `${r.messages.length} message${r.messages.length > 1 ? "s" : ""}` : "posez une question sur le besoin"}</span>
                        {r.messages.at(-1) && !r.messages.at(-1)!.fromSupplier && <span className="pill electric">Nouveau message</span>}
                      </summary>
                      <Thread messages={r.messages} meId={user.id} />
                      {(r.status === "sent" || q?.status === "retained") && !declined && (
                        <RfqMessageForm orgId={id} rfqId={r.id} supplierId={id} placeholder={`Votre question à ${r.organization.name}…`} />
                      )}
                    </details>
                  )}
                </section>
              );
            })}
          </>
        )}
      </main>
    </>
  );
}
