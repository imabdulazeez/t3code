import { createFileRoute, redirect } from "@tanstack/react-router";

import { UsagePage, isUsageMetric } from "../components/usage/UsagePage";

function UsageRoute() {
  const { metric } = Route.useSearch();
  return <UsagePage initialMetric={metric} />;
}

export const Route = createFileRoute("/usage")({
  beforeLoad: async ({ context }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/pair", replace: true });
    }
  },
  validateSearch: (raw: Record<string, unknown>) =>
    isUsageMetric(raw.metric) ? { metric: raw.metric } : {},
  component: UsageRoute,
});
