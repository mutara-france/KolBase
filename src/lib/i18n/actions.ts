"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { isLocale } from "@/lib/i18n";
import { LOCALE_COOKIE } from "@/lib/i18n/server";

/** Change la langue de l'interface (et des e-mails, pour un utilisateur connecté). */
export async function setLocale(locale: string) {
  if (!isLocale(locale)) return;
  (await cookies()).set(LOCALE_COOKIE, locale, { path: "/", maxAge: 365 * 24 * 3600, sameSite: "lax", httpOnly: true, secure: process.env.NODE_ENV === "production" });
  const user = await getCurrentUser();
  if (user && user.locale !== locale) await db.user.update({ where: { id: user.id }, data: { locale } });
  revalidatePath("/", "layout");
}
