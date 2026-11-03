"use client";

import { startTransition, type ComponentProps, type SubmitEvent } from "react";

/**
 * Formulaire relié à une action serveur (fonction renvoyée par useActionState) qui garde la saisie.
 * React 19 réinitialise un `<form action>` après chaque envoi : sur une erreur (champ manquant, abonnement…),
 * tout serait à ressaisir, et une liste contrôlée afficherait une autre valeur que celle de l'état.
 * L'envoi est intercepté et l'action appelée dans une transition : aucune réinitialisation automatique.
 * Sans JavaScript, le formulaire est envoyé normalement (attribut action conservé).
 */
export function ActionForm({ action, onSubmit, ...props }: Omit<ComponentProps<"form">, "action"> & { action: (data: FormData) => void }) {
  const submit = (e: SubmitEvent<HTMLFormElement>) => {
    onSubmit?.(e);
    if (e.defaultPrevented) return;
    e.preventDefault();
    const data = new FormData(e.currentTarget, e.nativeEvent.submitter);
    startTransition(() => action(data));
  };
  return <form {...props} action={action} onSubmit={submit} />;
}
