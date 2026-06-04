import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { SignInForm } from "./SignInForm";

export default async function SignInPage() {
  const session = await auth();
  if (session?.user?.id) redirect("/emails");

  return <SignInForm />;
}
