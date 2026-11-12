import { describe, expect, it } from "vitest";
import { feedUrl, isPrivateAddress, mentions, parseFeed } from "@/lib/feed";
import { readFeed } from "@/lib/feed-reader";

describe("veille : lecture des flux", () => {
  it("RSS : titre, lien, date et extrait sans HTML", () => {
    const items = parseFeed(`<?xml version="1.0"?><rss><channel><title>Revue (fictive)</title>
      <item><title><![CDATA[Implants D&eacute;mo lance une gamme]]></title><link>https://revue.example.org/a/1?x=1&amp;y=2</link><pubDate>Tue, 10 Nov 2026 08:00:00 +0100</pubDate><description>&lt;p&gt;Le fabricant &lt;b&gt;Implants Démo&lt;/b&gt; annonce&amp;nbsp;une nouveauté.&lt;/p&gt;</description></item>
      <item><title>Sans lien</title></item>
      <item><title>Lien piégé</title><link>javascript:alert(1)</link></item>
      <item><title>Par guid</title><guid>https://revue.example.org/a/2</guid><description></description></item>
    </channel></rss>`);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ title: "Implants Démo lance une gamme", url: "https://revue.example.org/a/1?x=1&y=2", summary: "Le fabricant Implants Démo annonce une nouveauté." });
    expect(items[0].publishedAt?.toISOString()).toBe("2026-11-10T07:00:00.000Z");
    expect(items[1]).toMatchObject({ title: "Par guid", url: "https://revue.example.org/a/2", summary: null, publishedAt: null });
  });
  it("Atom : lien alternate, date de publication, extrait tronqué", () => {
    const items = parseFeed(`<feed xmlns="http://www.w3.org/2005/Atom"><entry><title type="html">Congr&#232;s &amp; atelier</title><link rel="self" href="https://chaine.example.org/self"/><link rel="alternate" href="https://chaine.example.org/v/1"/><published>2026-11-01T10:00:00Z</published><summary>${"mot ".repeat(200)}</summary></entry></feed>`);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: "Congrès & atelier", url: "https://chaine.example.org/v/1" });
    expect(items[0].summary!.length).toBeLessThanOrEqual(300);
    expect(items[0].summary!.endsWith("…")).toBe(true);
    expect(parseFeed("<html><body>Pas un flux</body></html>")).toEqual([]);
    expect(parseFeed(`<rss>${"<item><title>t</title><link>https://a.example.org/1</link></item>".repeat(80)}</rss>`)).toHaveLength(60);
  });
  it("lit un flux piégé sans s'y attarder", () => {
    const started = Date.now();
    expect(parseFeed("<item><title>".repeat(150_000))).toEqual([]);
    expect(parseFeed(`<item><title>${"<![CDATA[".repeat(100_000)}</title><link>https://a.example.org/1</link>${"<link ".repeat(100_000)}</item>`)).toHaveLength(1);
    expect(parseFeed(`<item><title>t</title><link>https://a.example.org/1</link><description>${"<b ".repeat(300_000)}</description></item>`)).toHaveLength(1);
    expect(Date.now() - started).toBeLessThan(2000);
  });
  it("n'accepte que l'adresse https d'un site public", () => {
    expect(feedUrl("https://www.revue-dentaire.fr/rss.xml")?.hostname).toBe("www.revue-dentaire.fr");
    for (const bad of ["http://www.revue-dentaire.fr/rss", "https://localhost/rss", "https://127.0.0.1/rss", "https://[::1]/rss", "https://intranet/rss", "https://app.internal/rss", "https://site.fr:8443/rss", "https://u:p@site.fr/rss", "ftp://site.fr/rss", "pas une adresse"]) expect(feedUrl(bad), bad).toBeNull();
  });
  it("écarte les adresses privées, locales et de métadonnées", () => {
    for (const ip of ["10.0.0.1", "127.0.0.1", "169.254.169.254", "172.16.5.4", "192.168.1.1", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1", "pas-une-ip"]) expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ["93.184.216.34", "172.32.0.1", "2001:4860:4860::8888"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });
  it("retrouve les mentions en mots entiers, sans casse ni accents", () => {
    const watched = [{ label: "Implants Démo", terms: ["Implants Démo", "IDC"] }, { label: "Ortho", terms: ["Ortho"] }];
    expect(mentions("Le groupe IMPLANTS DEMO ouvre un centre", watched).map((w) => w.label)).toEqual(["Implants Démo"]);
    expect(mentions("IDC et Ortho partenaires", watched).map((w) => w.label)).toEqual(["Implants Démo", "Ortho"]);
    expect(mentions("Orthodontie : nouveautés", watched)).toEqual([]);
  });
  it("relève un flux sans jamais suivre une adresse interne", async () => {
    const rss = `<rss><item><title>Article</title><link>https://revue.example.org/a/1</link></item></rss>`;
    const net = (pages: Record<string, Response>, ips: Record<string, string> = {}) => ({
      resolve: async (host: string) => [{ address: ips[host] ?? "93.184.216.34" }],
      get: async (url: URL) => pages[url.toString()] ?? new Response("", { status: 404 }),
    });
    const moved = (to: string) => new Response(null, { status: 301, headers: { location: to } });
    // Redirection vers une autre adresse publique : suivie.
    expect(await readFeed("https://revue.example.org/rss", net({ "https://revue.example.org/rss": moved("/flux.xml"), "https://revue.example.org/flux.xml": new Response(rss) }))).toHaveLength(1);
    // Nom public qui résout vers une adresse privée, redirection vers le réseau interne ou en http : refusées.
    await expect(readFeed("https://revue.example.org/rss", net({}, { "revue.example.org": "10.0.0.5" }))).rejects.toThrow("adresse non publique");
    await expect(readFeed("https://revue.example.org/rss", net({ "https://revue.example.org/rss": moved("https://169.254.169.254/latest/meta-data/") }))).rejects.toThrow("adresse refusée");
    await expect(readFeed("https://revue.example.org/rss", net({ "https://revue.example.org/rss": moved("http://revue.example.org/rss") }))).rejects.toThrow("adresse refusée");
    await expect(readFeed("https://revue.example.org/rss", net({ "https://revue.example.org/rss": moved("https://interne.example.org/x"), "https://interne.example.org/x": new Response(rss) }, { "interne.example.org": "192.168.1.10" }))).rejects.toThrow("adresse non publique");
    // Boucle de redirections, réponse en erreur, page qui n'est pas un flux, flux démesuré.
    await expect(readFeed("https://revue.example.org/rss", net({ "https://revue.example.org/rss": moved("/rss") }))).rejects.toThrow("adresse refusée");
    await expect(readFeed("https://revue.example.org/rss", net({}))).rejects.toThrow("réponse 404");
    await expect(readFeed("https://revue.example.org/rss", net({ "https://revue.example.org/rss": new Response("<html></html>") }))).rejects.toThrow("aucune publication lue");
    await expect(readFeed("https://revue.example.org/rss", net({ "https://revue.example.org/rss": new Response("x".repeat(2 * 1024 * 1024 + 1)) }))).rejects.toThrow("flux trop volumineux");
    await expect(readFeed("http://localhost/rss")).rejects.toThrow("adresse refusée");
  });
});
