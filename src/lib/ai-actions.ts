"use server";

import { db } from "@/lib/db";
import { audit, requireUser } from "@/lib/auth";
import { requireMembership } from "@/lib/orgs";
import { aiComplete, aiEnabled } from "@/lib/ai";
import { blockedFor, hit } from "@/lib/rate-limit";
import { EVENT_MANAGER_ROLES, EVENT_ORGANIZER_ROLES, eventScope, eventTypeLabel, FORMAT_LABEL } from "@/lib/events";
import { collabType, SOURCING_ROLES } from "@/lib/projects";
import { supplierCategoryLabel } from "@/lib/suppliers";
import { drPrefix } from "@/lib/professions";
import { str } from "@/lib/form";

export type AiResult = { text?: string; error?: string };

const PER_HOUR = 30;
const cut = (s: string, n = 1500) => s.trim().slice(0, n);
const when = (d: Date) => d.toLocaleString("fr-FR", { timeZone: "Europe/Paris", weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** Contexte d'un événement transmis à l'assistant (sans donnée personnelle hors intervenants). */
async function eventContext(eventId: string, orgId: string, scope: object) {
  const e = await db.event.findFirst({
    where: { id: eventId, organizationId: orgId, ...scope },
    include: {
      organization: { select: { name: true } },
      benefits: true,
      calls: { include: { applications: { where: { status: "retained" }, include: { practitioner: { include: { user: { select: { firstName: true, lastName: true } } } } } } } },
      project: { include: { experts: { where: { status: { notIn: ["DECLINE", "ATT_EXPERTS"] } }, include: { practitioner: { include: { user: { select: { firstName: true, lastName: true } } } } } } } },
    },
  });
  if (!e) return null;
  const people = [...e.calls.flatMap((c) => c.applications.map((a) => a.practitioner)), ...(e.project?.experts.map((x) => x.practitioner) ?? [])];
  const speakers = [...new Map(people.map((p) => [p.id, `${drPrefix(p.profession)}${p.user.firstName} ${p.user.lastName}${p.specialty ? ` (${p.specialty})` : ""}`])).values()];
  return {
    e,
    text: [
      `Événement : « ${e.title} » organisé par ${e.organization.name}.`,
      `Type : ${eventTypeLabel(e.typeId)}${e.therapeuticArea ? `, domaine : ${e.therapeuticArea}` : ""}. Format : ${FORMAT_LABEL[e.format]}.`,
      `Début : ${when(e.startsAt)}${e.durationMinutes ? `, durée : ${e.durationMinutes} minutes` : ""}.`,
      e.format !== "DISTANCIEL" ? `Lieu : ${[e.venue, e.city].filter(Boolean).join(", ") || "[à compléter]"}.` : "En ligne.",
      e.capacity ? `Participants attendus : ${e.capacity}.` : "",
      e.internal ? "Réunion interne (comité, board), non publique." : "",
      e.description ? `Présentation : ${cut(e.description, 800)}` : "",
      speakers.length ? `Intervenants confirmés : ${speakers.join(" ; ")}.` : "Intervenants : pas encore confirmés.",
      e.benefits.length ? `Hospitalités prévues : ${e.benefits.map((b) => b.label).join(", ")}.` : "",
    ].filter(Boolean).join("\n"),
  };
}

/**
 * Brouillon rédigé par l'assistant pour un champ de formulaire. Le contexte est relu en base (droits compris) ;
 * seuls quelques champs du formulaire en cours sont repris. L'appel est tracé, sans son contenu.
 */
export async function aiDraft(form: FormData): Promise<AiResult> {
  const user = await requireUser();
  if (!aiEnabled()) return { error: "L'assistant de rédaction n'est pas activé sur cette plateforme." };
  const key = `ai:${user.id}`;
  if (blockedFor(key, PER_HOUR, 60 * 60 * 1000)) return { error: "Vous avez beaucoup sollicité l'assistant : réessayez dans une heure." };
  const kind = str(form, "aiKind");
  const orgId = str(form, "orgId");
  let prompt: string | null = null;

  if (kind === "programme") {
    const { user: u, roles } = await requireMembership(orgId, EVENT_MANAGER_ROLES);
    const ctx = await eventContext(str(form, "eventId"), orgId, eventScope(u, roles));
    if (!ctx) return { error: "Événement introuvable." };
    const current = str(form, "program");
    prompt = `${ctx.text}\n\n${current ? `Programme actuel, à améliorer :\n${cut(current)}\n\n` : ""}Rédige le programme scientifique de cet événement sous forme de déroulé horaire : une ligne par séquence, au format « 18:30 – 18:45  Titre de la séquence — intervenant ». Commence à l'heure de début, respecte la durée, place l'accueil, les sessions scientifiques, les temps d'échange avec la salle et les pauses ou le cocktail prévus. Répartis les intervenants confirmés sur des sujets cohérents avec le domaine ; s'il en manque, écris [intervenant à confirmer]. Termine par une courte phrase sur les objectifs pédagogiques.`;
  } else if (kind === "besoin") {
    const { user: u, roles } = await requireMembership(orgId, EVENT_MANAGER_ROLES);
    const eventId = str(form, "eventId");
    const ctx = eventId ? await eventContext(eventId, orgId, eventScope(u, roles)) : null;
    const category = supplierCategoryLabel(str(form, "category"));
    const headcount = str(form, "headcount");
    prompt = `${ctx?.text ?? "Pas d'événement précisé."}\n\nPrestation recherchée : ${category}.${headcount ? ` Participants : ${headcount}.` : ""}\n${str(form, "needs") ? `Notes de l'organisateur : ${cut(str(form, "needs"), 800)}\n` : ""}\nRédige la description du besoin envoyée aux prestataires consultés (6 à 10 lignes) : prestations attendues, quantités, horaires et contraintes logistiques, niveau de service, éléments à faire figurer dans le devis (détail ligne par ligne, TVA, conditions d'annulation). Pour la restauration ou l'hébergement, rappelle que le coût par participant doit rester raisonnable au regard des seuils d'hospitalité.`;
  } else if (kind === "objet") {
    await requireMembership(orgId, SOURCING_ROLES);
    const type = collabType(str(form, "typeId"));
    prompt = `Dossier de collaboration avec des praticiens : « ${cut(str(form, "title"), 200) || "[titre à compléter]"} ».\nType : ${type?.label ?? "[à compléter]"} (unité : ${type?.unit ?? "?"}).${str(form, "therapeuticArea") ? ` Domaine : ${cut(str(form, "therapeuticArea"), 100)}.` : ""}\n${str(form, "description") ? `Notes : ${cut(str(form, "description"), 800)}\n` : ""}\nRédige l'objet et le déroulé de la collaboration (6 à 10 lignes), tel qu'il figurera dans la convention : contexte et objectif, prestations attendues de l'expert, livrables, calendrier ([à compléter] si inconnu), modalités (présentiel, distanciel). Le contenu doit justifier un besoin réel et légitime, sans visée promotionnelle.`;
  } else if (kind === "appel") {
    const { user: u, roles } = await requireMembership(orgId, SOURCING_ROLES);
    const type = collabType(str(form, "typeId"));
    const budget = [str(form, "budgetMin"), str(form, "budgetMax")].filter(Boolean).join(" à ");
    const ctx = str(form, "eventId") ? await eventContext(str(form, "eventId"), orgId, eventScope(u, roles)) : null;
    prompt = `Appel à candidatures publié par une organisation du secteur dentaire : « ${cut(str(form, "title"), 200) || "[titre à compléter]"} ».\nType de collaboration : ${type?.label ?? "[à compléter]"}.${str(form, "specialty") ? ` Spécialité recherchée : ${cut(str(form, "specialty"), 100)}.` : ""}${budget ? ` Budget : ${budget} € HT.` : ""}${str(form, "slots") ? ` Places : ${str(form, "slots")}.` : ""}\n${ctx ? `Appel rattaché à cet événement, où la personne retenue interviendra :\n${ctx.text}\n` : ""}${str(form, "description") ? `Notes : ${cut(str(form, "description"), 800)}\n` : ""}\nRédige la description de l'appel (6 à 10 lignes) : contexte, mission proposée${ctx ? " (thème, format et durée de l'intervention)" : ""}, profil recherché, engagement attendu (dates [à compléter] si inconnues), modalités de sélection. Précise qu'une convention écrite encadre la collaboration.`;
  } else if (kind === "offre") {
    const { org } = await requireMembership(orgId);
    if (org.kind !== "PRESTATAIRE") return { error: "Action réservée aux prestataires." };
    const invite = await db.rfqSupplier.findUnique({ where: { rfqId_supplierId: { rfqId: str(form, "rfqId"), supplierId: orgId } }, include: { rfq: { include: { event: true } } } });
    if (!invite) return { error: "Demande introuvable." };
    const r = invite.rfq;
    const labels = form.getAll("line_label").map(String), qtys = form.getAll("line_qty").map(String), units = form.getAll("line_unit").map(String);
    const lines = labels.map((l, i) => (l ? `- ${cut(l, 120)} : ${qtys[i] || 1} × ${units[i] || "?"} € HT` : "")).filter(Boolean).slice(0, 20);
    prompt = `Demande de devis (${supplierCategoryLabel(r.category)})${r.event ? ` pour l'événement « ${r.event.title} » du ${when(r.event.startsAt)}${r.event.city ? ` à ${r.event.city}` : ""}` : ""}.${r.headcount ? ` Participants : ${r.headcount}.` : ""}\nBesoin exprimé : ${cut(r.needs, 1000)}\n${lines.length ? `Lignes du devis :\n${lines.join("\n")}\n` : ""}${str(form, "note") ? `Notes du prestataire : ${cut(str(form, "note"), 600)}\n` : ""}\nRédige la présentation de l'offre (5 à 8 lignes) : ce qui est inclus, comment l'offre répond au besoin, options éventuelles, organisation le jour J. Ne mentionne pas de prix qui ne figurent pas dans les lignes.`;
  } else {
    return { error: "Demande inconnue." };
  }

  hit(key);
  try {
    const text = await aiComplete(prompt, kind === "programme" ? 1600 : 900);
    await audit(user.id, "ai.draft", "Organization", orgId, { kind });
    return { text };
  } catch (e) {
    console.error("[assistant]", e);
    return { error: "L'assistant n'a pas pu répondre. Réessayez dans un instant." };
  }
}
