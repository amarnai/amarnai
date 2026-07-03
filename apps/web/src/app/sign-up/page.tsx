import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { SignUpForm } from "./SignUpForm";

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; invite?: string }>;
}) {
  const { email, invite } = await searchParams;
  const user = await getSessionUser();
  if (user) redirect("/emails");

  return <SignUpForm defaultEmail={email} invited={invite === "1"} />;
}
