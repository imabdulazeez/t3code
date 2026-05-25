export interface SessionContextFormatter {
  number(value: number | null): string;
  percent(value: number | null): string;
  time(value: string | null | undefined): string;
}

const FALLBACK = "—";

export function createSessionContextFormatter(
  locale?: string | ReadonlyArray<string>,
): SessionContextFormatter {
  const localeArg = locale === undefined ? undefined : (locale as string | string[]);
  const numberFormatter = new Intl.NumberFormat(localeArg);
  const dateTimeFormatter = new Intl.DateTimeFormat(localeArg, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const percentFormatter = new Intl.NumberFormat(localeArg, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  });

  return {
    number(value) {
      if (value === null || !Number.isFinite(value)) return FALLBACK;
      return numberFormatter.format(value);
    },
    percent(value) {
      if (value === null || !Number.isFinite(value)) return FALLBACK;
      return `${percentFormatter.format(value)}%`;
    },
    time(value) {
      if (!value) return FALLBACK;
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return FALLBACK;
      return dateTimeFormatter.format(date);
    },
  };
}
