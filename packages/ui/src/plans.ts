// Pricing constants moved to @amarnai/shared so non-DOM clients (mobile) can
// reuse them. Re-exported here so existing web/ui imports keep working unchanged.
export {
  PLANS,
  PLAN_FEATURES,
  FEATURE_GROUPS,
  SELF_HOST_NOTE,
} from "@amarnai/shared";
export type {
  Plan,
  PlanFeature,
  PlanId,
  BillingCycle,
  FeatureValue,
  CellValue,
  FeatureRow,
  BillingRow,
  FeatureGroup,
} from "@amarnai/shared";
