import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { inspectBridgeCode } from "@/lib/bridge-code";
import { sanitizeBridgePath } from "@/lib/bridge-redirect";
import { BridgeContinue } from "./BridgeContinue";
import { BridgeAccountChoice } from "./BridgeAccountChoice";

/**
 * Lands users arriving from the browser extension with a one-time code, so a
 * link clicked in the side panel does not dead-end at the sign-in form.
 *
 * The code is spent at most once. When nobody is signed in here, it goes
 * straight to the sign-in exchange. When somebody already is, the code is
 * inspected (not spent) first, because replacing a different person's session
 * without asking would be the wrong default on a shared browser.
 */
export default async function BridgePage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; next?: string }>;
}) {
  const { code, next } = await searchParams;
  const destination = sanitizeBridgePath(next);

  if (!code) redirect(`/sign-in?next=${encodeURIComponent(destination)}`);

  const current = await getSessionUser();
  if (!current) {
    return <BridgeContinue code={code} next={destination} />;
  }

  const incoming = await inspectBridgeCode(code);

  // The code is dead (spent, expired, or the API is unreachable) but this browser
  // is signed in anyway, so there is nothing to fix: send them where they asked
  // to go rather than showing an error about a handoff that is no longer needed.
  if (!incoming) redirect(destination);

  // Same person, already signed in: skip the exchange entirely and leave the
  // code to expire unused.
  if (incoming.userId === current.id) redirect(destination);

  return (
    <BridgeAccountChoice
      code={code}
      next={destination}
      incomingEmail={incoming.email}
      currentEmail={current.email}
    />
  );
}
