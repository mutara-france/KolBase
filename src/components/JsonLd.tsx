import { headers } from "next/headers";
import { jsonLd } from "@/lib/jsonld";

/**
 * Données structurées schema.org d'une page, avec le nonce de la politique de sécurité des contenus (posé par
 * src/proxy.ts dans l'en-tête de requête `x-kb-nonce`). Next.js n'appose le nonce que sur ses propres scripts :
 * sans lui, chaque script inline « application/ld+json » était signalé par la CSP (script-src-elem), ce qui
 * empêchait de la rendre bloquante.
 */
export async function JsonLd({ data }: { data: object }) {
  const nonce = (await headers()).get("x-kb-nonce") ?? undefined;
  // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON sérialisé par jsonLd, « < » échappé.
  return <script type="application/ld+json" nonce={nonce} dangerouslySetInnerHTML={jsonLd(data)} />;
}
