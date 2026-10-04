import Link from "next/link";
import { redirect } from "next/navigation";
import { Receipt } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { QuoteForm, SupplierProfileForm } from "@/components/RfqForms";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/orgs";
import { formatDate, formatEUR } from "@/lib/events";
import { QUOTE_STATUS, SUPPLIER_CATEGORIES, supplierCategoryLabel } from "@/lib/suppliers";
import { declineRfq } from "@/lib/rfq-actions";

export const metadata = { title: "Demandes de devis — Kolbase" };

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ onglet?: string }> }) {
  const { id } = await params;
  const { onglet = "en-cours" } = await searchParams;
  const { org, isAdmin } = await requireMembership(id);
  if (org.kind !== "PRESTATAIRE") redirect(`/organisations/${id}`);

  const invites = await db.rfqSupplier.findMany({
    where: { supplierId: id, rfq: { status: { not: "draft" } } },
    include: { rfq: { include: { organization: true, event: true, quotes: { where: { supplierId: id } } } } },
    orderBy: { rfq: { sentAt: "desc" } },
  });
  const todo = invites.filter((i) => i.rfq.status === "sent" && i.rfq.quotes.length === 0 && !i.declined);
  const shown = onglet === "en-cours" ? invites.filter((i) => i.rfq.status === "sent" && !i.declined) : invites;
  const won = invites.filter((i) => i.rfq.quotes[0]?.status === "retained");
  const tabs = [["en-cours", `En cours (${invites.filter((i) => i.rfq.status === "sent" && !i.declined).length})`], ["toutes", `Toutes (${invites.length})`], ["fiche", "Fiche prestataire"]] as const;

  return (
    <>
      <SiteHeader />
      <main className="stack">
        <p className="muted"><Link href={`/organisations/${id}`}>{org.name}</Link> / Demandes de devis</p>
        <h1>Demandes de devis</h1>
        {!org.listed && <p className="notice warn">Votre organisation n&apos;apparaît pas dans l&apos;annuaire des prestataires. Complétez la fiche prestataire pour être consulté.</p>}
        <div className="stats">
          <div className="card stat"><span className="muted">À traiter</span><strong>{todo.length}</strong></div>
          <div className="card stat"><span className="muted">Demandes reçues</span><strong>{invites.length}</strong></div>
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
                    {q && <div><span>Votre devis</span><span>{formatEUR(q.amountCents)} HT</span></div>}
                  </div>
                  {!closed && (
                    <>
                      <QuoteForm orgId={id} rfqId={r.id} current={q ? { amount: String(q.amountCents / 100), delay: q.delay ?? "", note: q.note ?? "" } : undefined} />
                      {!q && !declined && (
                        <form action={declineRfq}>
                          <input type="hidden" name="orgId" value={id} />
                          <input type="hidden" name="rfqId" value={r.id} />
                          <button className="link danger">Décliner la demande</button>
                        </form>
                      )}
                    </>
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
