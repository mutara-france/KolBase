import Link from "next/link";
import { AlertTriangle, ArrowRight, CalendarClock, CheckCircle2, CircleDot, FileSignature, Inbox, ShieldCheck, UserRound, Mic, Receipt, Bell, BellRing } from "lucide-react";
import { getT } from "@/lib/i18n/server";

const ICONS = { AlertTriangle, Bell, BellRing, CalendarClock, CheckCircle2, CircleDot, FileSignature, Inbox, Mic, Receipt, ShieldCheck, UserRound };
export type TodoItem = { href: string; title: string; detail?: string; icon: keyof typeof ICONS; tone?: "electric" | "warn" | "danger" | "ok" };

export async function TodoList({ items, empty }: { items: TodoItem[]; empty?: string }) {
  if (items.length === 0) return <p className="todo-empty"><CheckCircle2 size={16} /> {empty ?? (await getT()).t("Rien à faire pour le moment.")}</p>;
  return (
    <ul className="todo-list">
      {items.map((t, i) => {
        const Icon = ICONS[t.icon];
        return (
          <li key={i}>
            <Link href={t.href} className={`todo-row tone-${t.tone ?? "electric"}`}>
              <span className="todo-icon"><Icon size={16} /></span>
              <span className="grow"><strong>{t.title}</strong>{t.detail && <span className="text-xs">{t.detail}</span>}</span>
              <ArrowRight size={14} />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
