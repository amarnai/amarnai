import { LocaleRedirect } from "./LocaleRedirect";

// Root `/` page: detect the browser locale and redirect to the localized route.
// With output: "export", this generates a static index.html that runs client-side
// detection without a server. Crawlers follow the hreflang alternates on the
// [locale]/ pages instead. Repeat visitors are redirected instantly via the
// localStorage cache.
export default function RootPage() {
  return <LocaleRedirect />;
}
