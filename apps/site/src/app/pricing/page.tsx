import { LocaleRedirect } from "../LocaleRedirect";

// Non-localized `/pricing` entry point: detect the browser locale and redirect to
// the localized route. Preserves the bare amarnai.com/pricing URL for inbound
// links while keeping the localized `[locale]/pricing` page as the single source.
export default function PricingPage() {
  return <LocaleRedirect path="/pricing" />;
}
