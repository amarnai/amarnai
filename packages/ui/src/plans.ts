// Pricing constants moved to @amarnai/shared so non-DOM clients (mobile) can
// reuse them. Re-exported here so existing web/ui imports keep working unchanged.
export {
  PLANS,
  FEATURE_GROUPS,
  SELF_HOST_NOTE,
} from "@amarnai/shared";
export type {
  Plan,
  PlanId,
  BillingCycle,
  CellValue,
  FeatureRow,
  BillingRow,
  FeatureGroup,
} from "@amarnai/shared";
