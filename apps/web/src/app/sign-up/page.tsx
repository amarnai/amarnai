import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { SignUpForm } from "./SignUpForm";

export default async function SignUpPage() {
  const session = await auth();
  if (session?.user?.id) redirect("/emails");

  return <SignUpForm />;
}
