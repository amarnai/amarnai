// Pricing constants moved to @aziru/shared so non-DOM clients (mobile) can
// reuse them. Re-exported here so existing web/ui imports keep working unchanged.
export {
  PLANS,
  FEATURE_GROUPS,
  SELF_HOST_NOTE,
} from "@aziru/shared";
export type {
  Plan,
  PlanId,
  BillingCycle,
  CellValue,
  FeatureRow,
  BillingRow,
  FeatureGroup,
} from "@aziru/shared";
