import { redirect } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { SignUpForm } from "@/components/AuthForms";
import { getCurrentUser } from "@/lib/auth";

export const metadata = { title: "Créer un compte — Kolbase" };

export default async function Page() {
  if (await getCurrentUser()) redirect("/compte");
  return (
    <>
      <SiteHeader />
      <main className="narrow"><SignUpForm /></main>
    </>
  );
}
