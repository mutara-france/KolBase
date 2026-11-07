"use client";

import type { ComponentProps } from "react";

/** Liste déroulante qui envoie son formulaire dès qu'elle change (filtres d'une liste). */
export function AutoSubmitSelect(props: ComponentProps<"select">) {
  return <select {...props} onChange={(e) => e.currentTarget.form?.requestSubmit()} />;
}
