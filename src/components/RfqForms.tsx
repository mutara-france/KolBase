"use client";
import { SectionHead } from "@/components/UI";

import { useActionState, useState } from "react";
import { Check, Plus, Send, Star, Store } from "lucide-react";
import { CategoryIcon } from "@/components/SupplierBits";
import { createRfq, postRfqMessage, submitQuote, updateSupplierProfile } from "@/lib/rfq-actions";
import { Notice } from "@/components/AuthForms";
import { ActionForm } from "@/components/ActionForm";
import { BLOCKED_UNTIL, type Blocked } from "@/lib/billing-plans";
import { defaultVatBp, VAT_OPTIONS, vatLabel } from "@/lib/quotes";
import { Avatar } from "@/components/Avatar";
import { AiDraft } from "@/components/AiDraft";
import { useLocale, useT } from "@/components/I18nProvider";
import { intlLocale, type Locale } from "@/lib/i18n/core";

type Cat = { id: string; label: string };
type Supplier = {
  id: string; name: string; categories: string[]; city: string | null; coverage: string | null; about: string | null; since: number; rating?: number | null; reviews?: number;
  logo?: string | null; priceHint?: string | null; from?: string | null;
};
type EventOpt = { id: string; label: string; city: string | null; capacity: number | null; agencyId?: string | null };

/**
 * Prestataire à consulter (nouvelle demande). `eventAgency` : l'agence à qui l'événement choisi est confié. La consulter
 * reste possible (choix conscient du client) ; elle ne verra alors sur la demande que son propre devis.
 */
function SupplierPick({ s, selected, onToggle, eventAgency = false }: { s: Supplier; selected: boolean; onToggle: () => void; eventAgency?: boolean }) {
  const t = useT();
  return (
    <div className={`supplier pick${selected ? " selected" : ""}`}>
      <Avatar name={s.name} size={40} square src={s.logo} />
      <div className="supplier-body">
        <div className="supplier-name">
          <strong>{s.name}</strong>
          {s.rating != null && <span className="rating-badge" title={t("({reviews} avis)", { reviews: s.reviews })}><Star size={11} /> {s.rating.toFixed(1).replace(".", ",")}</span>}
          {eventAgency && <span className="pill wait">{t("Agence de cet événement")}</span>}
        </div>
        <div className="muted text-xs">{[s.coverage ?? s.city, s.from ?? s.priceHint, t("référencé depuis {since}", { since: s.since })].filter(Boolean).join(" · ")}{" · "}<a href={`/structures/${s.id}`} target="_blank" rel="noreferrer">{t("voir la vitrine")}</a></div>
        {eventAgency && (
          <p className="text-xs warn-text">
            {t("L'événement lui est confié : si vous la consultez, elle répond comme les autres prestataires, ne voit sur cette demande que son propre devis, et la décision revient à votre équipe.")}
          </p>
        )}
      </div>
      <button type="button" className={selected ? "btn small" : "btn ghost small"} onClick={onToggle} aria-pressed={selected}>
        {selected ? <><Check size={13} />{" "}{t("Sélectionné")}</> : <><Plus size={13} />{" "}{t("Consulter")}</>}
      </button>
    </div>
  );
}

/** Nouvelle demande en trois étapes (prestation, besoin, prestataires), avec un récapitulatif qui suit la saisie. */
export function NewRfqForm({ orgId, categories, suppliers, events, defaultEventId, defaultCategory, defaultSupplier, defaultNeeds, ai = false, blocked = null }: { orgId: string; categories: Cat[]; suppliers: Supplier[]; events: EventOpt[]; defaultEventId?: string; defaultCategory?: string; defaultSupplier?: string; defaultNeeds?: string; ai?: boolean; blocked?: Blocked }) {
  const t = useT();
  const locale = useLocale();
  const [state, action, pending] = useActionState(createRfq, undefined);
  // Depuis l'annuaire ou la vitrine d'un prestataire : sa catégorie et lui-même déjà choisis.
  const preset = suppliers.find((s) => s.id === defaultSupplier);
  const initialCat = categories.some((c) => c.id === defaultCategory) ? defaultCategory! : preset?.categories[0] ?? categories[0].id;
  const [category, setCategory] = useState(initialCat);
  const [picked, setPicked] = useState<string[]>(preset && preset.categories.includes(initialCat) ? [preset.id] : []);
  const [eventId, setEventId] = useState(defaultEventId ?? "");
  const ev = events.find((e) => e.id === eventId);
  const [headcount, setHeadcount] = useState(ev?.capacity ? String(ev.capacity) : "");
  const [deadline, setDeadline] = useState("");
  const matching = suppliers.filter((s) => s.categories.includes(category));
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const catLabel = categories.find((c) => c.id === category)?.label ?? "";
  const pickedNames = picked.map((id) => suppliers.find((s) => s.id === id)?.name).filter(Boolean) as string[];
  return (
    <ActionForm action={action} className="rfq-new">
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="category" value={category} />
      {picked.map((id) => <input key={id} type="hidden" name="supplierIds" value={id} />)}
      <div className="rfq-new-main">
        <Notice state={state} />
        <section className="card form rfq-step">
          <h2 className="rfq-step-title"><span className="step-num">1</span> {t("La prestation")}</h2>
          <label>{t("Événement concerné")}
            <select name="eventId" value={eventId} onChange={(e) => { setEventId(e.target.value); const c = events.find((x) => x.id === e.target.value)?.capacity; if (c) setHeadcount(String(c)); }}>
              <option value="">{t("— aucun —")}</option>
              {events.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
            </select>
          </label>
          <span className="label">{t("Type de prestation")}</span>
          <div className="chips cat-chips">
            {categories.map((c) => (
              <button key={c.id} type="button" className={`chip chip-icon${c.id === category ? " active" : ""}`} aria-pressed={c.id === category} onClick={() => { setCategory(c.id); setPicked((p) => p.filter((id) => suppliers.find((s) => s.id === id)?.categories.includes(c.id))); }}>
                <CategoryIcon category={c.id} size={13} className="xs" /> {c.label}
              </button>
            ))}
          </div>
        </section>
        <section className="card form rfq-step">
          <h2 className="rfq-step-title"><span className="step-num">2</span> {t("Le besoin")}</h2>
          <label>{t("Besoin")}<textarea name="needs" rows={ai ? 6 : 4} required defaultValue={defaultNeeds} placeholder={t("Prestations attendues, contraintes horaires, niveau de service…")} /></label>
          {defaultNeeds && <p className="hint">{t("Prérempli avec les besoins logistiques exprimés par l'expert : gardez ce qui concerne ce prestataire.")}</p>}
          {ai && <AiDraft kind="besoin" target="needs" label={t("Rédiger le besoin avec l'IA")} />}
          <div className="row">
            <label>{t("Participants attendus")}<input name="headcount" type="number" min={1} value={headcount} onChange={(e) => setHeadcount(e.target.value)} placeholder={t("Selon l'événement")} /></label>
            <label>{t("Réponse attendue avant")}<input name="deadline" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} /></label>
          </div>
        </section>
        <section className="card form rfq-step">
          <div className="flex-between wrap">
            <h2 className="rfq-step-title"><span className="step-num">3</span> {t("Les prestataires à consulter")}</h2>
            <SelectAll count={matching.length} all={matching.length > 0 && matching.every((m) => picked.includes(m.id))} onAll={() => setPicked(matching.every((m) => picked.includes(m.id)) ? [] : matching.map((m) => m.id))} />
          </div>
          <p className="hint">{t("Référencés dans la catégorie « {cat} ». Chacun ne voit que sa propre réponse ; vous comparez tous les devis.", { cat: catLabel })}</p>
          <div className="stack-sm">
            {matching.map((s) => <SupplierPick key={s.id} s={s} selected={picked.includes(s.id)} onToggle={() => toggle(s.id)} eventAgency={!!ev?.agencyId && ev.agencyId === s.id} />)}
            {matching.length === 0 && <p className="muted">{t("Aucun prestataire référencé dans cette catégorie pour l'instant.")}</p>}
          </div>
        </section>
      </div>
      <aside className="card rfq-recap" aria-label={t("Récapitulatif")}>
        <span className="eyebrow-sm">{t("Récapitulatif")}</span>
        <div className="recap-cat"><CategoryIcon category={category} size={18} /> <strong>{catLabel}</strong></div>
        <dl className="recap-list">
          <div><dt>{t("Événement")}</dt><dd>{ev ? ev.label : t("aucun")}</dd></div>
          <div><dt>{t("Participants")}</dt><dd>{headcount || "—"}</dd></div>
          <div><dt>{t("Réponse avant")}</dt><dd>{deadline ? new Date(`${deadline}T12:00`).toLocaleDateString(intlLocale(locale), { day: "numeric", month: "short", year: "numeric" }) : t("sans date")}</dd></div>
          <div><dt>{t("Prestataires consultés")}</dt><dd>{pickedNames.length ? pickedNames.join(", ") : t("à choisir à l'étape 3")}</dd></div>
        </dl>
        <button className="btn" name="intent" value="send" disabled={pending || picked.length === 0 || !!blocked}><Send size={14} /> {picked.length > 1 ? t("Envoyer aux {picked} prestataires", { picked: picked.length }) : t("Envoyer au prestataire")}</button>
        <button className="btn ghost" name="intent" value="draft" disabled={pending || picked.length === 0}>{t("Enregistrer en brouillon")}</button>
        {blocked && <p className="hint">{t("Envoi possible {blocked} ; le brouillon reste possible dès maintenant.", { blocked: t(BLOCKED_UNTIL[blocked]) })}</p>}
      </aside>
    </ActionForm>
  );
}

type QuoteCurrent = { amount: string; delay: string; note: string; lines: { label: string; qty: number; unit: string; vatBp: number }[]; vatBp: number; validUntil: string; conditions: string; revision: number; fileName: string | null };
type Row = { key: number; label: string; qty: string; unit: string; vat: number };

const eur = (locale: Locale, n: number) => n.toLocaleString(intlLocale(locale), { style: "currency", currency: "EUR" });
const num = (v: string) => { const n = Number(v.replace(/\s/g, "").replace(",", ".")); return Number.isFinite(n) ? n : 0; };

/** Exemple de ligne selon la prestation demandée. */
const LINE_EXAMPLE: Record<string, string> = {
  salle: "Location de la salle (journée)",
  restauration: "Cocktail dînatoire 12 pièces",
  hebergement: "Chambre single, petit-déjeuner inclus (nuit)",
  transport: "Navette gare – lieu, aller-retour",
  audiovisuel: "Captation 2 caméras et régie",
  impression: "Kakémono 85 × 200 cm",
  communication: "Conception du programme",
  evenementiel: "Coordination sur place (journée)",
};

/** Devis du prestataire : détail ligne par ligne, chaque ligne à son taux de TVA (totaux calculés), validité, conditions et PDF signé. */
export function QuoteForm({ orgId, rfqId, category, current, headcount, uploads, ai = false, offers = [], blocked = false }: { orgId: string; rfqId: string; category: string; current?: QuoteCurrent; headcount: number | null; uploads: boolean; ai?: boolean; offers?: { label: string; unit: string; unitCents: number }[]; blocked?: boolean }) {
  const t = useT();
  const locale = useLocale();
  const [state, action, pending] = useActionState(submitQuote, undefined);
  const [open, setOpen] = useState(!current);
  // Taux proposé pour une nouvelle ligne : celui de la catégorie (10 % restauration, hébergement, transport ; 20 % sinon).
  const vat = defaultVatBp(category);
  // Un ancien devis au montant global devient une ligne « Forfait », modifiable comme les autres.
  const [rows, setRows] = useState<Row[]>(
    current?.lines.length
      ? current.lines.map((l, i) => ({ key: i, label: l.label, qty: String(l.qty), unit: l.unit, vat: l.vatBp }))
      : current?.amount
        ? [{ key: 0, label: t("Forfait"), qty: "1", unit: current.amount, vat: current.vatBp }]
        : [{ key: 0, label: "", qty: "1", unit: "", vat }],
  );
  // Devis envoyé : le formulaire se referme (la saisie reste pour une révision).
  const [answered, setAnswered] = useState(state);
  if (state !== answered) {
    setAnswered(state);
    if (state?.ok) setOpen(false);
  }
  if (!open) return (
    <div className="stack-sm">
      <Notice state={state?.ok ? state : undefined} />
      <button type="button" className="btn ghost small" onClick={() => setOpen(true)}>{t("Réviser mon devis")}</button>
    </div>
  );
  const detailed = rows.some((r) => r.label || r.unit);
  const ht = rows.reduce((s, r) => s + num(r.qty) * num(r.unit), 0);
  const ttc = rows.reduce((s, r) => s + num(r.qty) * num(r.unit) * (1 + r.vat / 10000), 0);
  const update = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  return (
    <ActionForm action={action} className="form quote-form">
      <Notice state={state} />
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="rfqId" value={rfqId} />
      <span className="label">{t("Détail de la proposition")}</span>
      <div className="quote-lines" role="table" aria-label={t("Lignes du devis")}>
        <div className="quote-line head" role="row"><span>{t("Désignation")}</span><span>{t("Qté")}</span><span>{t("Prix unitaire HT")}</span><span>{t("TVA")}</span><span>{t("Total HT")}</span><span /></div>
        {rows.map((r) => (
          <div key={r.key} className="quote-line" role="row">
            <input name="line_label" value={r.label} onChange={(e) => update(r.key, { label: e.target.value })} placeholder={LINE_EXAMPLE[category] ? t(LINE_EXAMPLE[category]) : t("Désignation de la prestation")} aria-label={t("Désignation")} />
            <input name="line_qty" value={r.qty} onChange={(e) => update(r.key, { qty: e.target.value })} inputMode="decimal" aria-label={t("Quantité")} />
            <input name="line_unit" value={r.unit} onChange={(e) => update(r.key, { unit: e.target.value })} inputMode="decimal" placeholder="0,00" aria-label={t("Prix unitaire HT")} />
            <select name="line_vat" value={r.vat} onChange={(e) => update(r.key, { vat: Number(e.target.value) })} aria-label={t("Taux de TVA de la ligne")}>
              {VAT_OPTIONS.map((v) => <option key={v.bp} value={v.bp}>{vatLabel(v.bp, intlLocale(locale))}</option>)}
            </select>
            <span className="mono">{eur(locale, num(r.qty) * num(r.unit))}</span>
            <button type="button" className="link danger" aria-label={t("Retirer la ligne")} onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : [{ key: Date.now(), label: "", qty: "1", unit: "", vat }]))}>×</button>
          </div>
        ))}
        <div className="actions">
          <button type="button" className="link" onClick={() => setRows((rs) => [...rs, { key: Date.now(), label: "", qty: "1", unit: "", vat }])}><Plus size={13} />{" "}{t("Ajouter une ligne")}</button>
          {offers.length > 0 && (
            <select
              aria-label={t("Ajouter depuis mon catalogue")}
              value=""
              onChange={(e) => {
                const o = offers[Number(e.target.value)];
                if (!o) return;
                // Forfait « par personne » : quantité = participants attendus.
                const qty = o.unit === "personne" && headcount ? String(headcount) : "1";
                const row = { key: Date.now(), label: o.label, qty, unit: String(o.unitCents / 100).replace(".", ","), vat };
                setRows((rs) => (rs.length === 1 && !rs[0].label && !rs[0].unit ? [row] : [...rs, row]));
              }}
            >
              <option value="">{t("+ Depuis mon catalogue…")}</option>
              {offers.map((o, i) => <option key={i} value={i}>{o.label} ({t("{amount} HT", { amount: eur(locale, o.unitCents / 100) })})</option>)}
            </select>
          )}
        </div>
      </div>
      <p className="hint">{t("TVA par ligne : 10 % pour la restauration, l'hébergement et le transport de personnes, 20 % pour les boissons alcoolisées et la plupart des autres prestations.")}</p>
      <div className="row">
        <label>{t("Offre valable jusqu'au")}<input name="validUntil" type="date" defaultValue={current?.validUntil} /></label>
      </div>
      {detailed && (
        <div className="quote-totals">
          <span>{t("Total HT")}{" "}<strong>{eur(locale, ht)}</strong></span>
          <span>{t("TVA")} <strong>{eur(locale, ttc - ht)}</strong></span>
          <span>{t("TTC")} <strong>{eur(locale, ttc)}</strong></span>
          {headcount ? <span>{t("Par participant")}{" "}<strong>{eur(locale, ttc / headcount)}</strong> {t("TTC")}</span> : null}
        </div>
      )}
      <div className="row">
        <label>{t("Délai / disponibilité")}<input name="delay" defaultValue={current?.delay} placeholder={t("Confirmation sous 48 h")} /></label>
        <label>{t("Conditions")}<input name="conditions" defaultValue={current?.conditions} placeholder={t("Acompte 30 %, annulation sans frais jusqu'à J-15…")} /></label>
      </div>
      <label>{t("Présentation de l'offre")}<textarea name="note" rows={ai ? 4 : 2} defaultValue={current?.note} placeholder={t("Ce qui est inclus, options, références…")} /></label>
      {ai && <AiDraft kind="offre" target="note" label={t("Rédiger la présentation avec l'IA")} />}
      {uploads && (
        <label>{t("Devis signé (PDF, facultatif)")}{current?.fileName ? <span className="hint">{" "}{t("Actuel : {fileName}", { fileName: current.fileName })}</span> : null}
          <input name="file" type="file" accept="application/pdf" />
        </label>
      )}
      {/* Nouvelle réponse après un premier devis retenu : abonnement requis (les révisions restent libres). */}
      <button className="btn" disabled={pending || (blocked && !current)}><Send size={14} /> {pending ? t("Envoi…") : current ? t("Envoyer la version {v}", { v: current.revision + 1 }) : t("Envoyer le devis")}</button>
      {blocked && !current && <p className="hint">{t("Réponse possible une fois l'abonnement prestataire activé (voir le bandeau en haut de la page).")}</p>}
    </ActionForm>
  );
}

/** Sélection rapide de tous les prestataires de la catégorie (le choix reste modifiable un par un). */
function SelectAll({ count, all, onAll }: { count: number; all: boolean; onAll: () => void }) {
  const t = useT();
  if (count < 2) return null;
  return <button type="button" className="link" onClick={onAll}>{all ? t("Tout désélectionner") : t("Consulter les {count} prestataires de la catégorie", { count })}</button>;
}

export function SupplierProfileForm({ orgId, categories, current, canEdit }: { orgId: string; categories: Cat[]; current: { categories: string[]; coverage: string; listed: boolean }; canEdit: boolean }) {
  const t = useT();
  const [state, action, pending] = useActionState(updateSupplierProfile, undefined);
  // ActionForm : la saisie (catégories, zone) reste après une erreur.
  return (
    <ActionForm action={action} className="card form">
      <SectionHead icon={Store} title={t("Fiche prestataire")} desc={t("Les organisations consultent l'annuaire par catégorie. Être référencé ne donne aucune priorité : elles choisissent librement qui consulter.")} />
      <Notice state={state} />
      <input type="hidden" name="orgId" value={orgId} />
      <span className="label">{t("Catégories de prestation")}</span>
      <div className="checks">
        {categories.map((c) => (
          <label key={c.id} className="check"><input type="checkbox" name="categories" value={c.id} defaultChecked={current.categories.includes(c.id)} disabled={!canEdit} /> {c.label}</label>
        ))}
      </div>
      <label>{t("Zone couverte")}<input name="coverage" defaultValue={current.coverage} placeholder={t("France entière, Grand Ouest…")} disabled={!canEdit} /></label>
      <label className="check"><input type="checkbox" name="listed" defaultChecked={current.listed} disabled={!canEdit} />{" "}{t("Apparaître dans l'annuaire des prestataires")}</label>
      {canEdit && <button className="btn" disabled={pending}>{pending ? t("Enregistrement…") : t("Enregistrer")}</button>}
    </ActionForm>
  );
}


/** Question ou réponse dans le fil privé d'une demande de devis (demandeur ↔ prestataire). */
export function RfqMessageForm({ orgId, rfqId, supplierId, placeholder }: { orgId: string; rfqId: string; supplierId: string; placeholder: string }) {
  const t = useT();
  const [state, action, pending] = useActionState(postRfqMessage, undefined);
  return (
    <form action={action} className="stack-sm" key={state?.ok ? Date.now() : "rfq-msg"}>
      {state?.error && <Notice state={state} />}
      <div className="composer">
        <textarea name="body" rows={2} placeholder={placeholder} aria-label={placeholder} required maxLength={4000} />
        <input type="hidden" name="orgId" value={orgId} />
        <input type="hidden" name="rfqId" value={rfqId} />
        <input type="hidden" name="supplierId" value={supplierId} />
        <button className="btn small" disabled={pending}>{pending ? t("Envoi…") : t("Envoyer")}</button>
      </div>
    </form>
  );
}
