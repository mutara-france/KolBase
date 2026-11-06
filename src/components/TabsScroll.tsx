"use client";

import { useEffect, useRef } from "react";

/** Sur téléphone, la rangée d'onglets défile : l'onglet ouvert est ramené dans la vue (sans faire défiler la page). */
export function TabsScroll() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const nav = ref.current?.parentElement;
    const active = nav?.querySelector<HTMLElement>(".dossier-tab.active");
    if (nav && active && nav.scrollWidth > nav.clientWidth) nav.scrollLeft = active.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2;
  }, []);
  return <span ref={ref} hidden />;
}
