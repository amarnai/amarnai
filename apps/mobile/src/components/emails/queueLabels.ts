import { msg } from '@lingui/core/macro';
import type { MessageDescriptor } from '@lingui/core';

// QUEUES (in @amarnai/core) holds the English source text that doubles as each
// queue's stable id. The extractor does not scan packages/core, so the visible
// queue name is localized here, keyed by queue id, and resolved at render with
// `i18n._(QUEUE_NAME_LABELS[id])`. Mirrors packages/ui/src/emails/queueLabels.ts.
export const QUEUE_NAME_LABELS: Record<string, MessageDescriptor> = {
  all: msg`All`,
  sorted: msg`Sorted`,
  review: msg`Needs review`,
  pending: msg`Pending`,
  important: msg`Important`,
};

// Date-group section labels from @amarnai/core's groupThreadsByDate, keyed by
// the English label it returns.
export const DATE_SECTION_LABELS: Record<string, MessageDescriptor> = {
  Today: msg`Today`,
  Yesterday: msg`Yesterday`,
  Earlier: msg`Earlier`,
};
