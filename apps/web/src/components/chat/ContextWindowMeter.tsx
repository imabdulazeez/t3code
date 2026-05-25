import { cn } from "~/lib/utils";
import { type ContextWindowSnapshot, formatContextWindowTokens } from "~/lib/contextWindow";

function formatPercentage(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }
  if (value < 10) {
    return `${value.toFixed(1).replace(/\.0$/, "")}%`;
  }
  return `${Math.round(value)}%`;
}

export function ContextWindowMeter(props: {
  usage: ContextWindowSnapshot;
  onOpenContextTab: () => void;
}) {
  const { usage, onOpenContextTab } = props;
  const usedPercentage = formatPercentage(usage.usedPercentage);
  const normalizedPercentage = Math.max(0, Math.min(100, usage.usedPercentage ?? 0));
  const radius = 9.75;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (normalizedPercentage / 100) * circumference;

  return (
    <button
      type="button"
      onClick={onOpenContextTab}
      className="group/meter inline-flex cursor-pointer items-center justify-center rounded-full p-1 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
      aria-label={
        usage.maxTokens !== null && usedPercentage
          ? `Context window ${usedPercentage} used`
          : `Context window ${formatContextWindowTokens(usage.usedTokens)} tokens used`
      }
    >
      <span className="relative flex h-6 w-6 items-center justify-center">
        <svg
          viewBox="0 0 24 24"
          className="-rotate-90 absolute inset-0 h-full w-full transform-gpu"
          aria-hidden="true"
        >
          <circle
            cx="12"
            cy="12"
            r={radius}
            fill="none"
            stroke="color-mix(in oklab, var(--color-muted) 70%, transparent)"
            strokeWidth="3"
          />
          <circle
            cx="12"
            cy="12"
            r={radius}
            fill="none"
            stroke="var(--color-muted-foreground)"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            className="transition-[stroke-dashoffset] duration-500 ease-out motion-reduce:transition-none"
          />
        </svg>
        <span
          className={cn(
            "relative flex h-[15px] w-[15px] items-center justify-center rounded-full bg-background text-[8px] font-medium transition-colors group-hover/meter:bg-accent",
            "text-muted-foreground",
          )}
        >
          {usage.usedPercentage !== null
            ? Math.round(usage.usedPercentage)
            : formatContextWindowTokens(usage.usedTokens)}
        </span>
      </span>
    </button>
  );
}
