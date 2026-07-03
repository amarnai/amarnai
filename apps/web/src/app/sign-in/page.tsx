import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { SignInForm } from "./SignInForm";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const session = await auth();
  // A signed-in user normally has no reason to be here — except when an invite
  // was sent to a different account, where they must switch to the invited one.
  if (session?.user?.id && error !== "invite_wrong_account") redirect("/emails");

  return <SignInForm />;
}
