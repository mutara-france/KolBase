import "server-only";

/**
 * Assistant de rédaction : appel au modèle Claude (API Messages d'Anthropic).
 * Activé seulement si ANTHROPIC_API_KEY est défini ; ANTHROPIC_MODEL et ANTHROPIC_BASE_URL permettent
 * de changer de modèle ou de pointer vers un faux service (tests).
 */
export const aiEnabled = () => !!process.env.ANTHROPIC_API_KEY;

const SYSTEM = [
  "Tu es l'assistant de rédaction de KolBase, plateforme qui met en relation des chirurgiens-dentistes avec les organisations du secteur dentaire (industriels, sociétés savantes, organismes de formation, prestataires).",
  "Tu rédiges des brouillons que l'utilisateur relira : en français, ton professionnel, clair et sobre.",
  "N'invente ni nom de personne, ni chiffre, ni référence bibliographique, ni lieu qu'on ne t'a pas donnés : écris [à compléter] à la place.",
  "Pas d'allégation thérapeutique ni de contenu promotionnel ; respecte l'esprit du dispositif anti-cadeaux (hospitalité raisonnable et accessoire, contenu scientifique au premier plan).",
  "Réponds uniquement par le texte demandé, sans préambule ni conclusion, en texte brut : pas de Markdown, pas de titres avec #, pas de gras.",
].join(" ");

export async function aiComplete(prompt: string, maxTokens = 1200): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("Assistant non configuré");
  const res = await fetch(`${process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com"}/v1/messages`, {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": process.env.ANTHROPIC_VERSION ?? "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5", max_tokens: maxTokens, system: SYSTEM, messages: [{ role: "user", content: prompt }] }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Assistant indisponible (${res.status})`);
  const data = (await res.json()) as { content?: { type: string; text?: string }[] };
  const text = (data.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("").trim();
  if (!text) throw new Error("Réponse vide");
  // Texte brut : on retire d'éventuelles marques de Markdown résiduelles.
  return text.replace(/^#+\s*/gm, "").replace(/\*\*(.+?)\*\*/g, "$1");
}
