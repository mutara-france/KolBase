import Link from "next/link";
import { Check, Info, Receipt, Send, X } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { Avatar } from "@/components/Avatar";
import { NewRfqForm, SupplierLine } from "@/components/RfqForms";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/orgs";
import { EVENT_MANAGER_ROLES, formatDate, formatEUR } from "@/lib/events";
import { QUOTE_STATUS, RFQ_STATUS, rfqDisplayStatus, SUPPLIER_CATEGORIES, supplierCategoryLabel } from "@/lib/suppliers";
import { awardQuote, cancelRfq, sendRfq } from "@/lib/rfq-actions";

export const metadata = { title: "Prestataires — Kolbase" };

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ onglet?: string; evenement?: string; cat?: string }> }) {
  const { id } = await params;
  const { evenement, cat } = await searchParams;
  const onglet = (await searchParams).onglet ?? (evenement ? "nouvelle" : "demandes");
  const { org } = await requireMembership(id, EVENT_MANAGER_ROLES);

  const [rfqs, suppliersRaw, events] = await Promise.all([
    db.rfq.findMany({
      where: { organizationId: id },
      include: { event: true, suppliers: { include: { supplier: true } }, quotes: { include: { supplier: true }, orderBy: { amountCents: "asc" } } },
      orderBy: { createdAt: "desc" },
    }),
    db.organization.findMany({ where: { kind: "PRESTATAIRE", listed: true, NOT: { supplierCategories: { isEmpty: true } } }, orderBy: { name: "asc" } }),
    db.event.findMany({ where: { organizationId: id, startsAt: { gte: new Date() } }, orderBy: { startsAt: "asc" } }),
  ]);
  const suppliers = suppliersRaw.map((s) => ({ id: s.id, name: s.name, categories: s.supplierCategories, city: s.headquarters, coverage: s.coverage, about: s.about, since: s.createdAt.getFullYear() }));
  const awarded = rfqs.filter((r) => r.status === "awarded");
  const engaged = awarded.reduce((s, r) => s + (r.quotes.find((q) => q.status === "retained")?.amountCents ?? 0), 0);
  const list = cat ? suppliers.filter((s) => s.categories.includes(cat)) : suppliers;
  const tabs = [["demandes", `Demandes de devis (${rfqs.length})`], ["nouvelle", "Nouvelle demande"], ["annuaire", `Annuaire (${suppliers.length})`]] as const;

  return (
    <>
      <SiteHeader />
      <main className="stack">
        <p className="muted"><Link href={`/organisations/${id}`}>{org.name}</Link> / Prestataires</p>
        <h1>Prestataires et devis</h1>
        <div className="stats">
          <div className="card stat"><span className="muted">Demandes en cours</span><strong>{rfqs.filter((r) => r.status === "draft" || r.status === "sent").length}</strong></div>
          <div className="card stat"><span className="muted">Prestations attribuées</span><strong>{awarded.length}</strong></div>
          <div className="card stat"><span className="muted">Budget prestataires engagé</span><strong>{formatEUR(engaged)}</strong></div>
          <div className="card stat"><span className="muted">Prestataires référencés</span><strong>{suppliers.length}</strong></div>
        </div>
        <nav className="tabs">
          {tabs.map(([k, l]) => <Link key={k} href={`?onglet=${k}`} className={k === onglet ? "active" : ""}>{l}</Link>)}
        </nav>

        {onglet === "demandes" && (
          <>
            {rfqs.length === 0 && <div className="card empty"><Receipt size={22} /><p className="muted">Aucune demande de devis.</p></div>}
            {rfqs.map((r) => {
              const st = RFQ_STATUS[rfqDisplayStatus(r)];
              const best = r.quotes.length > 1 ? r.quotes[0].amountCents : null;
              const kept = r.quotes.find((q) => q.status === "retained");
              const pending = r.suppliers.filter((s) => !r.quotes.some((q) => q.supplierId === s.supplierId));
              return (
                <section key={r.id} className="card">
                  <div className="card-head">
                    <div>
                      <div className="eyebrow-sm">{supplierCategoryLabel(r.category)}{r.city ? ` · ${r.city}` : ""}</div>
                      <h2>{r.event?.title ?? "Demande de devis"}</h2>
                      {r.event && <div className="muted">{formatDate(r.event.startsAt)}{r.event.venue ? ` · ${r.event.venue}` : ""}{r.headcount ? ` · ${r.headcount} participants attendus` : ""}</div>}
                    </div>
                    <span className={`pill ${st.tone}`}>{st.label}</span>
                  </div>
                  <p>{r.needs}</p>
                  <div className="kv">
                    <div><span>Prestataires consultés</span><span>{r.suppliers.length}</span></div>
                    <div><span>Devis reçus</span><span>{r.quotes.length}{r.quotes.length ? ` · dès ${formatEUR(r.quotes[0].amountCents)}` : ""}</span></div>
                    <div><span>Réponse attendue</span><span>{r.deadline ? formatDate(r.deadline) : "à définir"}</span></div>
                  </div>
                  {r.quotes.length > 0 && (
                    <div className="quotes">
                      {r.quotes.map((q) => (
                        <div key={q.id} className={`quote${q.amountCents === best ? " best" : ""}`}>
                          <Avatar name={q.supplier.name} size={30} square />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div><strong>{q.supplier.name}</strong>{q.amountCents === best && <span className="pill ok"> Meilleure offre</span>}{q.status !== "submitted" && <span className={`pill ${q.status === "retained" ? "ok" : "done"}`}> {QUOTE_STATUS[q.status]}</span>}</div>
                            <div className="muted">{[q.delay, q.note].filter(Boolean).join(" · ")}</div>
                          </div>
                          <span className="amount">{formatEUR(q.amountCents)}</span>
                          {r.status === "sent" && (
                            <form action={awardQuote}>
                              <input type="hidden" name="orgId" value={id} />
                              <input type="hidden" name="quoteId" value={q.id} />
                              <button className="btn small"><Check size={13} /> Retenir</button>
                            </form>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {r.status === "sent" && pending.length > 0 && (
                    <p className="muted">En attente de réponse : {pending.map((s) => s.supplier.name + (s.declined ? " (a décliné)" : "")).join(", ")}.</p>
                  )}
                  {r.status === "draft" && <p className="muted">Prestataires sélectionnés : {r.suppliers.map((s) => s.supplier.name).join(", ")}.</p>}
                  <div className="actions">
                    {r.status === "draft" && (
                      <form action={sendRfq}>
                        <input type="hidden" name="orgId" value={id} />
                        <input type="hidden" name="rfqId" value={r.id} />
                        <button className="btn"><Send size={14} /> {r.suppliers.length > 1 ? `Envoyer aux ${r.suppliers.length} prestataires` : "Envoyer au prestataire"}</button>
                      </form>
                    )}
                    {(r.status === "draft" || r.status === "sent") && (
                      <form action={cancelRfq}>
                        <input type="hidden" name="orgId" value={id} />
                        <input type="hidden" name="rfqId" value={r.id} />
                        <button className="btn ghost small"><X size={13} /> Annuler la demande</button>
                      </form>
                    )}
                    {kept && <span className="pill ok"><Check size={12} /> Attribué à {kept.supplier.name} — {formatEUR(kept.amountCents)}</span>}
                  </div>
                </section>
              );
            })}
          </>
        )}

        {onglet === "nouvelle" && (
          <NewRfqForm
            orgId={id}
            categories={SUPPLIER_CATEGORIES.map((c) => ({ id: c.id, label: c.label }))}
            suppliers={suppliers}
            events={events.map((e) => ({ id: e.id, label: `${formatDate(e.startsAt)} — ${e.title}`, city: e.city, capacity: e.capacity }))}
            defaultEventId={evenement}
          />
        )}

        {onglet === "annuaire" && (
          <section className="stack">
            <div className="chips">
              <Link href="?onglet=annuaire" className={`chip${!cat ? " active" : ""}`}>Toutes</Link>
              {SUPPLIER_CATEGORIES.map((c) => <Link key={c.id} href={`?onglet=annuaire&cat=${c.id}`} className={`chip${cat === c.id ? " active" : ""}`}>{c.label}</Link>)}
            </div>
            {list.map((s) => <SupplierLine key={s.id} s={s} catLabel={s.categories.map(supplierCategoryLabel).join(", ")} />)}
            {list.length === 0 && <p className="muted">Aucun prestataire référencé dans cette catégorie.</p>}
            <div className="info-note">
              <Info size={15} />
              <span>
                Les prestataires de cet annuaire peuvent rémunérer Kolbase pour leur référencement. Ils ne peuvent ni acheter un meilleur classement, ni être
                présélectionnés à votre place : le choix des prestataires consultés vous appartient entièrement.
              </span>
            </div>
          </section>
        )}
      </main>
    </>
  );
}
