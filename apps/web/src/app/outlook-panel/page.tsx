import { Suspense } from "react";
import { OutlookPanel } from "./OutlookPanel";

// The ribbon button deep-links here with ?focus=draft, which means "the user
// already asked for a draft — do it, do not make them press again". Opening the
// pane from Outlook's add-in list has no query and waits for a click.
export default async function OutlookPanelPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const autoStart = params["focus"] === "draft";

  return (
    <Suspense>
      <OutlookPanel autoStart={autoStart} />
    </Suspense>
  );
}
