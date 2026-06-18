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
