"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setLocale } from "@/lib/i18n/actions";
import { LOCALES } from "@/lib/i18n/core";
import { useLocale, useT } from "@/components/I18nProvider";

/** Sélecteur FR / EN (pied de page, navigation publique). */
export function LocaleSwitch({ className = "" }: { className?: string }) {
  const locale = useLocale();
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <span className={`locale-switch ${className}`} role="group" aria-label={t("Langue")}>
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          lang={l}
          aria-pressed={l === locale}
          disabled={pending || l === locale}
          onClick={() => start(async () => { await setLocale(l); router.refresh(); })}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </span>
  );
}
