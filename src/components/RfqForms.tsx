"use client";

import { useActionState, useState } from "react";
import { Check, Plus, Send } from "lucide-react";
import { createRfq, postRfqMessage, submitQuote, updateSupplierProfile } from "@/lib/rfq-actions";
import { createMandate } from "@/lib/event-actions";
import { Notice } from "@/components/AuthForms";
import { VAT_OPTIONS } from "@/lib/quotes";
import { Avatar } from "@/components/Avatar";

type Cat = { id: string; label: string };
type Supplier = { id: string; name: string; categories: string[]; city: string | null; coverage: string | null; about: string | null; since: number };
type EventOpt = { id: string; label: string; city: string | null; capacity: number | null };

export function SupplierLine({ s, catLabel, selected, onToggle }: { s: Supplier; catLabel: string; selected?: boolean; onToggle?: () => void }) {
  return (
    <div className={`supplier${selected ? " selected" : ""}`}>
      <Avatar name={s.name} size={38} square />
      <div className="supplier-body">
        <div><strong>{s.name}</strong> <span className="pill electric">Référencé</span></div>
        <div className="muted">{catLabel}{s.coverage ? ` · ${s.coverage}` : s.city ? ` · ${s.city}` : ""} · référencé depuis {s.since}</div>
        {!onToggle && s.about && <p>{s.about}</p>}
      </div>
      {onToggle && (
        <button type="button" className={selected ? "btn small" : "btn ghost small"} onClick={onToggle}>
          {selected ? <><Check size={13} /> Sélectionné</> : <><Plus size={13} /> Consulter</>}
        </button>
      )}
    </div>
  );
}

export function NewRfqForm({ orgId, categories, suppliers, events, defaultEventId, defaultCategory }: { orgId: string; categories: Cat[]; suppliers: Supplier[]; events: EventOpt[]; defaultEventId?: string; defaultCategory?: string }) {
  const [state, action, pending] = useActionState(createRfq, undefined);
  const [category, setCategory] = useState(categories.some((c) => c.id === defaultCategory) ? defaultCategory! : categories[0].id);
  const [picked, setPicked] = useState<string[]>([]);
  const [eventId, setEventId] = useState(defaultEventId ?? "");
  const ev = events.find((e) => e.id === eventId);
  const matching = suppliers.filter((s) => s.categories.includes(category));
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  return (
    <form action={action} className="card form">
      <h2>Nouvelle demande de devis</h2>
      <p className="muted">Consultez en une fois les prestataires référencés. Ils répondent directement sur KolBase, depuis leur espace prestataire.</p>
      <Notice state={state} />
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="category" value={category} />
      {picked.map((id) => <input key={id} type="hidden" name="supplierIds" value={id} />)}
      <label>Événement concerné
        <select name="eventId" value={eventId} onChange={(e) => setEventId(e.target.value)}>
          <option value="">— aucun —</option>
          {events.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
        </select>
      </label>
      <span className="label">Type de prestation</span>
      <div className="chips">
        {categories.map((c) => (
          <button key={c.id} type="button" className={`chip${c.id === category ? " active" : ""}`} onClick={() => { setCategory(c.id); setPicked([]); }}>{c.label}</button>
        ))}
      </div>
      <span className="label flex-between">
        <span>Prestataires à consulter — {picked.length} sélectionné{picked.length > 1 ? "s" : ""}</span>
        <SelectAll count={matching.length} all={matching.length > 0 && matching.every((m) => picked.includes(m.id))} onAll={() => setPicked(matching.every((m) => picked.includes(m.id)) ? [] : matching.map((m) => m.id))} />
      </span>
      <div className="stack-sm">
        {matching.map((s) => <SupplierLine key={s.id} s={s} catLabel={categories.find((c) => c.id === category)!.label} selected={picked.includes(s.id)} onToggle={() => toggle(s.id)} />)}
        {matching.length === 0 && <p className="muted">Aucun prestataire référencé dans cette catégorie pour l&apos;instant.</p>}
      </div>
      <label>Besoin<textarea name="needs" rows={3} required placeholder="Prestations attendues, contraintes horaires, niveau de service…" /></label>
      <div className="row">
        <label>Participants attendus<input key={eventId} name="headcount" type="number" min={1} defaultValue={ev?.capacity ?? undefined} placeholder="Selon l'événement" /></label>
        <label>Réponse attendue avant<input name="deadline" type="date" /></label>
      </div>
      <div className="actions">
        <button className="btn" name="intent" value="send" disabled={pending || picked.length === 0}><Send size={14} /> {picked.length > 1 ? `Envoyer aux ${picked.length} prestataires` : "Envoyer au prestataire"}</button>
        <button className="btn ghost" name="intent" value="draft" disabled={pending || picked.length === 0}>Enregistrer en brouillon</button>
      </div>
    </form>
  );
}

type QuoteCurrent = { amount: string; delay: string; note: string; lines: { label: string; qty: number; unit: string }[]; vatBp: number; validUntil: string; conditions: string; revision: number; fileName: string | null };
type Row = { key: number; label: string; qty: string; unit: string };

const eur = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
const num = (v: string) => { const n = Number(v.replace(/\s/g, "").replace(",", ".")); return Number.isFinite(n) ? n : 0; };

/** Devis du prestataire : détail ligne par ligne (total calculé), TVA, validité, conditions et PDF signé. */
export function QuoteForm({ orgId, rfqId, current, headcount, uploads }: { orgId: string; rfqId: string; current?: QuoteCurrent; headcount: number | null; uploads: boolean }) {
  const [state, action, pending] = useActionState(submitQuote, undefined);
  const [open, setOpen] = useState(!current);
  const [rows, setRows] = useState<Row[]>(
    current?.lines.length ? current.lines.map((l, i) => ({ key: i, label: l.label, qty: String(l.qty), unit: l.unit })) : [{ key: 0, label: "", qty: "1", unit: "" }],
  );
  const [vat, setVat] = useState(current?.vatBp ?? 2000);
  if (!open) return <button type="button" className="btn ghost small" onClick={() => setOpen(true)}>Réviser mon devis</button>;
  const detailed = rows.some((r) => r.label || r.unit);
  const ht = rows.reduce((s, r) => s + num(r.qty) * num(r.unit), 0);
  const ttc = ht * (1 + vat / 10000);
  const update = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  return (
    <form action={action} className="form quote-form">
      <Notice state={state} />
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="rfqId" value={rfqId} />
      <span className="label">Détail de la proposition</span>
      <div className="quote-lines" role="table" aria-label="Lignes du devis">
        <div className="quote-line head" role="row"><span>Désignation</span><span>Qté</span><span>Prix unitaire HT</span><span>Total HT</span><span /></div>
        {rows.map((r) => (
          <div key={r.key} className="quote-line" role="row">
            <input name="line_label" value={r.label} onChange={(e) => update(r.key, { label: e.target.value })} placeholder="Cocktail dînatoire 12 pièces" aria-label="Désignation" />
            <input name="line_qty" value={r.qty} onChange={(e) => update(r.key, { qty: e.target.value })} inputMode="decimal" aria-label="Quantité" />
            <input name="line_unit" value={r.unit} onChange={(e) => update(r.key, { unit: e.target.value })} inputMode="decimal" placeholder="0,00" aria-label="Prix unitaire HT" />
            <span className="mono">{eur(num(r.qty) * num(r.unit))}</span>
            <button type="button" className="link danger" aria-label="Retirer la ligne" onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : [{ key: Date.now(), label: "", qty: "1", unit: "" }]))}>×</button>
          </div>
        ))}
        <button type="button" className="link" onClick={() => setRows((rs) => [...rs, { key: Date.now(), label: "", qty: "1", unit: "" }])}><Plus size={13} /> Ajouter une ligne</button>
      </div>
      {!detailed && (
        <label>Ou montant global (€ HT)<input name="amount" inputMode="decimal" defaultValue={current?.lines.length ? "" : current?.amount} /></label>
      )}
      <div className="row">
        <label>TVA
          <select name="vat" value={vat} onChange={(e) => setVat(Number(e.target.value))}>
            {VAT_OPTIONS.map((v) => <option key={v.bp} value={v.bp}>{v.label}</option>)}
          </select>
        </label>
        <label>Offre valable jusqu&apos;au<input name="validUntil" type="date" defaultValue={current?.validUntil} /></label>
      </div>
      {detailed && (
        <div className="quote-totals">
          <span>Total HT <strong>{eur(ht)}</strong></span>
          <span>TTC <strong>{eur(ttc)}</strong></span>
          {headcount ? <span>Par participant <strong>{eur(ttc / headcount)}</strong> TTC</span> : null}
        </div>
      )}
      <div className="row">
        <label>Délai / disponibilité<input name="delay" defaultValue={current?.delay} placeholder="Confirmation sous 48 h" /></label>
        <label>Conditions<input name="conditions" defaultValue={current?.conditions} placeholder="Acompte 30 %, annulation sans frais jusqu'à J-15…" /></label>
      </div>
      <label>Présentation de l&apos;offre<textarea name="note" rows={2} defaultValue={current?.note} placeholder="Ce qui est inclus, options, références…" /></label>
      {uploads && (
        <label>Devis signé (PDF, facultatif){current?.fileName ? <span className="hint"> Actuel : {current.fileName}</span> : null}
          <input name="file" type="file" accept="application/pdf" />
        </label>
      )}
      <button className="btn" disabled={pending}><Send size={14} /> {pending ? "Envoi…" : current ? `Envoyer la version ${current.revision + 1}` : "Envoyer le devis"}</button>
    </form>
  );
}

/** Sélection rapide de tous les prestataires de la catégorie (le choix reste modifiable un par un). */
export function SelectAll({ count, all, onAll }: { count: number; all: boolean; onAll: () => void }) {
  if (count < 2) return null;
  return <button type="button" className="link" onClick={onAll}>{all ? "Tout désélectionner" : `Consulter les ${count} prestataires de la catégorie`}</button>;
}

export function SupplierProfileForm({ orgId, categories, current, canEdit }: { orgId: string; categories: Cat[]; current: { categories: string[]; coverage: string; listed: boolean }; canEdit: boolean }) {
  const [state, action, pending] = useActionState(updateSupplierProfile, undefined);
  return (
    <form action={action} className="card form">
      <h2>Fiche prestataire</h2>
      <p className="muted">Les organisations consultent l&apos;annuaire par catégorie. Être référencé ne donne aucune priorité : elles choisissent librement qui consulter.</p>
      <Notice state={state} />
      <input type="hidden" name="orgId" value={orgId} />
      <span className="label">Catégories de prestation</span>
      <div className="checks">
        {categories.map((c) => (
          <label key={c.id} className="check"><input type="checkbox" name="categories" value={c.id} defaultChecked={current.categories.includes(c.id)} disabled={!canEdit} /> {c.label}</label>
        ))}
      </div>
      <label>Zone couverte<input name="coverage" defaultValue={current.coverage} placeholder="France entière, Grand Ouest…" disabled={!canEdit} /></label>
      <label className="check"><input type="checkbox" name="listed" defaultChecked={current.listed} disabled={!canEdit} /> Apparaître dans l&apos;annuaire des prestataires</label>
      {canEdit && <button className="btn" disabled={pending}>{pending ? "Enregistrement…" : "Enregistrer"}</button>}
    </form>
  );
}

/** Mandater une agence prestataire référencée. */
export function MandateForm({ orgId, agencies }: { orgId: string; agencies: { id: string; name: string; detail: string }[] }) {
  const [state, action, pending] = useActionState(createMandate, undefined);
  return (
    <form action={action} className="card form">
      <h2>Mandater une agence</h2>
      <p className="muted">Une agence mandatée gère les événements que vous lui confiez : ses collaborateurs, invités avec le rôle « Agence mandatée », ne voient que ces événements.</p>
      <Notice state={state} />
      <input type="hidden" name="orgId" value={orgId} />
      <label>Agence
        <select name="agencyId" required defaultValue="">
          <option value="" disabled>Choisir une agence référencée…</option>
          {agencies.map((a) => <option key={a.id} value={a.id}>{a.name}{a.detail ? ` — ${a.detail}` : ""}</option>)}
        </select>
      </label>
      <label>Périmètre (facultatif)<input name="scope" placeholder="Logistique des soirées scientifiques 2027…" /></label>
      <button className="btn" disabled={pending || agencies.length === 0}>{pending ? "…" : "Mandater"}</button>
    </form>
  );
}

/** Question ou réponse dans le fil privé d'une demande de devis (demandeur ↔ prestataire). */
export function RfqMessageForm({ orgId, rfqId, supplierId, placeholder }: { orgId: string; rfqId: string; supplierId: string; placeholder: string }) {
  const [state, action, pending] = useActionState(postRfqMessage, undefined);
  return (
    <form action={action} className="stack-sm" key={state?.ok ? Date.now() : "rfq-msg"}>
      {state?.error && <Notice state={state} />}
      <div className="composer">
        <textarea name="body" rows={2} placeholder={placeholder} aria-label={placeholder} required maxLength={4000} />
        <input type="hidden" name="orgId" value={orgId} />
        <input type="hidden" name="rfqId" value={rfqId} />
        <input type="hidden" name="supplierId" value={supplierId} />
        <button className="btn small" disabled={pending}>{pending ? "Envoi…" : "Envoyer"}</button>
      </div>
    </form>
  );
}
