"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/components/I18nProvider";
import {
  CONSENT_COOKIE, CONSENT_MAX_AGE, SERVICE_COOKIES, writeConsent,
  type Choice, type Consent, type ConsentCategory, type OptionalService,
} from "@/lib/consent";

/** Événement envoyé par « Gérer les cookies » (pied de page) pour rouvrir le choix. */
const OPEN_EVENT = "kb:cookies";

type Fbq = ((...a: unknown[]) => void) & { callMethod?: (...a: unknown[]) => void; queue: unknown[]; push?: Fbq; loaded?: boolean; version?: string };
type Win = Window & { dataLayer?: unknown[]; gtag?: (...a: unknown[]) => void; _hsq?: unknown[][]; fbq?: Fbq; _fbq?: Fbq };

function addScript(id: string, src: string) {
  if (document.getElementById(id)) return;
  const s = document.createElement("script");
  s.id = id;
  s.src = src;
  s.async = true;
  document.head.appendChild(s);
}

/** Charge un service accepté (une seule fois par page). */
function load(s: OptionalService) {
  const w = window as Win;
  if (s.id === "ga" && !w.gtag) {
    w.dataLayer = w.dataLayer ?? [];
    const layer = w.dataLayer;
    // biome-ignore lint/complexity/noArguments: gtag.js attend l'objet arguments, comme dans le fragment officiel.
    w.gtag = function gtag() { layer.push(arguments); };
    w.gtag("js", new Date());
    // Cookies de mesure limités à 13 mois (recommandation CNIL), au lieu de deux ans par défaut.
    w.gtag("config", s.key, { cookie_expires: 13 * 30 * 24 * 3600 });
    addScript("kb-svc-ga", `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(s.key)}`);
  }
  if (s.id === "hubspot") {
    w._hsq = w._hsq ?? [];
    addScript("hs-script-loader", `https://js${s.region === "eu1" ? "-eu1" : ""}.hs-scripts.com/${encodeURIComponent(s.key)}.js`);
  }
  if (s.id === "meta" && !w.fbq) {
    // Équivalent du fragment officiel : file d'attente jusqu'au chargement de fbevents.js, qui fournit callMethod.
    const fbq = ((...a: unknown[]) => { if (fbq.callMethod) fbq.callMethod.apply(fbq, a); else fbq.queue.push(a); }) as Fbq;
    Object.assign(fbq, { queue: [], push: fbq, loaded: true, version: "2.0" });
    w.fbq = fbq;
    w._fbq = w._fbq ?? fbq;
    fbq("init", s.key);
    fbq("track", "PageView");
    addScript("kb-svc-meta", "https://connect.facebook.net/en_US/fbevents.js");
  }
}

/** Supprime les cookies d'un service dont l'accord est retiré (sur ce domaine et ses parents). */
function clearCookies(s: OptionalService) {
  const host = location.hostname;
  const domains = ["", host, ...host.split(".").map((_, i, p) => `.${p.slice(i).join(".")}`).filter((d) => d.split(".").length > 2)];
  for (const c of document.cookie.split(";")) {
    const name = c.split("=")[0].trim();
    if (!SERVICE_COOKIES[s.id].test(name)) continue;
    for (const d of domains) document.cookie = `${name}=; path=/; max-age=0${d ? `; domain=${d}` : ""}`;
  }
}

/**
 * Bandeau de consentement aux cookies : « Refuser » et « Accepter » au même niveau, « Personnaliser » par finalité,
 * lien vers la politique. Le choix est rouvert par « Gérer les cookies » (pied de page), et retirer un accord supprime
 * les cookies du service puis recharge la page pour arrêter ses scripts.
 */
export function CookieConsent({ initial, services }: { initial: Consent | null; services: OptionalService[] }) {
  const t = useT();
  const path = usePathname();
  const [consent, setConsent] = useState<Consent | null>(initial);
  const [view, setView] = useState<"banner" | "panel" | null>(initial ? null : "banner");
  const [draft, setDraft] = useState<Choice>({ mesure: initial?.mesure ?? false, marketing: initial?.marketing ?? false });
  const panelTitle = useRef<HTMLHeadingElement>(null);
  const firstPath = useRef(path);

  // Services acceptés : chargés au choix, puis à chaque page suivie (les visites internes sont signalées aux services).
  useEffect(() => {
    if (!consent) return;
    for (const s of services) if (consent[s.category]) load(s);
  }, [consent, services]);
  useEffect(() => {
    if (path === firstPath.current) return;
    firstPath.current = path;
    const w = window as Win;
    w._hsq?.push(["setPath", path], ["trackPageView"]);
    w.fbq?.("track", "PageView");
  }, [path]);

  useEffect(() => {
    const open = () => {
      setDraft({ mesure: consent?.mesure ?? false, marketing: consent?.marketing ?? false });
      setView("panel");
    };
    window.addEventListener(OPEN_EVENT, open);
    return () => window.removeEventListener(OPEN_EVENT, open);
  }, [consent]);
  useEffect(() => {
    if (view === "panel") panelTitle.current?.focus();
  }, [view]);

  const save = useCallback((choice: Choice) => {
    const secure = location.protocol === "https:" ? "; secure" : "";
    document.cookie = `${CONSENT_COOKIE}=${writeConsent(choice)}; path=/; max-age=${CONSENT_MAX_AGE}; samesite=lax${secure}`;
    const revoked = services.filter((s) => consent?.[s.category] && !choice[s.category]);
    setConsent({ ...choice, at: Math.floor(Date.now() / 1000) });
    setView(null);
    if (revoked.length) {
      revoked.forEach(clearCookies);
      // Un script chargé ne peut pas être déchargé : la page repart sans lui.
      location.reload();
    }
  }, [consent, services]);

  const close = () => setView(consent ? null : "banner");
  if (!view) return null;

  const names = (c: ConsentCategory) => {
    const list = services.filter((s) => s.category === c).map((s) => s.name);
    return list.length ? t("Services : {list}.", { list: list.join(", ") }) : t("Aucun service de ce type n'est activé à ce jour.");
  };
  const more = <Link href="/confidentialite#cookies">{t("En savoir plus")}</Link>;

  if (view === "banner")
    return (
      <section key="banner" className="cookie-banner" aria-labelledby="cookie-title">
        <div className="cookie-body">
          <h2 id="cookie-title" className="cookie-title">{t("Cookies")}</h2>
          <p className="cookie-text">
            {t("KolBase utilise des cookies pour mesurer l'audience et vous proposer des contenus adaptés. Vous pouvez les accepter ou les refuser, et changer d'avis à tout moment depuis « Gérer les cookies », en bas de page.")}{" "}
            {more}
          </p>
        </div>
        <div className="cookie-actions">
          <button type="button" className="btn ghost" onClick={() => setView("panel")}>{t("Personnaliser")}</button>
          <button type="button" className="btn" onClick={() => save({ mesure: false, marketing: false })}>{t("Refuser")}</button>
          <button type="button" className="btn" onClick={() => save({ mesure: true, marketing: true })}>{t("Accepter")}</button>
        </div>
      </section>
    );

  const cat = (c: ConsentCategory, title: string, desc: string) => (
    <label className="cookie-cat">
      <input type="checkbox" name={c} checked={draft[c]} onChange={(e) => setDraft({ ...draft, [c]: e.target.checked })} />
      <span><strong>{title}</strong><small>{desc} {names(c)}</small></span>
    </label>
  );
  return (
    <section
      key="panel"
      className="cookie-banner panel"
      aria-labelledby="cookie-panel-title"
      onKeyDown={(e) => { if (e.key === "Escape") close(); }}
    >
      <div className="cookie-body">
        <h2 id="cookie-panel-title" className="cookie-title" tabIndex={-1} ref={panelTitle}>{t("Gérer les cookies")}</h2>
        <p className="cookie-text">{t("Choisissez les cookies que vous acceptez. Votre choix est conservé six mois.")} {more}</p>
        <fieldset className="cookie-cats">
          <legend className="sr-only">{t("Finalités")}</legend>
          <label className="cookie-cat">
            <input type="checkbox" checked disabled />
            <span><strong>{t("Nécessaires")}</strong><small>{t("Connexion, langue, mémorisation de ce choix : toujours actifs, le site ne fonctionne pas sans eux.")}</small></span>
          </label>
          {cat("mesure", t("Mesure d'audience"), t("Statistiques de fréquentation, pour comprendre l'usage du site et l'améliorer."))}
          {cat("marketing", t("Personnalisation et marketing"), t("Contenus et offres adaptés à vos centres d'intérêt, mesure de nos campagnes."))}
        </fieldset>
      </div>
      <div className="cookie-actions">
        <button type="button" className="btn ghost" onClick={() => save({ mesure: false, marketing: false })}>{t("Tout refuser")}</button>
        <button type="button" className="btn ghost" onClick={() => save({ mesure: true, marketing: true })}>{t("Tout accepter")}</button>
        <button type="button" className="btn" onClick={() => save(draft)}>{t("Enregistrer mes choix")}</button>
      </div>
    </section>
  );
}

/** « Gérer les cookies » (pied de page) : rouvre le choix, sur toutes les pages. */
export function CookieSettingsButton({ className }: { className?: string }) {
  const t = useT();
  return (
    <button type="button" className={className} onClick={() => window.dispatchEvent(new Event(OPEN_EVENT))}>
      {t("Gérer les cookies")}
    </button>
  );
}
