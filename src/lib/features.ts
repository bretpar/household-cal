/**
 * Central feature entitlements. Every Timesheet surface (owner hub, caregiver
 * tab, settings, badge, server actions) asks this module — never hardcode.
 * A future paid-plan system maps a household's plan into this function.
 * Disabling a feature only hides/blocks it; stored data is never touched.
 */
export type FeatureKey = "timesheets";

export interface EntitlementContext {
  familyId?: string | null | undefined;
}

const DEFAULT_ENTITLEMENTS: Record<FeatureKey, boolean> = {
  timesheets: true,
};

export function hasFeature(feature: FeatureKey, _ctx: EntitlementContext = {}): boolean {
  return DEFAULT_ENTITLEMENTS[feature];
}

export function assertFeature(feature: FeatureKey, ctx: EntitlementContext = {}) {
  if (!hasFeature(feature, ctx)) throw new Error("This feature isn't available for your household");
}
