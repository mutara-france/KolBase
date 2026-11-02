"use client";

import { createContext, useContext, useMemo } from "react";
import { makeT, type Locale, type T } from "@/lib/i18n";

const Ctx = createContext<{ locale: Locale; t: T }>({ locale: "fr", t: makeT("fr") });

/** Rend la langue de la requête disponible aux composants client (useT). */
export function I18nProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  const value = useMemo(() => ({ locale, t: makeT(locale) }), [locale]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useT = () => useContext(Ctx).t;
export const useLocale = () => useContext(Ctx).locale;
