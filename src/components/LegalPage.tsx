import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { TableWrap } from "@/components/TableWrap";

/** Paragraphes d'un texte légal (chaînes simples, sans échappement JSX). */
export const P = ({ children }: { children: React.ReactNode[] | React.ReactNode }) => <>{(Array.isArray(children) ? children : [children]).map((c, i) => <p key={i}>{c}</p>)}</>;
/** Liste à puces d'un texte légal. */
export const L = ({ items }: { items: React.ReactNode[] }) => <ul className="plain legal-list">{items.map((c, i) => <li key={i}>{c}</li>)}</ul>;
/** Tableau d'un texte légal (première ligne = en-têtes). */
export const T = ({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) => (
  <TableWrap label={head.join(", ")}>
    <table className="table legal-table">
      <thead><tr>{head.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} data-label={head[j]}>{c}</td>)}</tr>)}</tbody>
    </table>
  </TableWrap>
);

/** Autres textes légaux, liés en bas de chaque page. */
const OTHERS: [string, string][] = [
  ["/mentions-legales", "Mentions légales"],
  ["/cgu", "Conditions générales d'utilisation"],
  ["/conditions-de-vente", "Conditions générales de vente"],
  ["/confidentialite", "Politique de confidentialité"],
  ["/sous-traitance", "Contrat de sous-traitance (RGPD)"],
];

export function LegalPage({ title, updated, intro, sections, path }: { title: string; updated: string; intro?: React.ReactNode; sections: [string, React.ReactNode][]; path?: string }) {
  return (
    <>
      <SiteHeader variant="public" />
      <main className="narrow stack legal">
        <div>
          <h1>{title}</h1>
          <p className="muted">Dernière mise à jour : {updated}</p>
          {intro && <div className="lead-sm">{intro}</div>}
        </div>
        {sections.length > 4 && (
          <nav className="card legal-toc" aria-label="Sommaire">
            <ol>{sections.map(([h], i) => <li key={h}><a href={`#art-${i + 1}`}>{h}</a></li>)}</ol>
          </nav>
        )}
        {sections.map(([h, body], i) => (
          <section key={h} className="card" id={`art-${i + 1}`}>
            <h2>{sections.length > 4 ? `${i + 1}. ` : ""}{h}</h2>
            {body}
          </section>
        ))}
        <p className="muted text-sm legal-others">
          {OTHERS.filter(([href]) => href !== path).map(([href, label], i) => <span key={href}>{i > 0 ? " · " : ""}<Link href={href}>{label}</Link></span>)}
        </p>
      </main>
    </>
  );
}
