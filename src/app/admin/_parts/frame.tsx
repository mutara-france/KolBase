import Link from "next/link";
import type { ReactNode } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { PageHead } from "@/components/UI";
import { tasksState } from "@/lib/admin-data";

/**
 * Cadre commun des pages de l'administration KolBase : coque de l'espace connecté (barre latérale « Administration
 * KolBase »), fil d'Ariane, titre, et l'alerte des tâches planifiées en tête de chaque page dès qu'elles ne tournent plus.
 * Chaque page appelle d'abord requirePlatformAdmin().
 */
export async function AdminFrame({ title, desc, crumbs, actions, children, wide = false, taskLink = true }: {
  title: ReactNode;
  desc?: ReactNode;
  crumbs?: { href: string; label: string }[];
  actions?: ReactNode;
  children: ReactNode;
  wide?: boolean;
  /** Lien « Voir l'exploitation » dans l'alerte des tâches (sauf sur la page Exploitation elle-même). */
  taskLink?: boolean;
}) {
  const tasks = await tasksState();
  return (
    <>
      <SiteHeader />
      <main className={`stack admin-page${wide ? " wide" : ""}`}>
        {crumbs && crumbs.length > 0 && (
          <nav className="crumbs muted text-sm" aria-label="Fil d'Ariane">
            {crumbs.map((c, i) => (
              <span key={c.href}>{i > 0 && " › "}<Link href={c.href}>{c.label}</Link></span>
            ))}
          </nav>
        )}
        <PageHead title={title} desc={desc}>{actions}</PageHead>
        {tasks && !tasks.ok && (
          <p className="notice warn">Tâches planifiées : {tasks.detail}{taskLink && <> <Link href="/admin/exploitation#taches">Voir l&apos;exploitation</Link></>}</p>
        )}
        {children}
      </main>
    </>
  );
}

export const ADMIN_HOME = { href: "/admin", label: "Administration" };
