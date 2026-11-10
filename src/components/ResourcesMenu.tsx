"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BookOpenText, ChartColumn, ChevronDown, Newspaper } from "lucide-react";
import { useT } from "@/components/I18nProvider";

/** Entrées du menu « Ressources » de la barre publique : libellé, légende d'une ligne, icône. */
export const RESOURCE_LINKS = [
  { href: "/actualites", label: "Actualités", hint: "Réglementation, plateforme, conseils", icon: Newspaper },
  { href: "/barometre", label: "Le baromètre de la collaboration dentaire", hint: "Chiffres et tendances des collaborations", icon: ChartColumn },
  { href: "/aide", label: "Base de connaissances", hint: "Premiers pas, questions fréquentes et guides", icon: BookOpenText },
] as const;

const within = (path: string, href: string) => path === href || path.startsWith(`${href}/`);

/**
 * Menu déroulant « Ressources » : ouvert au survol (souris) ou épinglé (clic, clavier, toucher) ; fermé par Échap,
 * par un clic ailleurs ou en changeant de page. Le panneau est rendu hors de la barre (portail) : la rangée de liens
 * défile et est masquée en dégradé sur téléphone, ce qui rognerait un panneau positionné dedans. Il est placé sous le
 * bouton (ordinateur) ou sur toute la largeur sous la barre (téléphone).
 */
export function ResourcesMenu() {
  const path = usePathname();
  const t = useT();
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const leaving = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = useId();
  const open = hover || pinned;
  const active = RESOURCE_LINKS.some((l) => within(path, l.href));

  // Survol : un court délai à la sortie, le temps de passer du bouton au panneau sans que le menu se referme.
  const enter = () => { if (leaving.current) clearTimeout(leaving.current); setHover(true); };
  const leave = () => { leaving.current = setTimeout(() => setHover(false), 150); };

  // biome-ignore lint/correctness/useExhaustiveDependencies: se déclenche à chaque changement d'adresse
  useEffect(() => { setHover(false); setPinned(false); }, [path]);

  useEffect(() => {
    if (!open) return;
    const btn = root.current?.getBoundingClientRect();
    const bar = root.current?.closest("header")?.getBoundingClientRect();
    setPos({ top: Math.round((bar?.bottom ?? btn?.bottom ?? 0) + 6), left: Math.round(btn?.left ?? 0) });
    const inside = (n: Node) => root.current?.contains(n) || panel.current?.contains(n);
    const onDown = (e: PointerEvent) => { if (!inside(e.target as Node)) { setHover(false); setPinned(false); } };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setHover(false); setPinned(false); root.current?.querySelector("button")?.focus(); } };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <div ref={root} className="nav-menu" onMouseEnter={enter} onMouseLeave={leave}>
      <button
        type="button"
        className={`nav-link nav-menu-btn${active ? " on" : ""}${open ? " open" : ""}`}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setPinned((p) => !p)}
        onKeyDown={(e) => { if (e.key === "ArrowDown") { e.preventDefault(); setPinned(true); setTimeout(() => panel.current?.querySelector("a")?.focus(), 0); } }}
      >
        {t("Ressources")} <ChevronDown size={16} aria-hidden />
      </button>
      {open && pos && createPortal(
        <div ref={panel} id={id} className="nav-panel" style={{ top: pos.top, left: pos.left }} onMouseEnter={enter} onMouseLeave={leave}>
          {RESOURCE_LINKS.map((l) => (
            <Link key={l.href} href={l.href} className={within(path, l.href) ? "current" : undefined} aria-current={within(path, l.href) ? "page" : undefined}>
              <l.icon size={18} aria-hidden />
              <span><strong>{t(l.label)}</strong><small>{t(l.hint)}</small></span>
            </Link>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
