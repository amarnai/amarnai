import { db } from "@aziru/db";
import { GetExtensionBanner } from "@/components/GetExtensionBanner";
import { getSessionUser } from "@/lib/session";

/**
 * Server gate for the extension nudge: one point read per app page load,
 * keyed on the unique userId. Users who already run the extension never see
 * the banner, and never ship its markup either.
 */
export async function GetExtensionBannerLoader() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) return null;

  const install = await db.extensionInstall.findUnique({
    where: { userId: sessionUser.id },
    select: { userId: true },
  });
  if (install) return null;

  return <GetExtensionBanner />;
}
