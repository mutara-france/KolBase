"use client";

import { useActionState, useState } from "react";
import { Star } from "lucide-react";
import { addSupplierOffer, addSupplierPhoto, reviewSupplier, updateSupplierBook } from "@/lib/book-actions";
import { Notice } from "@/components/AuthForms";

type Caps = { seats?: number; cocktail?: number; banquet?: number; rooms?: number };

/** Capacités, équipements, accessibilité et prix indicatif du book prestataire. */
export function BookForm({ orgId, capacities, equipment, options, accessible, priceHint }: { orgId: string; capacities: Caps; equipment: string[]; options: readonly string[]; accessible: boolean; priceHint: string }) {
  const [state, action, pending] = useActionState(updateSupplierBook, undefined);
  return (
    <form action={action} className="card form">
      <h2>Capacités et équipements</h2>
      <p className="muted">Ces informations apparaissent sur votre page publique et aident les organisations à vous consulter à bon escient.</p>
      <Notice state={state} />
      <input type="hidden" name="orgId" value={orgId} />
      <div className="row">
        <label>Places assises (conférence)<input name="seats" type="number" min={1} defaultValue={capacities.seats} /></label>
        <label>Personnes en cocktail<input name="cocktail" type="number" min={1} defaultValue={capacities.cocktail} /></label>
        <label>Couverts assis<input name="banquet" type="number" min={1} defaultValue={capacities.banquet} /></label>
        <label>Chambres<input name="rooms" type="number" min={1} defaultValue={capacities.rooms} /></label>
      </div>
      <span className="label">Équipements et services</span>
      <div className="checks">
        {options.map((o) => <label key={o} className="check"><input type="checkbox" name="equipment" value={o} defaultChecked={equipment.includes(o)} /> {o}</label>)}
      </div>
      <label className="check"><input type="checkbox" name="accessible" defaultChecked={accessible} /> Accessible aux personnes à mobilité réduite</label>
      <label>Prix indicatif<input name="priceHint" maxLength={120} defaultValue={priceHint} placeholder="Ex. : salle à partir de 450 € HT la journée" /></label>
      <button className="btn" disabled={pending}>{pending ? "Enregistrement…" : "Enregistrer"}</button>
    </form>
  );
}

export function PhotoForm({ orgId }: { orgId: string }) {
  const [state, action, pending] = useActionState(addSupplierPhoto, undefined);
  return (
    <form action={action} className="form photo-form" key={state?.ok ? Date.now() : "photo"}>
      <Notice state={state} />
      <input type="hidden" name="orgId" value={orgId} />
      <div className="row">
        <label>Photo (PNG, JPEG ou WebP, 800 Ko au plus)<input type="file" name="photo" accept="image/png,image/jpeg,image/webp" required /></label>
        <label>Légende<input name="caption" maxLength={120} placeholder="Salle Saône, configuration théâtre" /></label>
      </div>
      <button className="btn small secondary" disabled={pending}>{pending ? "Envoi…" : "Ajouter la photo"}</button>
    </form>
  );
}

export function OfferForm({ orgId, units }: { orgId: string; units: Record<string, string> }) {
  const [state, action, pending] = useActionState(addSupplierOffer, undefined);
  return (
    <form action={action} className="form offer-form" key={state?.ok ? Date.now() : "offer"}>
      <Notice state={state} />
      <input type="hidden" name="orgId" value={orgId} />
      <div className="row">
        <label>Prestation<input name="label" required maxLength={120} placeholder="Pause café d'accueil" /></label>
        <label>Prix HT (€)<input name="price" inputMode="decimal" required placeholder="8,00" /></label>
        <label>Unité
          <select name="unit" defaultValue="personne">{Object.entries(units).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        </label>
      </div>
      <button className="btn small secondary" disabled={pending}>{pending ? "Ajout…" : "Ajouter au catalogue"}</button>
    </form>
  );
}

/** Avis vérifié après la prestation : note de 1 à 5 et commentaire. */
export function ReviewForm({ orgId, rfqId, supplier }: { orgId: string; rfqId: string; supplier: string }) {
  const [state, action, pending] = useActionState(reviewSupplier, undefined);
  const [rating, setRating] = useState(0);
  if (state?.ok) return <p className="notice ok">{state.ok}</p>;
  return (
    <form action={action} className="form review-form">
      <Notice state={state} />
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="rfqId" value={rfqId} />
      <span className="label">Évaluer {supplier}</span>
      <div className="stars" role="radiogroup" aria-label="Note">
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className={n <= rating ? "on" : ""} title={`${n}/5`}>
            <input type="radio" name="rating" value={n} required onChange={() => setRating(n)} />
            <Star size={20} />
          </label>
        ))}
      </div>
      <textarea name="comment" rows={2} maxLength={1000} placeholder="Qualité de la prestation, ponctualité, échanges…" aria-label="Commentaire" />
      <p className="hint">Votre avis sera publié avec le nom de votre organisation sur la page du prestataire.</p>
      <button className="btn small" disabled={pending}>{pending ? "Envoi…" : "Publier l'avis"}</button>
    </form>
  );
}
