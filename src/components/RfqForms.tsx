"use client";

import { useActionState, useState } from "react";
import { Check, Plus, Send } from "lucide-react";
import { createRfq, submitQuote, updateSupplierProfile } from "@/lib/rfq-actions";
import { Notice } from "@/components/AuthForms";
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

export function NewRfqForm({ orgId, categories, suppliers, events, defaultEventId }: { orgId: string; categories: Cat[]; suppliers: Supplier[]; events: EventOpt[]; defaultEventId?: string }) {
  const [state, action, pending] = useActionState(createRfq, undefined);
  const [category, setCategory] = useState(categories[0].id);
  const [picked, setPicked] = useState<string[]>([]);
  const matching = suppliers.filter((s) => s.categories.includes(category));
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  return (
    <form action={action} className="card form">
      <h2>Nouvelle demande de devis</h2>
      <p className="muted">Consultez en une fois les prestataires référencés. Ils répondent directement sur Kolbase, depuis leur espace prestataire.</p>
      <Notice state={state} />
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="category" value={category} />
      {picked.map((id) => <input key={id} type="hidden" name="supplierIds" value={id} />)}
      <label>Événement concerné
        <select name="eventId" defaultValue={defaultEventId ?? ""}>
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
      <span className="label">Prestataires à consulter — {picked.length} sélectionné{picked.length > 1 ? "s" : ""}</span>
      <div className="stack-sm">
        {matching.map((s) => <SupplierLine key={s.id} s={s} catLabel={categories.find((c) => c.id === category)!.label} selected={picked.includes(s.id)} onToggle={() => toggle(s.id)} />)}
        {matching.length === 0 && <p className="muted">Aucun prestataire référencé dans cette catégorie pour l&apos;instant.</p>}
      </div>
      <label>Besoin<textarea name="needs" rows={3} required placeholder="Prestations attendues, contraintes horaires, niveau de service…" /></label>
      <div className="row">
        <label>Participants attendus<input name="headcount" type="number" min={1} placeholder="Selon l'événement" /></label>
        <label>Réponse attendue avant<input name="deadline" type="date" /></label>
      </div>
      <div className="actions">
        <button className="btn" name="intent" value="send" disabled={pending || picked.length === 0}><Send size={14} /> {picked.length > 1 ? `Envoyer aux ${picked.length} prestataires` : "Envoyer au prestataire"}</button>
        <button className="btn ghost" name="intent" value="draft" disabled={pending || picked.length === 0}>Enregistrer en brouillon</button>
      </div>
    </form>
  );
}

export function QuoteForm({ orgId, rfqId, current }: { orgId: string; rfqId: string; current?: { amount: string; delay: string; note: string } }) {
  const [state, action, pending] = useActionState(submitQuote, undefined);
  const [open, setOpen] = useState(!current);
  if (!open) return <button type="button" className="link" onClick={() => setOpen(true)}>Modifier mon devis</button>;
  return (
    <form action={action} className="form">
      <Notice state={state} />
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="rfqId" value={rfqId} />
      <div className="row">
        <label>Montant (€ HT)<input name="amount" inputMode="decimal" required defaultValue={current?.amount} /></label>
        <label>Délai / disponibilité<input name="delay" defaultValue={current?.delay} placeholder="Confirmation sous 48 h" /></label>
      </div>
      <label>Détail de l&apos;offre<textarea name="note" rows={2} defaultValue={current?.note} placeholder="Ce qui est inclus, options, conditions…" /></label>
      <button className="btn" disabled={pending}><Send size={14} /> {pending ? "Envoi…" : current ? "Mettre à jour le devis" : "Envoyer le devis"}</button>
    </form>
  );
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
