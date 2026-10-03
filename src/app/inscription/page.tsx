import { redirect } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { SignUpForm } from "@/components/AuthForms";
import { getCurrentUser } from "@/lib/auth";

export const metadata = { title: "Créer un compte — Kolbase" };

export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await getCurrentUser()) redirect("/compte");
  const { next } = await searchParams;
  return (
    <>
      <SiteHeader />
      <main className="narrow"><SignUpForm next={next} /></main>
    </>
  );
}
