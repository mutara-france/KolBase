import type { OrgRole } from "@/generated/prisma/client";
import { COMPLIANCE_ROLES, EVENT_MANAGER_ROLES, EVENT_ORGANIZER_ROLES } from "@/lib/events";
import { PROJECT_VIEW_ROLES, REVIEW_ROLES, SOURCING_ROLES } from "@/lib/projects";
import { isAgencyOnly, STATS_ROLES } from "@/lib/org-roles";

/**
 * Navigation de l'espace connecté : cinq rubriques au plus par espace (praticien ou organisation),
 * les pages d'une même rubrique se retrouvant en onglets. Module sans dépendance serveur (utilisé aussi côté client).
 */

export type ShellIcon = "House" | "Users" | "Folder" | "FileText" | "CalendarDays" | "ShieldCheck" | "Send" | "Megaphone" | "UserRound" | "Receipt" | "Plug" | "ExternalLink" | "Wallet" | "BarChart3";
export type ShellItem = { key: string; href: string; label: string; short?: string; icon: ShellIcon; badge?: number; match?: string[]; exact?: boolean; /** Absente de la barre du bas (mobile) quand elle compterait plus de cinq entrées. */ secondary?: boolean };
export type ShellLink = { href: string; label: string; icon: ShellIcon };
export type ShellSpace = {
  key: string;
  title: string;
  subtitle: string;
  chip: string;
  initials: string;
  color: string;
  /** Photo du praticien (espace praticien), à la place des initiales. */
  photo?: string | null;
  square: boolean;
  home: string;
  items: ShellItem[];
  links: ShellLink[];
};
export type SectionTab = { key: string; href: string; label: string; count?: number };
export type OrgSectionKey = "praticiens" | "dossiers" | "evenements" | "conformite";
export type PractitionerSectionKey = "opportunites" | "agenda" | "sollicitations";

const has = (roles: OrgRole[], list: OrgRole[]) => roles.some((r) => list.includes(r));
const pathOf = (href: string) => href.split(/[?#]/)[0];
const ongletOf = (href: string) => new URLSearchParams(href.split("#")[0].split("?")[1] ?? "").get("onglet");

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
    items.push({ key: "dossiers", href: `${base}/dossiers`, label: "Dossiers", icon: "Folder" });
  if (has(roles, EVENT_MANAGER_ROLES))
    items.push({
      key: "evenements",
      href: `${base}/evenements`,
      label: has(roles, EVENT_ORGANIZER_ROLES) ? "Événements" : "Événements confiés",
      short: "Événements",
      icon: "CalendarDays",
      match: [`${base}/prestataires`],
    });
  if (has(roles, COMPLIANCE_ROLES)) items.push({ key: "conformite", href: `${base}/conformite`, label: "Conformité", icon: "ShieldCheck", match: [`${base}/hospitalites`, `${base}/relecture`] });
  if (has(roles, STATS_ROLES)) items.push({ key: "statistiques", href: `${base}/statistiques`, label: "Statistiques", short: "Stats", icon: "BarChart3", secondary: true });
  return items;
}

/** Liens de l'organisation rangés dans le menu du compte (réglages, page publique). */
export function orgMenuLinks(orgId: string, roles: OrgRole[], kind: string): ShellLink[] {
  const base = `/organisations/${orgId}`;
  const links: ShellLink[] = [];
  const isSupplier = kind === "PRESTATAIRE";
  if (isSupplier ? roles.includes("ADMIN") : !roles.every((r) => r === "PRESTATAIRE"))
    links.push({ href: `${base}/membres`, label: "Membres et réglages", icon: "Users" });
  if (roles.includes("ADMIN")) links.push({ href: `${base}/abonnement`, label: "Abonnement", icon: "Wallet" });
  if (!isSupplier && has(roles, ["ADMIN", "PROJETS", "CONFORMITE"])) links.push({ href: `${base}/integrations`, label: "Intégrations", icon: "Plug" });
  // Une agence mandatée agit pour l'organisation sans la représenter : pas de « notre » page publique.
  if (!isSupplier && !isAgencyOnly(roles, kind)) links.push({ href: `/structures/${orgId}`, label: "Voir notre page publique", icon: "ExternalLink" });
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
          has(roles, SOURCING_ROLES) && { key: "appels", href: `${base}/opportunites`, label: "Appels à candidatures" },
        ]
      : section === "dossiers"
        ? [has(roles, PROJECT_VIEW_ROLES) && { key: "dossiers", href: `${base}/dossiers`, label: "Dossiers" }]
        : section === "evenements"
          ? [
              has(roles, EVENT_MANAGER_ROLES) && { key: "evenements", href: `${base}/evenements`, label: has(roles, EVENT_ORGANIZER_ROLES) ? "Événements" : "Événements confiés" },
              has(roles, EVENT_MANAGER_ROLES) && { key: "prestataires", href: `${base}/prestataires`, label: "Prestataires et devis" },
            ]
          : // Espace conformité : un seul niveau d'onglets, de la validation à la publication.
            [
              has(roles, COMPLIANCE_ROLES) && { key: "a-valider", href: `${base}/conformite`, label: "À valider" },
              has(roles, REVIEW_ROLES) && { key: "relecture", href: `${base}/relecture`, label: "Supports à relire" },
              has(roles, COMPLIANCE_ROLES) && { key: "autorisations", href: `${base}/conformite?onglet=autorisations`, label: "Autorisations" },
              has(roles, COMPLIANCE_ROLES) && { key: "hospitalites", href: `${base}/hospitalites`, label: "Hospitalités" },
              has(roles, COMPLIANCE_ROLES) && { key: "registre", href: `${base}/conformite?onglet=registre`, label: "Registre des conventions" },
              has(roles, COMPLIANCE_ROLES) && { key: "transparence", href: `${base}/conformite?onglet=transparence`, label: "Transparence Santé" },
              has(roles, COMPLIANCE_ROLES) && { key: "parametres", href: `${base}/conformite?onglet=parametres`, label: "Paramètres" },
            ];
  return tabs.filter((t): t is SectionTab => !!t);
}

/** Onglets des rubriques du praticien référencé. */
export function practitionerSectionTabs(section: PractitionerSectionKey): SectionTab[] {
  if (section === "sollicitations")
    return [
      { key: "recues", href: "/sollicitations", label: "Sollicitations reçues" },
      { key: "propositions", href: "/propositions", label: "Mes propositions" },
    ];
  return section === "opportunites"
    ? [
        { key: "appels", href: "/opportunites", label: "Appels à candidatures" },
        { key: "candidatures", href: "/interventions?onglet=candidatures", label: "Mes candidatures" },
      ]
    : [
        { key: "inscriptions", href: "/inscriptions", label: "Mes inscriptions" },
        { key: "interventions", href: "/interventions?onglet=interventions", label: "Mes interventions" },
      ];
}

/** Barre du bas (mobile) : cinq entrées au plus ; les secondaires d'abord écartées, le reste passe dans le menu du compte. */
export const BOTTOM_BAR_MAX = 5;
export function bottomBar<T extends Pick<ShellItem, "key" | "secondary">>(items: T[]) {
  const primary = items.length <= BOTTOM_BAR_MAX ? items : items.filter((i) => !i.secondary);
  const bar = primary.slice(0, BOTTOM_BAR_MAX);
  return { bar, overflow: items.filter((i) => !bar.includes(i)) };
}

/** Nombre d'actions qui mènent à une page de cette entrée (pastilles). */
export function countFor(item: Pick<ShellItem, "href" | "match" | "exact">, hrefs: string[]) {
  return hrefs.filter((h) => itemMatches(item, pathOf(h))).length;
}

/**
 * Pastille d'un onglet de rubrique : les actions qui le désignent (`tab`, quand leur lien mène ailleurs, au dossier
 * par exemple), ou dont le lien mène à sa page. Les onglets d'une même page (« ?onglet= ») se distinguent : une action
 * vers l'onglet Transparence ne compte pas pour « À valider », qui partage la même page.
 */
export function tabCount(tab: Pick<SectionTab, "key" | "href">, tabs: Pick<SectionTab, "href">[], todos: { href: string; tab?: string }[]) {
  const path = pathOf(tab.href);
  const onglet = ongletOf(tab.href);
  const siblings = new Set(tabs.filter((t) => pathOf(t.href) === path).map((t) => ongletOf(t.href)).filter(Boolean));
  return todos.filter((todo) => {
    if (todo.tab) return todo.tab === tab.key;
    const p = pathOf(todo.href);
    if (p !== path && !p.startsWith(path + "/")) return false;
    const o = ongletOf(todo.href);
    return onglet ? o === onglet : !o || !siblings.has(o);
  }).length;
}

/**
 * Boutons « Référencer mon organisation » et « Publier un événement » (accueil, aide) : sans compte, création
 * du compte d'une organisation ; connecté, directement la bonne page : nouvel événement de son organisation
 * (organisateur), événements confiés (agence), sinon l'espace de son organisation. Création d'une organisation
 * seulement pour qui n'en a aucune.
 */
export function orgJoinHref(
  user: { memberships: { organizationId: string; role: OrgRole; organization: { kind: string } }[] } | null,
  target: "organisation" | "evenement",
) {
  if (!user) return "/inscription?profil=organisation";
  const client = user.memberships.filter((x) => x.organization.kind !== "PRESTATAIRE");
  if (target === "evenement") {
    const organizer = client.find((x) => EVENT_ORGANIZER_ROLES.includes(x.role));
    if (organizer) return `/organisations/${organizer.organizationId}/evenements/nouveau`;
    const agency = client.find((x) => x.role === "PRESTATAIRE");
    if (agency) return `/organisations/${agency.organizationId}/evenements`;
  }
  const own = client[0] ?? user.memberships[0];
  return own ? `/organisations/${own.organizationId}` : "/organisations/nouvelle";
}
