"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { useT } from "@/components/I18nProvider";

type Tab = { id: "experts" | "evenements" | "appels" | "structures"; label: string; count: number };

/** Module de recherche de l'accueil : un onglet par annuaire public, formulaire GET vers la page correspondante. */
export function HomeSearch({ counts, interventionTypes }: { counts: { experts: number; events: number; calls: number; organizations: number }; interventionTypes: readonly string[] }) {
  const t = useT();
  const tabs: Tab[] = [
    { id: "experts", label: t("Praticiens"), count: counts.experts },
    { id: "evenements", label: t("Événements"), count: counts.events },
    { id: "appels", label: t("Opportunités"), count: counts.calls },
    { id: "structures", label: t("Organisations"), count: counts.organizations },
  ];
  const [tab, setTab] = useState<Tab["id"]>("experts");
  const placeholder = {
    experts: t("Implantologie, Dr Durand…"),
    evenements: t("Live surgery, parodontologie…"),
    appels: t("Formateur, étude clinique…"),
    structures: t("Industriel, société savante…"),
  }[tab];

  return (
    <form className="search-card" action={`/${tab}`} method="get" role="search" aria-label={t("Rechercher sur KolBase")}>
      <div className="search-tabs">
        {tabs.map((x) => (
          <button key={x.id} type="button" className="search-tab" aria-pressed={tab === x.id} onClick={() => setTab(x.id)}>
            {x.label}<span>{x.count}</span>
          </button>
        ))}
      </div>
      <div className="search-fields">
        <div className="search-field wide">
          <label htmlFor="home-q">{tab === "experts" ? t("Spécialité ou nom") : t("Mots-clés")}</label>
          <input id="home-q" name="q" type="search" placeholder={placeholder} autoComplete="off" />
        </div>
        {tab === "experts" && (
          <div className="search-field">
            <label htmlFor="home-type">{t("Type d'intervention")}</label>
            <select id="home-type" name="type" defaultValue="">
              <option value="">{t("Tous les types")}</option>
              {interventionTypes.map((x) => <option key={x} value={x}>{t(x)}</option>)}
            </select>
          </div>
        )}
        {(tab === "experts" || tab === "evenements") && (
          <div className="search-field">
            <label htmlFor="home-ville">{t("Ville")}</label>
            <input id="home-ville" name="ville" type="text" placeholder={t("Toute la France")} autoComplete="address-level2" />
          </div>
        )}
        <button type="submit" className="search-submit"><Search size={20} aria-hidden /> {t("Rechercher")}</button>
      </div>
    </form>
  );
}
