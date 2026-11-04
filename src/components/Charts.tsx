"use client";

import { useState, type PointerEvent as RPointerEvent } from "react";

/**
 * Graphiques légers en HTML (aucune dépendance) : colonnes empilées, barres classées, jauge.
 * Couleurs : variables --series-1…3 et --seq de .viz (palette validée daltonisme, voir globals.css).
 * Chaque graphique a une info-bulle au survol et au clavier, et une vue tableau.
 */

export type ValueFormat = "eur" | "int" | "days";

function fmtValue(v: number, f: ValueFormat, compact = false) {
  if (f === "int") return v.toLocaleString("fr-FR");
  if (f === "days") return `${v.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} j`;
  const eur = v / 100;
  if (compact && Math.abs(eur) >= 1000) return `${(eur / 1000).toLocaleString("fr-FR", { maximumFractionDigits: eur >= 10000 ? 0 : 1 })} k€`;
  return eur.toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
}

/** Graduations « rondes » : 0 et 3 ou 4 paliers jusqu'au maximum. */
function niceTicks(max: number) {
  if (max <= 0) return [0];
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const ticks = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(v);
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

type Tip = { x: number; y: number; title: string; rows: { label: string; value: string; slot?: number }[] } | null;

function Tooltip({ tip }: { tip: Tip }) {
  if (!tip) return null;
  return (
    <div className="viz-tip" role="status" style={{ left: tip.x, top: tip.y }}>
      <div className="viz-tip-title">{tip.title}</div>
      {tip.rows.map((r, i) => (
        <div key={i} className="viz-tip-row">
          {r.slot && <span className={`viz-key s${r.slot}`} aria-hidden />}
          <strong>{r.value}</strong>
          <span>{r.label}</span>
        </div>
      ))}
    </div>
  );
}

function useTip() {
  const [tip, setTip] = useState<Tip>(null);
  const place = (e: RPointerEvent<HTMLElement> | { currentTarget: HTMLElement }, content: Omit<NonNullable<Tip>, "x" | "y">) => {
    const host = e.currentTarget.closest(".viz") as HTMLElement | null;
    if (!host) return;
    const box = host.getBoundingClientRect();
    const r = e.currentTarget.getBoundingClientRect();
    const px = "clientX" in e ? e.clientX : r.left + r.width / 2;
    const py = "clientY" in e ? e.clientY : r.top;
    setTip({ ...content, x: Math.min(Math.max(px - box.left, 80), box.width - 80), y: py - box.top });
  };
  return { tip, place, hide: () => setTip(null) };
}

export type StackSeries = { key: string; label: string };

/** Colonnes empilées (≤ 3 séries) : total au sommet, légende, info-bulle par colonne, vue tableau. */
export function StackedColumns({ series, rows, format, caption }: { series: StackSeries[]; rows: { label: string; values: Record<string, number> }[]; format: ValueFormat; caption: string }) {
  const { tip, place, hide } = useTip();
  const totals = rows.map((r) => series.reduce((s, x) => s + (r.values[x.key] ?? 0), 0));
  const ticks = niceTicks(Math.max(...totals, 0));
  const top = ticks[ticks.length - 1] || 1;
  const content = (i: number) => ({
    title: `${rows[i].label} · ${fmtValue(totals[i], format)}`,
    rows: series.map((s, k) => ({ label: s.label, value: fmtValue(rows[i].values[s.key] ?? 0, format), slot: k + 1 })),
  });
  return (
    <figure className="viz" aria-label={caption}>
      <div className="viz-legend">
        {series.map((s, k) => <span key={s.key}><i className={`viz-swatch s${k + 1}`} aria-hidden />{s.label}</span>)}
      </div>
      <div className="viz-cols" onPointerLeave={hide}>
        <div className="viz-grid" aria-hidden>
          {ticks.map((t) => <div key={t} style={{ bottom: `${(t / top) * 100}%` }}><span>{fmtValue(t, format, true)}</span></div>)}
        </div>
        <div className="viz-bands">
          {rows.map((r, i) => (
            <div
              key={r.label}
              className="viz-band"
              tabIndex={0}
              aria-label={`${content(i).title} : ${content(i).rows.map((x) => `${x.label} ${x.value}`).join(", ")}`}
              onPointerMove={(e) => place(e, content(i))}
              onFocus={(e) => place(e, content(i))}
              onBlur={hide}
            >
              <div className="viz-col" style={{ height: `${(totals[i] / top) * 100}%` }}>
                {totals[i] > 0 && <span className="viz-cap">{fmtValue(totals[i], format, true)}</span>}
                {series.map((s, k) => {
                  const v = r.values[s.key] ?? 0;
                  return v > 0 ? <div key={s.key} className={`viz-seg s${k + 1}`} style={{ flexGrow: v }} /> : null;
                })}
              </div>
              <span className="viz-xlabel">{r.label}</span>
            </div>
          ))}
        </div>
        <Tooltip tip={tip} />
      </div>
      <DataTable caption={caption} head={["", ...series.map((s) => s.label), "Total"]} rows={rows.map((r, i) => [r.label, ...series.map((s) => fmtValue(r.values[s.key] ?? 0, format)), fmtValue(totals[i], format)])} />
    </figure>
  );
}

/** Barres horizontales classées, une seule teinte, valeur au bout de la barre. */
export function RankedBars({ rows, format, caption, empty = "Aucune donnée sur la période." }: { rows: { label: string; value: number; note?: string }[]; format: ValueFormat; caption: string; empty?: string }) {
  const { tip, place, hide } = useTip();
  if (rows.length === 0) return <p className="muted">{empty}</p>;
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <figure className="viz" aria-label={caption}>
      <ul className="viz-bars" onPointerLeave={hide}>
        {rows.map((r) => {
          const c = { title: r.label, rows: [{ label: r.note ?? "", value: fmtValue(r.value, format) }] };
          return (
            <li key={r.label} tabIndex={0} aria-label={`${r.label} : ${fmtValue(r.value, format)}${r.note ? `, ${r.note}` : ""}`} onPointerMove={(e) => place(e, c)} onFocus={(e) => place(e, c)} onBlur={hide}>
              <span className="viz-bar-label">{r.label}</span>
              <span className="viz-bar-track">
                <span className="viz-bar" style={{ width: `max(4px, calc((100% - 88px) * ${r.value / max}))` }} />
                <span className="viz-bar-value">{fmtValue(r.value, format)}</span>
              </span>
            </li>
          );
        })}
      </ul>
      <Tooltip tip={tip} />
      <DataTable caption={caption} head={["", "Valeur", ...(rows.some((r) => r.note) ? ["Détail"] : [])]} rows={rows.map((r) => [r.label, fmtValue(r.value, format), ...(rows.some((x) => x.note) ? [r.note ?? ""] : [])])} />
    </figure>
  );
}

/** Jauge : une part rapportée à un tout (piste dans une teinte claire de la même rampe). */
export function Meter({ value, label }: { value: number; label: string }) {
  const pct = Math.round(Math.min(Math.max(value, 0), 1) * 100);
  return (
    <div className="viz-meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

function DataTable({ caption, head, rows }: { caption: string; head: string[]; rows: string[][] }) {
  return (
    <details className="viz-table">
      <summary>Voir les données</summary>
      <table className="table" tabIndex={0}>
        <caption className="sr-only">{caption}</caption>
        <thead><tr>{head.map((h, i) => <th key={i} scope="col">{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => (j === 0 ? <th key={j} scope="row">{c}</th> : <td key={j} className="num">{c}</td>))}</tr>)}</tbody>
      </table>
    </details>
  );
}
