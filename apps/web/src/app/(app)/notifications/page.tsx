import { Trans } from "@lingui/react/macro";
import { initServerI18n } from "@/lib/i18n-server";
import { NotificationsClient } from "./NotificationsClient";

// The notifications list page. A single list surface (no per-notification route):
// rows carry inline read/unread, delete, and an optional action (e.g. open the
// assigned thread), plus multi-select for batch mark/delete.
export default async function NotificationsPage() {
  await initServerI18n();
  return (
    <>
      <h1><Trans>Notifications</Trans></h1>
      <NotificationsClient />
    </>
  );
}
