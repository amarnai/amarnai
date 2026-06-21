import { useQuery } from '@tanstack/react-query';
import { useSession } from '../auth/session';

/**
 * Message body text, keyed by message id. The shared triage view-model carries
 * message metadata (sender, time, snippet) but not bodies, so the detail screen
 * fetches them separately. Bodies come from Gmail and can lag the metadata.
 */
export function useThreadBodies(workspaceId: string, threadId: string) {
  const { client } = useSession();
  return useQuery({
    queryKey: ['threadBodies', workspaceId, threadId],
    queryFn: () => client.threadBodies(workspaceId, threadId),
    enabled: !!workspaceId && !!threadId,
  });
}

/**
 * Full thread detail, used only for the classification rationale
 * (`latestClassification.explanation` + `decisionSource`), which the list-derived
 * view-model thread does not carry. Triage state and mutations come from the hook.
 */
export function useThreadDetail(workspaceId: string, threadId: string) {
  const { client } = useSession();
  return useQuery({
    queryKey: ['threadDetail', workspaceId, threadId],
    queryFn: () => client.emailThread(workspaceId, threadId),
    enabled: !!workspaceId && !!threadId,
  });
}

/**
 * Gmail connection for the active workspace (null when none). The inbox screen
 * uses this to show a "connect Gmail on the web" hint for fresh accounts, since
 * connecting Gmail is a web-only flow.
 */
export function useGmailConnection(workspaceId: string) {
  const { client } = useSession();
  return useQuery({
    queryKey: ['gmailConnection', workspaceId],
    queryFn: () => client.gmailConnection(workspaceId),
    enabled: !!workspaceId,
  });
}

/**
 * Sync status for the active workspace, including `backfillStatus` and
 * `workspacePlan`. The inbox screen uses this to surface the backfill card
 * (upgrade upsell on FREE, "sorting in progress" while a historical backfill
 * runs). Polls while a backfill is RUNNING so the card clears once it finishes.
 */
export function useSyncStatus(workspaceId: string) {
  const { client } = useSession();
  return useQuery({
    queryKey: ['syncStatus', workspaceId],
    queryFn: () => client.syncStatus(workspaceId),
    enabled: !!workspaceId,
    refetchInterval: (query) =>
      query.state.data?.backfillStatus === 'RUNNING' ? 5000 : false,
  });
}
