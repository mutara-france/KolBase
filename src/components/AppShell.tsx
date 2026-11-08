"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  Activity, BadgeCheck, BarChart3, Bell, CalendarDays, Check, ChevronDown, ExternalLink, FileText, Folder, House, LogOut, Megaphone, Newspaper, PanelLeftClose, PanelLeftOpen, Plug, Receipt, ScrollText, Send, ShieldCheck, Store, UserRound, Users, Building2, Wallet,
} from "lucide-react";
import { Logo } from "@/components/Logo";
import { signOut } from "@/lib/auth-actions";
import { bottomBar, itemMatches, NAV_COOKIE, type ShellIcon, type ShellItem, type ShellSpace } from "@/lib/nav";
import { useT } from "@/components/I18nProvider";

const ICONS: Record<ShellIcon, typeof House> = { House, Users, Folder, FileText, CalendarDays, ShieldCheck, Send, Megaphone, UserRound, Receipt, Plug, ExternalLink, Wallet, BarChart3, Store, Building2, BadgeCheck, ScrollText, Newspaper, Activity };
const COOKIE = "kb_espace";

const spaceMatches = (s: ShellSpace, path: string) => path === s.home || path.startsWith(s.home + "/") || s.items.some((i) => itemMatches(i, path));

/** Espace courant : celui de la page ouverte, sinon le dernier utilisé, sinon le premier. */
function resolveSpace(spaces: ShellSpace[], path: string, preferred?: string) {
  const pref = spaces.find((s) => s.key === preferred);
  if (pref && spaceMatches(pref, path)) return pref;
  return spaces.find((s) => spaceMatches(s, path)) ?? pref ?? spaces[0];
}

export type ShellUser = { name: string; initials: string; color: string; photo?: string | null };

export function AppShell({
  user,
  spaces,
  initialSpace,
  activeKey,
  bell,
  admin = false,
  navOpen = false,
}: {
  user: ShellUser;
  spaces: ShellSpace[];
  initialSpace?: string;
  activeKey?: string;
  bell: { count: number } | null;
  /** Administrateur de la plateforme KolBase : lien vers l'administration. */
  admin?: boolean;
  /** Barre latérale ouverte au chargement (cookie kb_nav), repliée sinon. */
  navOpen?: boolean;
}) {
  const path = usePathname();
  const t = useT();
  const space = resolveSpace(spaces, path, initialSpace);
  const [open, setOpen] = useState(navOpen);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    document.cookie = next ? `${NAV_COOKIE}=1; path=/; max-age=31536000; samesite=lax` : `${NAV_COOKIE}=; path=/; max-age=0; samesite=lax`;
  };
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
            <Link href="/suivis" className={`icon-btn${path === "/suivis" ? " active" : ""}`} aria-label={bell.count ? (bell.count > 1 ? t("Suivis, {n} nouveautés", { n: bell.count }) : t("Suivis, {n} nouveauté", { n: bell.count })) : t("Suivis")}>
              <Bell size={19} strokeWidth={1.8} aria-hidden />
              {bell.count > 0 && <span className="icon-badge" aria-hidden>{bell.count}</span>}
            </Link>
          )}
          <AccountMenu user={user} space={space} spaces={spaces} admin={admin} />
        </div>
      </header>

      {space && (
        <aside id="barre-laterale" className={`sidebar${open ? " open" : ""}`} aria-label={t("Navigation")}>
          {/* L'espace courant figure déjà en haut à droite (nom, organisation) ; on en change depuis ce menu. */}
          <nav className="side-nav" aria-label={space.title}>
            {space.items.map((i) => {
              const Icon = ICONS[i.icon];
              return (
                <Link key={i.key} href={i.href} className={`side-link${isActive(i) ? " active" : ""}`} aria-current={isActive(i) ? "page" : undefined}>
                  <Icon size={20} strokeWidth={1.8} aria-hidden />
                  {/* Repliée : le libellé reste lu par les lecteurs d'écran et s'affiche en bulle au survol ou au focus. */}
                  <span className="side-label">{i.label}</span>
                  {i.badge ? <span className="side-badge" aria-label={t("{n} à traiter", { n: i.badge })}>{i.badge}</span> : null}
                </Link>
              );
            })}
          </nav>
          <button type="button" className="side-toggle" onClick={toggle} aria-expanded={open} aria-controls="barre-laterale">
            {open ? <PanelLeftClose size={20} strokeWidth={1.8} aria-hidden /> : <PanelLeftOpen size={20} strokeWidth={1.8} aria-hidden />}
            <span className="side-label">{open ? t("Réduire le menu") : t("Ouvrir le menu")}</span>
          </button>
        </aside>
      )}

      {space && (
        <nav className="bottom-nav" aria-label={t("Navigation principale")}>
          {bottomBar(space.items).bar.map((i) => {
            const Icon = ICONS[i.icon];
            return (
              <Link key={i.key} href={i.href} className={isActive(i) ? "active" : undefined} aria-current={isActive(i) ? "page" : undefined}>
                <Icon size={22} strokeWidth={isActive(i) ? 2 : 1.8} aria-hidden />
                <span>{i.short ?? i.label}</span>
                {i.badge ? <span className="bottom-badge" aria-label={t("{n} à traiter", { n: i.badge })}>{i.badge}</span> : null}
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
    <span className={`space-mark${space.photo ? " photo" : ""}`} style={{ width: size, height: size, background: space.color, borderRadius: space.square ? 12 : 999 }} aria-hidden>
      {space.photo ? <img src={space.photo} alt="" width={size} height={size} /> : space.initials}
    </span>
  );
}

/** Menu sous l'avatar : réglages de l'espace, compte, aide, déconnexion. */
function AccountMenu({ user, space, spaces, admin }: { user: ShellUser; space?: ShellSpace; spaces: ShellSpace[]; admin: boolean }) {
  const [open, setOpen] = useState(false);
  const t = useT();
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
        <span className={`avatar${user.photo ? " photo" : ""}`} style={{ width: 36, height: 36, fontSize: 13, background: user.color }} aria-hidden>{user.photo ? <img src={user.photo} alt="" width={36} height={36} /> : user.initials}</span>
        <span className="session-text">
          <span className="session-name">{user.name}</span>
          <span className="session-role">{space?.chip ?? t("Mon compte")}</span>
        </span>
        <ChevronDown size={16} className="session-chevron" aria-hidden />
      </button>
      {open && (
        <div className="account-menu" role="menu" aria-label={t("Menu du compte")} onClick={(e) => (e.target as HTMLElement).closest("a") && setOpen(false)}>
          <div className="account-head">
            <strong>{user.name}</strong>
            {space && <span>{space.chip === space.title ? space.subtitle : space.chip}</span>}
          </div>
          {spaces.length > 1 && (
            <>
              <p className="account-label">{t("Changer d'espace")}</p>
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
              <p className="account-label">{isPractitioner ? t("Mon compte") : space.title}</p>
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
          {/* Mobile : les rubriques qui ne tiennent pas dans la barre du bas (cinq entrées au plus). */}
          {space && bottomBar(space.items).overflow.length > 0 && (
            <div className="menu-mobile-only">
              <p className="account-label">{t("Autres rubriques")}</p>
              {bottomBar(space.items).overflow.map((i) => {
                const Icon = ICONS[i.icon];
                return (
                  <Link key={i.key} href={i.href} role="menuitem">
                    <Icon size={18} strokeWidth={1.8} aria-hidden />
                    {i.label}
                  </Link>
                );
              })}
            </div>
          )}
          <hr />
          {!isPractitioner && (
            <>
              <Link href="/compte" role="menuitem"><UserRound size={18} strokeWidth={1.8} aria-hidden />{t("Mon compte")}</Link>
              {/* Inscriptions aux événements : rubrique de l'espace praticien, ici pour les autres comptes. */}
              <Link href="/inscriptions" role="menuitem"><CalendarDays size={18} strokeWidth={1.8} aria-hidden />{t("Mes inscriptions")}</Link>
            </>
          )}
          <Link href="/organisations" role="menuitem"><Building2 size={18} strokeWidth={1.8} aria-hidden />{t("Mes organisations")}</Link>
          {admin && <Link href="/admin" role="menuitem"><ShieldCheck size={18} strokeWidth={1.8} aria-hidden />{t("Administration KolBase")}</Link>}
          <hr />
          <form action={signOut}>
            <button type="submit" role="menuitem"><LogOut size={18} strokeWidth={1.8} aria-hidden />{t("Se déconnecter")}</button>
          </form>
        </div>
      )}
    </div>
  );
}
