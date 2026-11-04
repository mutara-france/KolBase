"use server";

import { db } from "@/lib/db";
import { audit, requireUser } from "@/lib/auth";
import { requireMembership } from "@/lib/orgs";
import { aiComplete, aiEnabled } from "@/lib/ai";
import { blockedFor, hit } from "@/lib/rate-limit";
import { COMPLIANCE_ROLES, EVENT_MANAGER_ROLES, eventScope, eventTypeLabel, FORMAT_LABEL } from "@/lib/events";
import { collabType, fmvCheck, SOURCING_ROLES } from "@/lib/projects";
import { complianceSettings, projectRegime, REGIME_LABEL } from "@/lib/compliance";
import { detectConflicts } from "@/lib/conflicts";
import { suggestExperts, type Suggestion } from "@/lib/expert-suggest";
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

// ─── Suggestion d'experts et relecture assistée d'un dossier ──────────────────

export type SuggestResult = { suggestions?: Suggestion[]; summary?: string; error?: string };

/**
 * Experts suggérés pour un besoin (classement explicable, sans IA) ; l'assistant, s'il est activé,
 * résume en quelques lignes quels profils solliciter et pourquoi, à partir des seules données transmises.
 */
export async function suggestExpertsAction(form: FormData): Promise<SuggestResult> {
  const orgId = str(form, "orgId");
  const { user } = await requireMembership(orgId, SOURCING_ROLES);
  const need = { title: cut(str(form, "title"), 200), typeId: str(form, "typeId"), area: cut(str(form, "therapeuticArea"), 100), description: cut(str(form, "description"), 1500) };
  if (!need.title && !need.area && !need.description) return { error: "Renseignez au moins le titre ou le domaine thérapeutique." };
  const suggestions = await suggestExperts(orgId, need);
  if (suggestions.length === 0) return { suggestions, summary: undefined };
  let summary: string | undefined;
  const key = `ai:${user.id}`;
  if (aiEnabled() && !blockedFor(key, PER_HOUR, 60 * 60 * 1000)) {
    hit(key);
    const type = collabType(need.typeId);
    const prompt = `Besoin d'une organisation du secteur dentaire : « ${need.title || "[sans titre]"} », ${type?.label ?? "collaboration"}${need.area ? `, domaine : ${need.area}` : ""}.${need.description ? `\nObjet : ${need.description}` : ""}\n\nExperts présélectionnés par KolBase (données du profil, liens d'intérêts connus) :\n${suggestions.map((s, i) => `${i + 1}. ${s.name} (${s.detail}) — atouts : ${s.reasons.join(" ; ") || "aucun"}${s.notes.length ? ` — ${s.notes.join(" ; ")}` : ""}${s.warnings.length ? ` — vigilance : ${s.warnings.join(" ; ")}` : ""}`).join("\n")}\n\nEn 4 à 6 lignes, recommande quels experts solliciter en priorité et pourquoi, en t'appuyant uniquement sur ces informations. Favorise la diversité des experts sollicités et signale les liens d'intérêts à examiner. Pas de liste numérotée, pas de jugement sur les personnes.`;
    try {
      summary = await aiComplete(prompt, 500);
      await audit(user.id, "ai.suggest", "Organization", orgId, { candidates: suggestions.length });
    } catch (e) {
      console.error("[assistant]", e);
    }
  }
  return { suggestions, summary };
}

/** Relecture assistée d'un dossier pour l'équipe conformité : points à vérifier, avis proposé, message au chef de projet. */
export async function aiReviewProject(form: FormData): Promise<AiResult> {
  const orgId = str(form, "orgId");
  const { user, org } = await requireMembership(orgId, COMPLIANCE_ROLES);
  if (!aiEnabled()) return { error: "L'assistant n'est pas activé sur cette plateforme." };
  const key = `ai:${user.id}`;
  if (blockedFor(key, PER_HOUR, 60 * 60 * 1000)) return { error: "Vous avez beaucoup sollicité l'assistant : réessayez dans une heure." };
  const p = await db.project.findFirst({
    where: { id: str(form, "projectId"), organizationId: orgId },
    include: {
      experts: { where: { status: { not: "DECLINE" } }, include: { practitioner: { include: { user: { select: { firstName: true, lastName: true } } } } } },
      events: { include: { benefits: true } },
      documents: { select: { name: true } },
      expenses: { select: { label: true, amountCents: true } },
    },
  });
  if (!p) return { error: "Dossier introuvable." };
  const settings = complianceSettings(org.complianceSettings);
  const type = collabType(p.typeId);
  const regime = projectRegime(settings, type?.unit ?? "", p.experts.map((e) => ({ ...e, country: e.practitioner.country })));
  const conflicts = await detectConflicts(p.id);
  const eur = (c: number | null) => (c == null ? "?" : `${(c / 100).toLocaleString("fr-FR")} €`);
  const lines = p.experts.map((e) => {
    const f = fmvCheck(p.typeId, e.feeCents, e.days);
    const fmv = f ? `${Math.round(f.perUnit).toLocaleString("fr-FR")} € par ${f.unit} (repère ${f.min}–${f.max} € : ${f.verdict === "ok" ? "dans la fourchette" : f.verdict === "above" ? "AU-DESSUS" : "en dessous"})` : "juste contrepartie non calculable";
    return `- ${drPrefix(e.practitioner.profession)}${e.practitioner.user.firstName} ${e.practitioner.user.lastName}${e.practitioner.specialty ? ` (${e.practitioner.specialty})` : ""} : ${eur(e.feeCents)} HT pour ${e.days ?? "?"} ${type?.unit ?? "unité"}(s) ; ${fmv}`;
  });
  const prompt = [
    `Dossier soumis à l'équipe conformité d'une entreprise du secteur dentaire (loi anti-cadeaux et Transparence Santé).`,
    `Titre : « ${cut(p.title, 200)} ». Type : ${type?.label ?? p.typeId}${p.therapeuticArea ? `, domaine : ${p.therapeuticArea}` : ""}.`,
    `Objet et déroulé : ${p.description ? cut(p.description, 1500) : "[non renseigné]"}`,
    `Experts et honoraires :\n${lines.join("\n") || "- aucun expert engagé"}`,
    regime ? `Régime calculé : ${REGIME_LABEL[regime.regime]} (${regime.reason}).` : "Régime : à déterminer.",
    p.events.length ? `Événements liés : ${p.events.map((e) => `« ${e.title} »${e.benefits.length ? ` avec hospitalités ${e.benefits.map((b) => `${b.label} ${eur(b.valueCents)} TTC`).join(", ")}` : ""}`).join(" ; ")}.` : "",
    p.expenses.length ? `Dépenses : ${p.expenses.map((x) => `${x.label} ${eur(x.amountCents)}`).join(" ; ")}.` : "",
    `Documents joints : ${p.documents.length ? p.documents.map((d) => d.name).join(", ") : "aucun"}.`,
    conflicts.length ? `Contrôles automatiques KolBase : ${conflicts.map((c) => `${c.who} — ${c.detail}`).join(" ; ")}.` : "Contrôles automatiques KolBase : aucun conflit détecté.",
    "",
    "Rédige pour l'équipe conformité, en texte brut :",
    "1) « Points à vérifier : » puis 3 à 7 lignes commençant par « - » (juste contrepartie et cohérence honoraires / temps de travail, besoin réel et légitime, précision de l'objet : livrables, calendrier, modalités, hospitalités raisonnables et accessoires, conflits signalés, pièces manquantes).",
    "2) « Avis proposé : » valider, demander des précisions ou bloquer, avec une justification en une phrase.",
    "3) « Message proposé au chef de projet : » 3 à 5 lignes, courtoises et précises.",
    "Tu ne rends pas d'avis juridique : ta lecture est une aide, la décision appartient à l'équipe conformité.",
  ].filter(Boolean).join("\n");
  hit(key);
  try {
    const text = await aiComplete(prompt, 1100);
    await audit(user.id, "ai.review", "Project", p.id);
    return { text };
  } catch (e) {
    console.error("[assistant]", e);
    return { error: "L'assistant n'a pas pu répondre. Réessayez dans un instant." };
  }
}
