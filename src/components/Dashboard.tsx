import Link from "next/link";
import { ArrowRight, ChevronDown, Plus } from "lucide-react";
import { TodoList, type TodoItem } from "@/components/Todo";
import { fmtDate } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";

/** Briques communes des tableaux de bord : en-tête, compteurs, « À faire », « À venir ». */


export function DashHead({ kicker, title, lede, action }: { kicker?: string; title: string; lede?: string; action?: React.ReactNode }) {
  return (
    <div className="dash-head">
      <div>
        {kicker && <p className="dash-kicker">{kicker}</p>}
        <h1>{title}</h1>
        {lede && <p className="dash-lede">{lede}</p>}
      </div>
      {action}
    </div>
  );
}

/** Bouton « Créer » unique : lien direct s'il n'y a qu'une possibilité, petit menu sinon. */
export function CreateMenu({ items }: { items: { href: string; label: string }[] }) {
  if (items.length === 0) return null;
  if (items.length === 1)
    return (
      <Link href={items[0].href} className="btn lg">
        <Plus size={18} aria-hidden /> Créer {items[0].label.toLowerCase()}
      </Link>
    );
  return (
    <details className="create-menu">
      <summary className="btn lg">
        <Plus size={18} aria-hidden /> Créer <ChevronDown size={16} aria-hidden />
      </summary>
      <div className="create-list">
        {items.map((i) => (
          <Link key={i.href} href={i.href}>{i.label}</Link>
        ))}
      </div>
    </details>
  );
}

export function DashStats({ stats }: { stats: { href: string; value: number | string; label: string; hint?: string }[] }) {
  if (stats.length === 0) return null;
  return (
    <div className="dash-stats">
      {stats.map((s) => (
        <Link key={s.label} href={s.href} className="dash-stat">
          <span className="dash-stat-value">{s.value}</span>
          <span className="dash-stat-label">{s.label}</span>
          {s.hint && <span className="dash-stat-hint">{s.hint}</span>}
        </Link>
      ))}
    </div>
  );
}

/** « À faire » : les urgences d'abord, puis le reste. */
/** Actions à mener, les urgentes d'abord ; au-delà de `limit` par groupe, un simple décompte. */
export function TodoGroups({ todos, empty, limit = 15, moreHref }: { todos: TodoItem[]; empty?: string; limit?: number; moreHref?: string }) {
  const urgent = todos.filter((t) => t.tone === "danger");
  const rest = todos.filter((t) => t.tone !== "danger");
  if (todos.length === 0) return <TodoList items={[]} empty={empty} />;
  const more = (n: number) =>
    n > limit && (
      <p className="text-xs muted" style={{ margin: "6px 0 0" }}>
        … et {n - limit} autre{n - limit > 1 ? "s" : ""}{moreHref && <> · <Link href={moreHref}>tout voir</Link></>}
      </p>
    );
  return (
    <div className="todo-groups">
      {urgent.length > 0 && (
        <div>
          <p className="todo-group urgent">Urgent</p>
          <TodoList items={urgent.slice(0, limit)} />
          {more(urgent.length)}
        </div>
      )}
      {rest.length > 0 && (
        <div>
          {urgent.length > 0 && <p className="todo-group">À traiter</p>}
          <TodoList items={rest.slice(0, limit)} />
          {more(rest.length)}
        </div>
      )}
    </div>
  );
}

export type TimelineItem = { date: Date; title: string; detail?: string | null; href: string; strong?: boolean };

/** Prochaines échéances et prochains événements, dans l'ordre du calendrier. */
export async function Timeline({ items, empty }: { items: TimelineItem[]; empty?: React.ReactNode }) {
  if (items.length === 0) return empty ? <p className="muted">{empty}</p> : null;
  const { locale } = await getT();
  return (
    <ol className="timeline">
      {items.map((i, n) => (
        <li key={n}>
          <span className={`timeline-date${i.strong ? " strong" : ""}`}>
            {fmtDate(locale, i.date, { day: "2-digit", month: "2-digit" })}
          </span>
          <Link href={i.href}>
            <strong>{i.title}</strong>
            {i.detail && <span>{i.detail}</span>}
          </Link>
        </li>
      ))}
    </ol>
  );
}

export function MoreLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="more-link">
      {children} <ArrowRight size={16} aria-hidden />
    </Link>
  );
}
