import { redirect } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { SignInForm } from "@/components/AuthForms";
import { getCurrentUser } from "@/lib/auth";

export const metadata = { title: "Connexion — Kolbase" };

export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await getCurrentUser()) redirect("/compte");
  const { next } = await searchParams;
  return (
    <>
      <SiteHeader variant="public" />
      <main className="narrow"><SignInForm next={next} /></main>
    </>
  );
}
