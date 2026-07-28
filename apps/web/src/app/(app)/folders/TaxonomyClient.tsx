"use client";

import { useCallback, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { TaxonomyEditor, type TaxonomyEditorMode } from "@amarnai/ui/taxonomy-editor";
import { api, type TaxonomyNode, type TaxonomyEdge } from "@/lib/api";
import { GenerateFromInboxButton, startGmailConnect } from "./GenerateFromInboxButton";

/**
 * Web host for the shared taxonomy editor. Everything here is host-specific: the
 * deep-link params, the Next router, and the generate-from-inbox modal (which is
 * larger and more illustrated than the panel's equivalent). The editor itself
 * lives in @amarnai/ui so the extension renders the identical canvas.
 */
export function TaxonomyClient({
  workspaceId,
  nodes,
  edges,
  readOnly = false,
  gmailConnected = false,
}: {
  workspaceId: string;
  nodes: TaxonomyNode[];
  edges: TaxonomyEdge[];
  readOnly?: boolean;
  gmailConnected?: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Read once on mount: the editor acts on this and reports back, after which
  // the params are stripped so a refresh does not reopen the same flow.
  const [initialMode] = useState<TaxonomyEditorMode | undefined>(() => {
    if (searchParams.get("openTemplates") === "1") return "templates";
    if (searchParams.get("openGenerate") === "1") return "generate";
    return undefined;
  });
  const [generateOpen, setGenerateOpen] = useState(
    () => gmailConnected && searchParams.get("openGenerate") === "1"
  );

  const clearModeParams = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("openTemplates");
    params.delete("openGenerate");
    const next = params.size > 0 ? `?${params.toString()}` : "";
    router.replace(`/folders${next}`, { scroll: false });
  }, [router, searchParams]);

  return (
    <TaxonomyEditor
      api={api}
      workspaceId={workspaceId}
      initialNodes={nodes}
      initialEdges={edges}
      readOnly={readOnly}
      mailConnected={gmailConnected}
      {...(initialMode ? { initialMode } : {})}
      onModeConsumed={clearModeParams}
      onConnectMail={() => startGmailConnect(workspaceId)}
      onGenerate={() => setGenerateOpen(true)}
      generateSlot={({ applyFile }) => (
        <GenerateFromInboxButton
          workspaceId={workspaceId}
          disabled={false}
          gmailConnected={gmailConnected}
          // Hand the accepted proposal back to the editor: replacing folders
          // that already hold threads needs its migration review, not a bare
          // import.
          onApply={applyFile}
          onUseTemplates={() => router.replace("/folders?openTemplates=1")}
          open={generateOpen}
          onOpenChange={setGenerateOpen}
        />
      )}
      onChanged={() => router.refresh()}
    />
  );
}
