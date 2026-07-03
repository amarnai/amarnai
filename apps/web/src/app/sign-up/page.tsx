import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { SignUpForm } from "./SignUpForm";

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; invite?: string }>;
}) {
  const { email, invite } = await searchParams;
  const session = await auth();
  if (session?.user?.id) redirect("/emails");

  return <SignUpForm defaultEmail={email} invited={invite === "1"} />;
}
