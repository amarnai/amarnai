import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { createWaitlistFormToken, isWaitlistMode } from "@/lib/waitlist";
import { SignUpForm } from "./SignUpForm";
import { WaitlistForm } from "./WaitlistForm";

export default async function SignUpPage() {
  const session = await auth();
  if (session?.user?.id) redirect("/emails");

  if (isWaitlistMode()) return <WaitlistForm formToken={createWaitlistFormToken()} />;

  return <SignUpForm />;
}
