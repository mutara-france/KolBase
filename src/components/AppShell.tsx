"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  Bell, CalendarDays, Check, ChevronDown, CircleHelp, ExternalLink, FileText, Folder, House, LogOut, Megaphone, Plug, Receipt, Send, ShieldCheck, UserRound, Users, Building2,
} from "lucide-react";
import { Logo } from "@/components/Logo";
import { signOut } from "@/lib/auth-actions";
import { itemMatches, type ShellIcon, type ShellItem, type ShellSpace } from "@/lib/nav";

const ICONS: Record<ShellIcon, typeof House> = { House, Users, Folder, FileText, CalendarDays, ShieldCheck, Send, Megaphone, UserRound, Receipt, Plug, ExternalLink };
const COOKIE = "kb_espace";

const spaceMatches = (s: ShellSpace, path: string) => path === s.home || path.startsWith(s.home + "/") || s.items.some((i) => itemMatches(i, path));

/** Espace courant : celui de la page ouverte, sinon le dernier utilisé, sinon le premier. */
function resolveSpace(spaces: ShellSpace[], path: string, preferred?: string) {
  const pref = spaces.find((s) => s.key === preferred);
  if (pref && spaceMatches(pref, path)) return pref;
  return spaces.find((s) => spaceMatches(s, path)) ?? pref ?? spaces[0];
}

export type ShellUser = { name: string; initials: string; color: string };

export function AppShell({
  user,
  spaces,
  initialSpace,
  activeKey,
  bell,
}: {
  user: ShellUser;
  spaces: ShellSpace[];
  initialSpace?: string;
  activeKey?: string;
  bell: { count: number } | null;
}) {
  const path = usePathname();
  const space = resolveSpace(spaces, path, initialSpace);
  const matched = space ? spaceMatches(space, path) : false;

  // Mémorise l'espace pour les pages communes (compte, annuaire, suivis…).
  useEffect(() => {
    if (space && matched) document.cookie = `${COOKIE}=${encodeURIComponent(space.key)}; path=/; max-age=31536000; samesite=lax`;
  }, [space, matched]);

  // Une seule entrée active : celle désignée par la page, sinon la première qui correspond au chemin.
  const activeItem = space ? (activeKey ? space.items.find((i) => i.key === activeKey) : space.items.find((i) => itemMatches(i, path))) : undefined;
  const isActive = (i: ShellItem) => i === activeItem;

  return (
    <>
      <header className="top-bar">
        <Logo />
        <div className="top-actions">
          {bell && (
            <Link href="/suivis" className={`icon-btn${path === "/suivis" ? " active" : ""}`} aria-label={bell.count ? `Suivis, ${bell.count} nouveauté${bell.count > 1 ? "s" : ""}` : "Suivis"}>
              <Bell size={19} strokeWidth={1.8} aria-hidden />
              {bell.count > 0 && <span className="icon-badge" aria-hidden>{bell.count}</span>}
            </Link>
          )}
          <AccountMenu user={user} space={space} spaces={spaces} />
        </div>
      </header>

      {space && (
        <aside className="sidebar" aria-label="Navigation">
          <SpaceSwitch space={space} spaces={spaces} />
          <nav className="side-nav" aria-label={space.title}>
            {space.items.map((i) => {
              const Icon = ICONS[i.icon];
              return (
                <Link key={i.key} href={i.href} className={`side-link${isActive(i) ? " active" : ""}`} aria-current={isActive(i) ? "page" : undefined}>
                  <Icon size={19} strokeWidth={1.8} aria-hidden />
                  {i.label}
                  {i.badge ? <span className="side-badge" aria-label={`${i.badge} à traiter`}>{i.badge}</span> : null}
                </Link>
              );
            })}
          </nav>
        </aside>
      )}

      {space && (
        <nav className="bottom-nav" aria-label="Navigation principale">
          {space.items.map((i) => {
            const Icon = ICONS[i.icon];
            return (
              <Link key={i.key} href={i.href} className={isActive(i) ? "active" : undefined} aria-current={isActive(i) ? "page" : undefined}>
                <Icon size={22} strokeWidth={isActive(i) ? 2 : 1.8} aria-hidden />
                <span>{i.short ?? i.label}</span>
                {i.badge ? <span className="bottom-badge" aria-label={`${i.badge} à traiter`}>{i.badge}</span> : null}
              </Link>
            );
          })}
        </nav>
      )}
    </>
  );
}

function SpaceMark({ space, size = 40 }: { space: ShellSpace; size?: number }) {
  return (
    <span className="space-mark" style={{ width: size, height: size, background: space.color, borderRadius: space.square ? 12 : 999 }} aria-hidden>
      {space.initials}
    </span>
  );
}

/** En-tête de la barre latérale : l'espace courant, et le passage à un autre espace s'il y en a plusieurs. */
function SpaceSwitch({ space, spaces }: { space: ShellSpace; spaces: ShellSpace[] }) {
  const path = usePathname();
  const head = (
    <>
      <SpaceMark space={space} />
      <span className="space-text">
        <strong>{space.title}</strong>
        <small>{space.subtitle}</small>
      </span>
    </>
  );
  if (spaces.length < 2) return <div className="space-head">{head}</div>;
  return (
    <details className="space-switch" key={path}>
      <summary className="space-head" aria-label={`${space.title}, changer d'espace`}>
        {head}
        <ChevronDown size={18} className="space-chevron" aria-hidden />
      </summary>
      <div className="space-list">
        {spaces.map((s) => (
          <Link key={s.key} href={s.home} className={s.key === space.key ? "current" : undefined} aria-current={s.key === space.key ? "true" : undefined}>
            <SpaceMark space={s} size={30} />
            <span>{s.title}</span>
            {s.key === space.key && <Check size={16} aria-hidden />}
          </Link>
        ))}
      </div>
    </details>
  );
}

/** Menu sous l'avatar : réglages de l'espace, compte, aide, déconnexion. */
function AccountMenu({ user, space, spaces }: { user: ShellUser; space?: ShellSpace; spaces: ShellSpace[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const isPractitioner = space?.key === "praticien";
  return (
    <div className="account" ref={ref}>
      <button type="button" className="session-chip" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="avatar" style={{ width: 36, height: 36, fontSize: 13, background: user.color }} aria-hidden>{user.initials}</span>
        <span className="session-text">
          <span className="session-name">{user.name}</span>
          <span className="session-role">{space?.chip ?? "Mon compte"}</span>
        </span>
        <ChevronDown size={16} className="session-chevron" aria-hidden />
      </button>
      {open && (
        <div className="account-menu" role="menu" aria-label="Menu du compte" onClick={(e) => (e.target as HTMLElement).closest("a") && setOpen(false)}>
          <div className="account-head">
            <strong>{user.name}</strong>
            {space && <span>{space.chip === space.title ? space.subtitle : space.chip}</span>}
          </div>
          {spaces.length > 1 && (
            <>
              <p className="account-label">Changer d&apos;espace</p>
              {spaces.map((s) => (
                <Link key={s.key} href={s.home} role="menuitem" className={s.key === space?.key ? "current" : undefined}>
                  <SpaceMark space={s} size={26} />
                  <span>{s.title}</span>
                  {s.key === space?.key && <Check size={16} aria-hidden />}
                </Link>
              ))}
            </>
          )}
          {space && space.links.length > 0 && (
            <>
              <p className="account-label">{isPractitioner ? "Mon profil" : space.title}</p>
              {space.links.map((l) => {
                const Icon = ICONS[l.icon];
                return (
                  <Link key={l.href} href={l.href} role="menuitem">
                    <Icon size={18} strokeWidth={1.8} aria-hidden />
                    {l.label}
                  </Link>
                );
              })}
            </>
          )}
          <hr />
          {!isPractitioner && (
            <Link href="/compte" role="menuitem"><UserRound size={18} strokeWidth={1.8} aria-hidden />Mon compte</Link>
          )}
          <Link href="/organisations" role="menuitem"><Building2 size={18} strokeWidth={1.8} aria-hidden />Mes organisations</Link>
          <Link href="/aide" role="menuitem"><CircleHelp size={18} strokeWidth={1.8} aria-hidden />Aide</Link>
          <hr />
          <form action={signOut}>
            <button type="submit" role="menuitem"><LogOut size={18} strokeWidth={1.8} aria-hidden />Se déconnecter</button>
          </form>
        </div>
      )}
    </div>
  );
}
