"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import {
  BadgeCheck, Building2, LayoutDashboard, CalendarDays, ClipboardList, FileText, Gift, Inbox, LogOut, Megaphone, Menu, Search, Settings, ShieldCheck, Ticket, Users,
} from "lucide-react";
import { signOut } from "@/lib/auth-actions";

const ICONS = { BadgeCheck, Building2, LayoutDashboard, CalendarDays, ClipboardList, FileText, Gift, Inbox, Megaphone, Search, Settings, ShieldCheck, Ticket, Users };
export type IconName = keyof typeof ICONS;
export type NavItem = { href: string; label: string; icon: IconName; badge?: number; exact?: boolean };
export type NavSection = { title: string; subtitle?: string; items: NavItem[] };

export function Sidebar({ sections }: { sections: NavSection[] }) {
  const path = usePathname();
  useEffect(() => { document.body.classList.remove("menu-open"); }, [path]);
  const isActive = (i: NavItem) => (i.exact ? path === i.href : path === i.href || path.startsWith(i.href + "/"));
  return (
    <aside className="sidebar" aria-label="Navigation">
      {sections.map((s) => (
        <div key={s.title + (s.subtitle ?? "")}>
          <div className="side-section">{s.title}</div>
          {s.subtitle && <div className="side-org">{s.subtitle}</div>}
          {s.items.map((i) => {
            const Icon = ICONS[i.icon];
            return (
              <Link key={i.href} href={i.href} className={`side-link${isActive(i) ? " active" : ""}`}>
                <Icon size={16} strokeWidth={1.8} />
                {i.label}
                {i.badge ? <span className="side-badge">{i.badge}</span> : null}
              </Link>
            );
          })}
        </div>
      ))}
      <div className="side-section">Session</div>
      <form action={signOut} className="side-form">
        <button className="side-link" type="submit"><LogOut size={16} strokeWidth={1.8} /> Se déconnecter</button>
      </form>
    </aside>
  );
}

export function MenuToggle() {
  return (
    <button type="button" className="btn ghost small menu-toggle" aria-label="Menu" onClick={() => document.body.classList.toggle("menu-open")}>
      <Menu size={16} />
    </button>
  );
}
