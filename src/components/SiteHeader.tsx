import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { Avatar } from "@/components/Avatar";
import { Logo } from "@/components/Logo";
import { MenuToggle, Sidebar, type NavSection } from "@/components/Sidebar";
import { COMPLIANCE_ROLES, EVENT_MANAGER_ROLES } from "@/lib/events";
import { PROJECT_ROLES, PROJECT_VIEW_ROLES } from "@/lib/projects";
import type { OrgRole } from "@/generated/prisma/client";

/**
 * En-tête du site.
 * - « public » : navigation publique (accueil, agenda, pages légales…).
 * - « app » (défaut) : coque applicative avec barre latérale par rôle, si l'utilisateur est connecté.
 */
export async function SiteHeader({ variant = "app" }: { variant?: "app" | "public" }) {
  const user = await getCurrentUser();

  if (!user || variant === "public") {
    return (
      <header className="public-nav">
        <Logo />
        <nav>
          <Link href="/evenements" className="nav-link">Événements</Link>
          <Link href="/annuaire" className="nav-link">Experts</Link>
          <Link href="/opportunites" className="nav-link">Opportunités</Link>
          {user ? (
            <Link href="/compte" className="btn">Mon espace</Link>
          ) : (
            <>
              <Link href="/connexion" className="nav-link">Se connecter</Link>
              <Link href="/inscription" className="btn">Créer un compte</Link>
            </>
          )}
        </nav>
      </header>
    );
  }

  const p = user.practitioner;
  const pending = p
    ? await db.projectExpert.count({ where: { practitionerId: p.id, status: "ATT_EXPERTS", project: { status: { not: "DECLINE" } } } })
    : 0;
  const has = (roles: OrgRole[], mine: OrgRole[]) => mine.some((r) => roles.includes(r));

  const sections: NavSection[] = [];
  if (p) {
    sections.push({
      title: p.listed ? "Mon activité d'expert" : "Mon espace",
      items: [
        { href: "/inscriptions", label: "Mes inscriptions", icon: "Ticket" },
        ...(p.listed
          ? [
              { href: "/sollicitations", label: "Sollicitations", icon: "Inbox" as const, badge: pending },
              { href: "/opportunites", label: "Opportunités", icon: "Megaphone" as const },
            ]
          : []),
      ],
    });
  }

  const orgs = new Map<string, { name: string; roles: OrgRole[] }>();
  for (const m of user.memberships) {
    const o = orgs.get(m.organizationId) ?? { name: m.organization.name, roles: [] };
    o.roles.push(m.role);
    orgs.set(m.organizationId, o);
  }
  for (const [id, o] of orgs) {
    const base = `/organisations/${id}`;
    sections.push({
      title: "Organisation",
      subtitle: o.name,
      items: [
        { href: base, label: "Tableau de bord", icon: "Building2", exact: true },
        ...(has(PROJECT_VIEW_ROLES, o.roles) ? [{ href: `${base}/dossiers`, label: "Dossiers", icon: "ClipboardList" as const }] : []),
        ...(has(PROJECT_ROLES, o.roles) ? [{ href: `${base}/opportunites`, label: "Opportunités", icon: "Megaphone" as const }] : []),
        ...(has(EVENT_MANAGER_ROLES, o.roles) ? [{ href: `${base}/evenements`, label: "Événements", icon: "CalendarDays" as const }] : []),
        ...(has(COMPLIANCE_ROLES, o.roles) ? [{ href: `${base}/hospitalites`, label: "Hospitalités", icon: "Gift" as const }] : []),
      ],
    });
  }

  sections.push({
    title: "Explorer",
    items: [
      { href: "/evenements", label: "Agenda", icon: "CalendarDays" },
      ...(orgs.size > 0 || p?.listed ? [{ href: "/annuaire", label: "Annuaire des experts", icon: "Search" as const }] : []),
    ],
  });
  sections.push({
    title: "Réglages",
    items: [
      { href: "/compte", label: "Mon compte", icon: "Settings" },
      { href: "/organisations", label: "Mes organisations", icon: "Users", exact: true },
    ],
  });

  const fullName = `${user.firstName} ${user.lastName}`;
  const role = p ? (p.listed ? "Praticien · expert référencé" : "Praticien") : orgs.size > 0 ? [...orgs.values()][0].name : "Compte";

  return (
    <>
      <header className="top-bar">
        <div className="top-actions">
          <MenuToggle />
          <Logo />
        </div>
        <div className="top-actions">
          <Link href="/compte" className="session-chip" title="Mon compte">
            <Avatar name={fullName} size={30} square />
            <span className="session-text">
              <span className="session-name">{p ? "Dr " : ""}{fullName}</span>
              <br />
              <span className="session-role">{role}</span>
            </span>
          </Link>
        </div>
      </header>
      <Sidebar sections={sections} />
    </>
  );
}
