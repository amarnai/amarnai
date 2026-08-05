import { Suspense } from "react";
import { OutlookPanel } from "./OutlookPanel";

// The ribbon buttons deep-link here with ?focus=draft ("the user already asked
// for a draft — do it, do not make them press again") or ?focus=comments (open
// the comment section expanded and scrolled into view). Opening the pane from
// Outlook's add-in list has no query and waits for a click.
export default async function OutlookPanelPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const autoStart = params["focus"] === "draft";
  const focusComments = params["focus"] === "comments";

  return (
    <Suspense>
      <OutlookPanel autoStart={autoStart} focusComments={focusComments} />
    </Suspense>
  );
}
