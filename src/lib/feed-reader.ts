import { lookup } from "node:dns/promises";
import { feedUrl, isPrivateAddress, parseFeed, type FeedItem } from "@/lib/feed";

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_HOPS = 4;

type Deps = { resolve: (host: string) => Promise<{ address: string }[]>; get: (url: URL, init: RequestInit) => Promise<Response> };
const NETWORK: Deps = { resolve: (host) => lookup(host, { all: true }), get: (url, init) => fetch(url, init) };

/**
 * Lecture d'un flux à une adresse saisie par un administrateur KolBase, sans jamais atteindre le réseau interne :
 * https et nom public (feedUrl), résolution DNS vérifiée (aucune adresse privée ou locale), redirections suivies une
 * à une avec les mêmes contrôles, taille et durée bornées. `deps` : réseau simulé des tests.
 */
export async function readFeed(address: string, deps: Deps = NETWORK): Promise<FeedItem[]> {
  let url = feedUrl(address);
  for (let hop = 0; url && hop < MAX_HOPS; hop++) {
    const addresses = await deps.resolve(url.hostname);
    if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address))) throw new Error("adresse non publique");
    const res = await deps.get(url, { redirect: "manual", signal: AbortSignal.timeout(10_000), headers: { Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml", "User-Agent": "KolBase-veille/1.0 (+https://kolbase.io)" } });
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get("location");
      url = next ? feedUrl(new URL(next, url).toString()) : null;
      continue;
    }
    if (!res.ok) throw new Error(`réponse ${res.status}`);
    if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) throw new Error("flux trop volumineux");
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > MAX_BYTES) throw new Error("flux trop volumineux");
    const items = parseFeed(new TextDecoder().decode(bytes));
    if (items.length === 0) throw new Error("aucune publication lue : ce n'est pas un flux RSS ou Atom");
    return items;
  }
  throw new Error("adresse refusée");
}
