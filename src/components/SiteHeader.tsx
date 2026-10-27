import { cookies } from "next/headers";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { avatarColor, initialsOf } from "@/components/Avatar";
import { AppShell } from "@/components/AppShell";
import { PublicNav } from "@/components/PublicNav";
import { ORG_KIND_LABEL, ROLE_LABEL } from "@/lib/orgs";
import { countFor, orgMenuLinks, orgNavItems, type ShellItem, type ShellSpace } from "@/lib/nav";
import { orgOverview } from "@/lib/org-overview";
import { SOURCING_ROLES } from "@/lib/projects";
import { unseenFollowCount } from "@/lib/follows";
import type { OrgKind, OrgRole } from "@/generated/prisma/client";

/**
 * En-tête du site.
 * - « public » : navigation publique (accueil, agenda, pages légales…).
 * - « app » (défaut) : coque de l'espace connecté — un espace par rôle (praticien, chaque organisation),
 *   cinq rubriques au plus, réglages et déconnexion dans le menu du compte.
 * `section` force la rubrique active quand le chemin ne suffit pas (pages partagées entre deux rubriques).
 */
export async function SiteHeader({ variant = "app", section }: { variant?: "app" | "public"; section?: string }) {
  const user = await getCurrentUser();

  if (!user || variant === "public") return <PublicNav loggedIn={!!user} />;

  const fullName = `${user.firstName} ${user.lastName}`;
  const p = user.practitioner;
  const spaces: ShellSpace[] = [];

  if (p) {
    const pending = p.listed
      ? await db.projectExpert.count({ where: { practitionerId: p.id, status: "ATT_EXPERTS", project: { status: { not: "DECLINE" } } } })
      : 0;
    const items: ShellItem[] = [
      { key: "accueil", href: "/tableau-de-bord", label: "Accueil", icon: "House" },
      ...(p.listed
        ? ([
            { key: "sollicitations", href: "/sollicitations", label: "Sollicitations", icon: "Send", badge: pending },
            { key: "opportunites", href: "/opportunites", label: "Opportunités", icon: "Megaphone", match: ["/interventions"] },
          ] satisfies ShellItem[])
        : []),
      { key: "agenda", href: "/inscriptions", label: "Agenda", icon: "CalendarDays", match: p.listed ? ["/interventions"] : [] },
      { key: "profil", href: "/compte", label: "Mon profil", short: "Profil", icon: "UserRound" },
    ];
    spaces.push({
      key: "praticien",
      title: "Espace praticien",
      subtitle: [p.specialty || p.profession, p.city].filter(Boolean).join(" · ") || (p.listed ? "Expert référencé" : "Praticien"),
      chip: p.listed ? "Expert référencé" : "Praticien",
      initials: initialsOf(fullName),
      color: avatarColor(fullName),
      square: false,
      home: "/tableau-de-bord",
      items,
      links: p.listed ? [{ href: `/experts/${p.id}`, label: "Voir ma fiche publique", icon: "ExternalLink" }] : [],
    });
  }

  const orgs = new Map<string, { name: string; kind: OrgKind; roles: OrgRole[] }>();
  for (const m of user.memberships) {
    const o = orgs.get(m.organizationId) ?? { name: m.organization.name, kind: m.organization.kind, roles: [] };
    o.roles.push(m.role);
    orgs.set(m.organizationId, o);
  }
  for (const [id, o] of orgs) {
    const overview = await orgOverview(id);
    const hrefs = (overview?.todos ?? []).map((t) => t.href);
    spaces.push({
      key: id,
      title: o.name,
      subtitle: `${ORG_KIND_LABEL[o.kind]} · ${o.roles.map((r) => ROLE_LABEL[r]).join(", ")}`,
      chip: o.name,
      initials: initialsOf(o.name),
      color: avatarColor(o.name),
      square: true,
      home: `/organisations/${id}`,
      items: orgNavItems(id, o.roles, o.kind).map((i) => (i.key === "accueil" ? i : { ...i, badge: countFor(i, hrefs) })),
      links: orgMenuLinks(id, o.roles, o.kind),
    });
  }

  const sourcing = user.memberships.some((m) => SOURCING_ROLES.includes(m.role) && m.organization.kind !== "PRESTATAIRE");
  const showBell = sourcing || !!p?.listed;
  const followCount = showBell && (await db.follow.count({ where: { userId: user.id } })) ? await unseenFollowCount(user.id, user.followsSeenAt) : 0;
  const initialSpace = (await cookies()).get("kb_espace")?.value;

  return (
    <AppShell
      user={{ name: `${p ? "Dr " : ""}${fullName}`, initials: initialsOf(fullName), color: avatarColor(fullName) }}
      spaces={spaces}
      initialSpace={initialSpace ? decodeURIComponent(initialSpace) : undefined}
      activeKey={section}
      bell={showBell ? { count: followCount } : null}
    />
  );
}
