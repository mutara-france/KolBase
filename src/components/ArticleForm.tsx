"use client";

import { useActionState } from "react";
import { saveArticle } from "@/lib/news-actions";
import { Notice } from "@/components/AuthForms";
import { ActionForm } from "@/components/ActionForm";

type A = { id?: string; title: string; slug: string; category: string; excerpt: string; body: string; cover: string | null; published?: boolean };

/**
 * Rédaction d'une actualité (équipe KolBase). Un brouillon se publie depuis ce formulaire (« Enregistrer et
 * publier ») : c'est le texte à l'écran qui part en ligne, pas la dernière version enregistrée.
 */
export function ArticleForm({ a, categories }: { a: A; categories: readonly string[] }) {
  const [state, action, pending] = useActionState(saveArticle, undefined);
  return (
    <ActionForm action={action} className="card form article-form">
      <Notice state={state} />
      {a.id && <input type="hidden" name="id" value={a.id} />}
      <label>Titre<input name="title" required maxLength={160} defaultValue={a.title} /></label>
      <div className="row">
        <label>Rubrique
          <select name="category" defaultValue={a.category}>{categories.map((c) => <option key={c}>{c}</option>)}</select>
        </label>
        <label>Adresse (facultatif)<input name="slug" maxLength={80} defaultValue={a.slug} placeholder="déduite du titre" /></label>
      </div>
      <label>Chapô<textarea name="excerpt" rows={2} required maxLength={400} defaultValue={a.excerpt} placeholder="Deux phrases qui résument l'article (liste des actualités, partage)." /></label>
      <label>Texte<textarea name="body" rows={16} required defaultValue={a.body} /></label>
      <p className="hint">Paragraphes séparés par une ligne vide · « ## Intertitre » · lignes « - » pour une liste · **gras** · [texte du lien](https://…) ou [aide](/aide) · « ![légende](/etudes/…/visuel.webp) » seule sur sa ligne pour une image du site.</p>
      <div className="row">
        <label>Image (PNG, JPEG ou WebP, 1,5 Mo au plus)<input type="file" name="cover" accept="image/png,image/jpeg,image/webp" /></label>
        {a.cover && <label className="check"><input type="checkbox" name="removeCover" value="1" /> Retirer l&apos;image actuelle</label>}
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {a.cover && <img src={a.cover} alt="" className="article-form-cover" />}
      <div className="actions">
        <button className={a.id && !a.published ? "btn secondary" : "btn"} disabled={pending}>
          {pending ? "Enregistrement…" : !a.id ? "Créer le brouillon" : a.published ? "Enregistrer (en ligne)" : "Enregistrer le brouillon"}
        </button>
        {a.id && !a.published && <button className="btn" name="intent" value="publish" disabled={pending}>Enregistrer et publier</button>}
      </div>
    </ActionForm>
  );
}
