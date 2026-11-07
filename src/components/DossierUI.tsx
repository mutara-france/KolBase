import Link from "next/link";
import { ArrowUpRight, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/** Ton d'un repère : neutre, à faire, en ordre, en alerte. */
export type Tone = "neutral" | "warn" | "ok" | "danger" | "brand";

/**
 * En-tête de section d'une fiche (dossier, événement, collaboration) : pastille d'icône, titre, une ligne
 * d'explication, et les actions à droite. Le même dessin partout, pour qu'une carte se lise d'un coup d'œil.
 */
export function SectionHead({ icon: Icon, title, desc, tone = "brand", id, level = 2, children }: {
  icon: LucideIcon;
  title: ReactNode;
  desc?: ReactNode;
  tone?: Tone;
  id?: string;
  level?: 2 | 3;
  children?: ReactNode;
}) {
  const H = level === 2 ? "h2" : "h3";
  return (
    <div className="sec-head">
      <span className={`sec-icon ${tone}`} aria-hidden><Icon size={17} strokeWidth={1.9} /></span>
      <div className="sec-text">
        <H id={id}>{title}</H>
        {desc && <p>{desc}</p>}
      </div>
      {children && <div className="sec-actions">{children}</div>}
    </div>
  );
}

/**
 * Repère d'une rubrique dans la vue d'ensemble : où en est-elle, et qu'y a-t-il à faire. Toute la tuile mène à
 * l'onglet ; le point de couleur dit s'il faut agir.
 */
export function StateTile({ href, icon: Icon, label, value, detail, tone = "neutral", disabled }: {
  href: string;
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  tone?: Tone;
  disabled?: boolean;
}) {
  const body = (
    <>
      <span className="st-top">
        <span className="st-label"><Icon size={14} strokeWidth={1.9} aria-hidden />{label}</span>
        {!disabled && <ArrowUpRight className="st-go" size={15} aria-hidden />}
      </span>
      <span className="st-value">{value}</span>
      {detail && <span className="st-detail"><span className={`st-dot ${tone}`} aria-hidden />{detail}</span>}
    </>
  );
  return disabled ? <div className="state-tile disabled">{body}</div> : <Link href={href} className={`state-tile tone-${tone}`}>{body}</Link>;
}
