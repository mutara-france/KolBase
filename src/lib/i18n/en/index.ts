/** Dictionnaire anglais : clé = texte français exact. Un fichier par zone de l'interface. */
import { COMMON } from "@/lib/i18n/en/common";
import { GLOSSARY } from "@/lib/i18n/en/glossary";

export const EN: Record<string, string> = { ...GLOSSARY, ...COMMON };
