import { LocaleRedirect } from "./LocaleRedirect";

// Unknown paths (e.g. /br, /xyz) — detect browser locale and redirect to the
// correct localized route. In the static export this generates a 404.html that
// the hosting layer serves for any unmatched path.
export default function NotFound() {
  return <LocaleRedirect />;
}
