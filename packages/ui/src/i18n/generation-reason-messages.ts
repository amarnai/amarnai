import { msg } from "@lingui/core/macro";
import type { MessageDescriptor } from "@lingui/core";

// Extraction-only declarations. generationReasonText in
// packages/core/src/taxonomy/generationDisplay.ts returns plain English source
// strings and lives outside the Lingui extract paths; this file mirrors every
// not-eligible reason string (including the {when} ICU variants) as a `msg` so
// they land in the catalog. At runtime the strings are translated by lookup via
// the `translate` fn passed into generationReasonText, keyed by these same
// English sources. Never executed for data.
const when = "";

export const GENERATION_REASON_MESSAGES: MessageDescriptor[] = [
  msg`Your inbox doesn't have enough variety yet to personalize a taxonomy. Choose a template instead.`,
  msg`Still importing your inbox. Check back once the import finishes.`,
  msg`No significant new mail since your last generation, so the result would be the same. Available again once your inbox grows.`,
  msg`Recently attempted. Available again ${when}.`,
  msg`Recently attempted. Try again later.`,
  msg`You've used your generations for now. Available again ${when}.`,
  msg`You've used your generations for now.`,
  msg`Generation isn't available right now.`,
];
