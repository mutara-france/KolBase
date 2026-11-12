"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { Brand } from "@/lib/brand";

const BrandContext = createContext<Brand | null>(null);

/** Marque de l'organisation quand KolBase est servi sur son nom de domaine (KolBase Business) ; null sur KolBase. */
export function BrandProvider({ brand, children }: { brand: Brand | null; children: ReactNode }) {
  return <BrandContext.Provider value={brand}>{children}</BrandContext.Provider>;
}
export const useBrand = () => useContext(BrandContext);
