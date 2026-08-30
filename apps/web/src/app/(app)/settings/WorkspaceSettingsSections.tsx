"use client";

import { useRouter } from "next/navigation";
import { WorkspaceNameSection, WorkspaceLanguageSection } from "@aziru/ui/settings";
import { api } from "@/lib/api";

/**
 * Web host for the workspace name and language sections. The sections are shared
 * with the extension panel; what lives here are the web-only side effects of a
 * change: revalidating the server-rendered layout, and re-running the request
 * through the proxy so the new locale resolves for server components too.
 */
export function WorkspaceSettingsSections({
  workspaceId,
  currentName,
  currentLocale,
}: {
  workspaceId: string;
  currentName: string;
  currentLocale: string;
}) {
  const router = useRouter();

  return (
    <>
      <WorkspaceNameSection
        api={api}
        workspaceId={workspaceId}
        currentName={currentName}
        onSaved={() => router.refresh()}
      />
      <WorkspaceLanguageSection
        api={api}
        workspaceId={workspaceId}
        currentLocale={currentLocale}
        onChanged={(locale) => {
          // The cookie is what the proxy reads to resolve the locale for every
          // subsequent request, including server-rendered strings.
          document.cookie = `aziru_locale=${locale};path=/;max-age=31536000;samesite=lax`;
          router.refresh();
        }}
      />
    </>
  );
}
