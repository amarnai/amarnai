import { msg } from "@lingui/core/macro";
import type { MessageDescriptor } from "@lingui/core";

// QUEUES (in @amarnai/core) holds the English source text that doubles as the
// stable identity for each queue. The extractor does not scan packages/core, so
// the user-visible name/description are localized here, at the render edge,
// keyed by queue id. Render with `i18n._(QUEUE_LABELS[id].name)`.
export const QUEUE_LABELS: Record<string, { name: MessageDescriptor; desc: MessageDescriptor }> = {
  all: {
    name: msg`All`,
    desc: msg`Every thread in your inbox.`,
  },
  sorted: {
    name: msg`Sorted`,
    desc: msg`Threads Amarnai has successfully routed to a folder.`,
  },
  review: {
    name: msg`Needs review`,
    desc: msg`Threads flagged for review. Amarnai wasn't confident enough to sort automatically.`,
  },
  pending: {
    name: msg`Pending`,
    desc: msg`Threads that haven't been sorted yet.`,
  },
  important: {
    name: msg`Important`,
    desc: msg`Threads you've marked as important.`,
  },
  assigned: {
    name: msg`Assigned`,
    desc: msg`Threads assigned to you.`,
  },
};
