import type { ReactNode } from "react";

export type HeroFact = { icon?: ReactNode; label: string; value: ReactNode; sub?: ReactNode };

/**
 * En-tête commun des fiches (dossier, événement, mission, appel) : surtitre, statut, titre, chapeau,
 * chiffres clés, puis un contenu libre (frise d'étapes, par exemple).
 */
export function PageHero({ eyebrow, status, title, lead, facts, children }: { eyebrow?: ReactNode; status?: ReactNode; title: string; lead?: ReactNode; facts?: HeroFact[]; children?: ReactNode }) {
  const shown = (facts ?? []).filter((f) => f.value !== null && f.value !== undefined && f.value !== "");
  return (
    <header className="page-hero">
      {(eyebrow || status) && (
        <div className="hero-top">
          <span className="eyebrow-sm">{eyebrow}</span>
          {status}
        </div>
      )}
      <h1>{title}</h1>
      {lead && <p className="lead">{lead}</p>}
      {shown.length > 0 && (
        <dl className="hero-facts">
          {shown.map((f, i) => (
            <div key={i}>
              <dt>{f.icon}{f.label}</dt>
              <dd>{f.value}{f.sub && <small>{f.sub}</small>}</dd>
            </div>
          ))}
        </dl>
      )}
      {children}
    </header>
  );
}
