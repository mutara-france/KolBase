/** Dictionnaire anglais : clé = texte français exact. Un fichier par zone de l'interface. */
import { COMMON } from "@/lib/i18n/en/common";
import { CONVENTION } from "@/lib/i18n/en/convention";
import { EMAILS } from "@/lib/i18n/en/emails";
import { GLOSSARY } from "@/lib/i18n/en/glossary";
import { PUBLIC } from "@/lib/i18n/en/public";

export const EN: Record<string, string> = { ...GLOSSARY, ...CONVENTION, ...PUBLIC, ...EMAILS, ...COMMON };
