import { requireUser } from "@/lib/session";
import { db } from "@amarnai/db";
import { AccountForm } from "./AccountForm";

export default async function AccountPage() {
  const user = await requireUser();

  const dbUser = await db.user.findUnique({
    where: { id: user.id },
    select: { name: true, email: true },
  });

  return (
    <>
      <h1>Account Settings</h1>
      <AccountForm
        currentName={dbUser?.name ?? null}
        email={dbUser?.email ?? user.email}
      />
    </>
  );
}
