import Link from "next/link";
import { ArrowRight, ChevronDown, Plus } from "lucide-react";
import { TodoList, type TodoItem } from "@/components/Todo";
import { TZ } from "@/lib/events";

/** Briques communes des tableaux de bord : en-tête, compteurs, « À faire », « À venir ». */

export const todayLabel = () => new Date().toLocaleDateString("fr-FR", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" });

export function DashHead({ kicker, title, lede, action }: { kicker: string; title: string; lede?: string; action?: React.ReactNode }) {
  return (
    <div className="dash-head">
      <div>
        <p className="dash-kicker">{kicker}</p>
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
export function TodoGroups({ todos, empty }: { todos: TodoItem[]; empty?: string }) {
  const urgent = todos.filter((t) => t.tone === "danger");
  const rest = todos.filter((t) => t.tone !== "danger");
  if (todos.length === 0) return <TodoList items={[]} empty={empty} />;
  return (
    <div className="todo-groups">
      {urgent.length > 0 && (
        <div>
          <p className="todo-group urgent">Urgent</p>
          <TodoList items={urgent} />
        </div>
      )}
      {rest.length > 0 && (
        <div>
          {urgent.length > 0 && <p className="todo-group">À traiter</p>}
          <TodoList items={rest} />
        </div>
      )}
    </div>
  );
}

export type TimelineItem = { date: Date; title: string; detail?: string | null; href: string; strong?: boolean };

/** Prochaines échéances et prochains événements, dans l'ordre du calendrier. */
export function Timeline({ items, empty }: { items: TimelineItem[]; empty?: React.ReactNode }) {
  if (items.length === 0) return empty ? <p className="muted">{empty}</p> : null;
  return (
    <ol className="timeline">
      {items.map((i, n) => (
        <li key={n}>
          <span className={`timeline-date${i.strong ? " strong" : ""}`}>
            {i.date.toLocaleDateString("fr-FR", { timeZone: TZ, day: "2-digit", month: "2-digit" })}
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
