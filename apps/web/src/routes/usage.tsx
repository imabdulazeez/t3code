import { createFileRoute } from "@tanstack/react-router";

import { UsagePage, isUsageMetric } from "../components/usage/UsagePage";

function UsageRoute() {
  const { metric } = Route.useSearch();
  return <UsagePage initialMetric={metric} />;
}

export const Route = createFileRoute("/usage")({
  // `?metric=limits` opens the page on a tab; the sidebar limit indicator links here.
  validateSearch: (raw: Record<string, unknown>) =>
    isUsageMetric(raw.metric) ? { metric: raw.metric } : {},
  component: UsageRoute,
});
