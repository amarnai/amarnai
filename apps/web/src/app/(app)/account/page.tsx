import { requireUser } from "@/lib/session";
import { db } from "@amarnai/db";
import { Trans } from "@lingui/react/macro";
import { AccountForm } from "./AccountForm";

export default async function AccountPage() {
  const user = await requireUser();

  const dbUser = await db.user.findUnique({
    where: { id: user.id },
    select: { name: true, email: true, lifecycleEmailsEnabled: true, locale: true },
  });

  return (
    <>
      <h1><Trans>Account Settings</Trans></h1>
      <AccountForm
        currentName={dbUser?.name ?? null}
        email={dbUser?.email ?? user.email}
        lifecycleEmailsEnabled={dbUser?.lifecycleEmailsEnabled ?? true}
        locale={(dbUser?.locale ?? "en") as string}
      />
    </>
  );
}
