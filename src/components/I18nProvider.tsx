"use client";

import { createContext, use, useContext, useMemo } from "react";
import { type Dictionary, type Locale, type T, tFrom } from "@/lib/i18n/core";

const Ctx = createContext<{ locale: Locale; t: T }>({ locale: "fr", t: tFrom(null) });

// Dictionnaire anglais dans un fichier JavaScript à part, téléchargé (puis mis en cache) par les seuls anglophones.
// La promesse est partagée : use() suspend l'hydratation jusqu'à son arrivée, sans afficher le français entre-temps.
let english: Promise<Dictionary> | undefined;
const loadEnglish = () => (english ??= import("@/lib/i18n/en").then((m) => m.EN));

/** Rend la langue de la requête disponible aux composants client (useT). */
export function I18nProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  const dict = locale === "en" ? use(loadEnglish()) : null;
  const value = useMemo(() => ({ locale, t: tFrom(dict) }), [locale, dict]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useT = () => useContext(Ctx).t;
export const useLocale = () => useContext(Ctx).locale;
