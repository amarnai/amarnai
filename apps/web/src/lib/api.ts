import { makeApiClient } from "@amarnai/api-client";
import type { ApiTransport } from "@amarnai/api-client";

// ─── Web transport ─────────────────────────────────────────────────────────────
// Browser calls go through /api/internal (Next.js proxy injects auth).
// Server calls add INTERNAL_API_SECRET + X-User-Id directly.

const isBrowser = typeof window !== "undefined";

// HeadersInit is Headers | string[][] | Record<string,string>.
// Spreading a Headers instance or string[][] as a plain object silently drops
// all entries. Normalize to a plain record before merging auth headers.
function headersToRecord(h: HeadersInit | undefined): Record<string, string> {
  if (!h) return {};
  if (h instanceof Headers) return Object.fromEntries(h.entries());
  if (Array.isArray(h)) return Object.fromEntries(h as [string, string][]);
  return h;
}

function makeWebTransport(serverUserId?: string): ApiTransport {
  const baseUrl = isBrowser
    ? "/api/internal"
    : (process.env["API_URL"] ?? "http://localhost:3001");

  if (isBrowser) {
    return { baseUrl, fetch: (url, init) => globalThis.fetch(url, init) };
  }

  const secret = process.env["INTERNAL_API_SECRET"] ?? "dev-internal-secret";
  return {
    baseUrl,
    fetch: (url, init) => {
      const { next, headers: initHeaders, ...rest } = init;
      return globalThis.fetch(url, {
        ...rest,
        ...(next !== undefined ? { next } : {}),
        headers: {
          ...headersToRecord(initHeaders),
          Authorization: `Bearer ${secret}`,
          ...(serverUserId ? { "X-User-Id": serverUserId } : {}),
        },
      });
    },
  };
}

// Browser and server-action callers that already have auth context injected
// by the /api/internal proxy use this default instance.
export const api = makeApiClient(makeWebTransport());

// Server components that call workspace-scoped API routes directly must pass
// the authenticated user's ID so requireWorkspaceMember can authorise the request.
export const apiFor = (userId: string) => makeApiClient(makeWebTransport(userId));

// ─── Re-export all types for backward compatibility ────────────────────────────

export type {
  Workspace,
  TaxonomyNode,
  CreateTaxonomyNodeInput,
  UpdateTaxonomyNodeInput,
  TaxonomyEdge,
  CreateTaxonomyEdgeInput,
  UpdateTaxonomyEdgeInput,
  GmailConnection,
  MailProvider,
  DisconnectResult,
  SyncStatus,
  BackfillStatus,
  GmailSyncSettings,
  FolderCountsResult,
  FilterCounts,
  EmailTag,
  ClassificationSummary,
  Classification,
  EmailThreadSummary,
  EmailThreadListResult,
  EmailThreadDetail,
  TriageStatus,
  DoneMark,
  Draft,
  GenerateDraftResult,
  MockInboxEventInput,
  MockInboxResult,
  CandidateNodeInput,
  CandidateNode,
  CandidateNodeResult,
  LLMNodeSelectionResult,
  GmailRecentThreadsResult,
  GmailSortPathStep,
  GmailSortResult,
  ClassifyResult,
  QueuedResult,
} from "@amarnai/api-client";
