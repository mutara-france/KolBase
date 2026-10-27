import type { OrgRole } from "@/generated/prisma/client";
import { COMPLIANCE_ROLES, EVENT_MANAGER_ROLES, EVENT_ORGANIZER_ROLES } from "@/lib/events";
import { PROJECT_VIEW_ROLES, REVIEW_ROLES, SOURCING_ROLES } from "@/lib/projects";

/**
 * Navigation de l'espace connecté : cinq rubriques au plus par espace (praticien ou organisation),
 * les pages d'une même rubrique se retrouvant en onglets. Module sans dépendance serveur (utilisé aussi côté client).
 */

export type ShellIcon = "House" | "Users" | "Folder" | "FileText" | "CalendarDays" | "ShieldCheck" | "Send" | "Megaphone" | "UserRound" | "Receipt" | "Plug" | "ExternalLink";
export type ShellItem = { key: string; href: string; label: string; short?: string; icon: ShellIcon; badge?: number; match?: string[]; exact?: boolean };
export type ShellLink = { href: string; label: string; icon: ShellIcon };
export type ShellSpace = {
  key: string;
  title: string;
  subtitle: string;
  chip: string;
  initials: string;
  color: string;
  square: boolean;
  home: string;
  items: ShellItem[];
  links: ShellLink[];
};
export type SectionTab = { key: string; href: string; label: string; count?: number };
export type OrgSectionKey = "praticiens" | "dossiers" | "evenements" | "conformite";
export type PractitionerSectionKey = "opportunites" | "agenda";

const has = (roles: OrgRole[], list: OrgRole[]) => roles.some((r) => list.includes(r));
const pathOf = (href: string) => href.split("?")[0];

/** Le chemin courant relève-t-il de cette entrée (son lien ou l'un de ses préfixes) ? */
export function itemMatches(item: Pick<ShellItem, "href" | "match" | "exact">, path: string) {
  if (item.exact) return path === pathOf(item.href);
  return [item.href, ...(item.match ?? [])].map(pathOf).some((m) => path === m || path.startsWith(m + "/"));
}

/** Entrées de la barre latérale d'une organisation, selon les rôles du membre. */
export function orgNavItems(orgId: string, roles: OrgRole[], kind: string): ShellItem[] {
  const base = `/organisations/${orgId}`;
  const items: ShellItem[] = [{ key: "accueil", href: base, label: "Accueil", icon: "House", exact: true }];
  if (kind === "PRESTATAIRE") {
    items.push({ key: "devis", href: `${base}/devis`, label: "Demandes de devis", short: "Devis", icon: "Receipt" });
    return items;
  }
  if (has(roles, SOURCING_ROLES))
    items.push({ key: "praticiens", href: "/annuaire", label: "Praticiens", icon: "Users", match: [`${base}/opportunites`] });
  if (has(roles, PROJECT_VIEW_ROLES))
    items.push({ key: "dossiers", href: `${base}/dossiers`, label: "Dossiers", icon: "Folder", match: [`${base}/relecture`] });
  else if (has(roles, REVIEW_ROLES)) items.push({ key: "dossiers", href: `${base}/relecture`, label: "Relecture", icon: "FileText" });
  if (has(roles, EVENT_MANAGER_ROLES))
    items.push({
      key: "evenements",
      href: `${base}/evenements`,
      label: has(roles, EVENT_ORGANIZER_ROLES) ? "Événements" : "Événements confiés",
      short: "Événements",
      icon: "CalendarDays",
      match: [`${base}/intervenants`, `${base}/prestataires`],
    });
  if (has(roles, COMPLIANCE_ROLES)) items.push({ key: "conformite", href: `${base}/conformite`, label: "Conformité", icon: "ShieldCheck", match: [`${base}/hospitalites`] });
  return items;
}

/** Liens de l'organisation rangés dans le menu du compte (réglages, page publique). */
export function orgMenuLinks(orgId: string, roles: OrgRole[], kind: string): ShellLink[] {
  const base = `/organisations/${orgId}`;
  const links: ShellLink[] = [];
  const isSupplier = kind === "PRESTATAIRE";
  if (isSupplier ? roles.includes("ADMIN") : !roles.every((r) => r === "PRESTATAIRE"))
    links.push({ href: `${base}/membres`, label: "Membres et réglages", icon: "Users" });
  if (!isSupplier && has(roles, ["ADMIN", "EDUCATION", "CUMUL", "CONFORMITE"])) links.push({ href: `${base}/integrations`, label: "Intégrations", icon: "Plug" });
  if (!isSupplier) links.push({ href: `/structures/${orgId}`, label: "Voir notre page publique", icon: "ExternalLink" });
  return links;
}

/** Onglets d'une rubrique d'organisation (chaque onglet est une page existante). */
export function orgSectionTabs(section: OrgSectionKey, orgId: string, roles: OrgRole[], kind: string): SectionTab[] {
  if (kind === "PRESTATAIRE") return [];
  const base = `/organisations/${orgId}`;
  const tabs: (SectionTab | false)[] =
    section === "praticiens"
      ? [
          has(roles, SOURCING_ROLES) && { key: "rechercher", href: "/annuaire", label: "Rechercher" },
          has(roles, SOURCING_ROLES) && { key: "appels", href: `${base}/opportunites`, label: "Appels publiés" },
        ]
      : section === "dossiers"
        ? [
            has(roles, PROJECT_VIEW_ROLES) && { key: "dossiers", href: `${base}/dossiers`, label: "Dossiers" },
            has(roles, REVIEW_ROLES) && { key: "relecture", href: `${base}/relecture`, label: "Relecture" },
          ]
        : section === "evenements"
          ? [
              has(roles, EVENT_MANAGER_ROLES) && { key: "evenements", href: `${base}/evenements`, label: has(roles, EVENT_ORGANIZER_ROLES) ? "Événements" : "Événements confiés" },
              has(roles, EVENT_ORGANIZER_ROLES) && { key: "intervenants", href: `${base}/intervenants`, label: "Appels à intervenants" },
              has(roles, EVENT_MANAGER_ROLES) && { key: "prestataires", href: `${base}/prestataires`, label: "Prestataires et devis" },
            ]
          : [
              has(roles, COMPLIANCE_ROLES) && { key: "conformite", href: `${base}/conformite`, label: "Conventions et transparence" },
              has(roles, COMPLIANCE_ROLES) && { key: "hospitalites", href: `${base}/hospitalites`, label: "Hospitalités" },
            ];
  return tabs.filter((t): t is SectionTab => !!t);
}

/** Onglets des rubriques du praticien référencé. */
export function practitionerSectionTabs(section: PractitionerSectionKey): SectionTab[] {
  return section === "opportunites"
    ? [
        { key: "appels", href: "/opportunites", label: "Appels ouverts" },
        { key: "intervenants", href: "/interventions?onglet=appels", label: "Appels à intervenants" },
        { key: "candidatures", href: "/interventions?onglet=candidatures", label: "Mes candidatures" },
      ]
    : [
        { key: "inscriptions", href: "/inscriptions", label: "Mes inscriptions" },
        { key: "interventions", href: "/interventions?onglet=interventions", label: "Mes interventions" },
      ];
}

/** Nombre d'actions qui mènent à une page de cette entrée (pastilles). */
export function countFor(item: Pick<ShellItem, "href" | "match" | "exact">, hrefs: string[]) {
  return hrefs.filter((h) => itemMatches(item, pathOf(h))).length;
}
