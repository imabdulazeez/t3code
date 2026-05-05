import { ChevronsUpDownIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { cn } from "../../lib/utils";
import { isMonospaceFamily, loadSystemFonts, type SystemFont } from "../../lib/systemFonts";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxStatus,
  ComboboxTrigger,
  useComboboxFilter,
} from "../ui/combobox";
import { Switch } from "../ui/switch";

const FONT_PICKER_TRIGGER_CLASS_NAME =
  "relative inline-flex cursor-pointer select-none items-center justify-between gap-2 border rounded-lg text-left text-base outline-none transition-[color,box-shadow,background-color] data-disabled:pointer-events-none data-disabled:opacity-64 sm:text-sm w-full min-w-36 border-input bg-background not-dark:bg-clip-padding text-foreground shadow-xs/5 ring-ring/24 before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-lg)-1px)] not-data-popup-open:before:shadow-[0_1px_--theme(--color-black/4%)] focus-visible:border-ring focus-visible:ring-[3px] dark:bg-input/32 dark:not-data-popup-open:before:shadow-[0_-1px_--theme(--color-white/6%)] data-popup-open:shadow-none min-h-9 px-[calc(--spacing(3)-1px)] sm:min-h-8";

const FONT_PICKER_TRIGGER_ICON_CLASS_NAME =
  "-me-1 size-4.5 opacity-80 sm:size-4 shrink-0 pointer-events-none";

const SYSTEM_DEFAULT_VALUE = "__system_default__";
const SYSTEM_DEFAULT_LABEL = "System default";

interface DiffFontPickerProps {
  readonly value: string;
  readonly onValueChange: (next: string) => void;
  readonly className?: string;
}

interface PickerItem {
  readonly value: string;
  readonly label: string;
  readonly fontFamily: string | null;
  readonly isMonospace: boolean;
}

function buildItems(fonts: ReadonlyArray<SystemFont>, currentValue: string): PickerItem[] {
  const items: PickerItem[] = [
    {
      value: SYSTEM_DEFAULT_VALUE,
      label: SYSTEM_DEFAULT_LABEL,
      fontFamily: null,
      isMonospace: true,
    },
  ];
  const seen = new Set<string>();
  for (const font of fonts) {
    if (seen.has(font.family)) continue;
    seen.add(font.family);
    items.push({
      value: font.family,
      label: font.family,
      fontFamily: font.family,
      isMonospace: font.isMonospace,
    });
  }
  if (currentValue && !seen.has(currentValue)) {
    items.push({
      value: currentValue,
      label: currentValue,
      fontFamily: currentValue,
      isMonospace: isMonospaceFamily(currentValue),
    });
  }
  return items;
}

export function DiffFontPicker({ value, onValueChange, className }: DiffFontPickerProps) {
  const [open, setOpen] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [fonts, setFonts] = useState<ReadonlyArray<SystemFont>>([]);
  const [source, setSource] = useState<"local-fonts" | "fallback" | null>(null);
  const [query, setQuery] = useState("");
  const [monospaceOnly, setMonospaceOnly] = useState(true);
  const filter = useComboboxFilter();

  useEffect(() => {
    if (!open || hasLoaded) return;
    let cancelled = false;
    void loadSystemFonts()
      .then((result) => {
        if (cancelled) return;
        setFonts(result.fonts);
        setSource(result.source);
        setHasLoaded(true);
      })
      .catch((error) => {
        if (cancelled) return;
        console.warn("[DiffFontPicker] failed to load system fonts", error);
        setHasLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open, hasLoaded]);

  const items = useMemo(() => buildItems(fonts, value), [fonts, value]);

  const filteredItems = useMemo(() => {
    const base = monospaceOnly
      ? items.filter((item) => item.value === SYSTEM_DEFAULT_VALUE || item.isMonospace)
      : items;
    const trimmedQuery = query.trim();
    if (trimmedQuery.length === 0) return base;
    return base.filter((item) => filter.contains(item.label, trimmedQuery));
  }, [items, monospaceOnly, query, filter]);

  const triggerLabel = value ? value : SYSTEM_DEFAULT_LABEL;
  const selectedValue = value ? value : SYSTEM_DEFAULT_VALUE;

  const handleValueChange = (next: string | null) => {
    if (next === null) return;
    if (next === SYSTEM_DEFAULT_VALUE) {
      onValueChange("");
    } else {
      onValueChange(next);
    }
    setOpen(false);
    setQuery("");
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setQuery("");
    }
  };

  const statusText = !hasLoaded
    ? "Loading fonts..."
    : source === "fallback"
      ? "Showing common monospace fonts."
      : null;

  return (
    <Combobox
      items={filteredItems.map((item) => item.value)}
      filter={null}
      value={selectedValue}
      onValueChange={handleValueChange}
      open={open}
      onOpenChange={handleOpenChange}
    >
      <ComboboxTrigger className={cn(FONT_PICKER_TRIGGER_CLASS_NAME, className)}>
        <span
          className="flex-1 truncate"
          style={value ? { fontFamily: `"${value}"` } : undefined}
        >
          {triggerLabel}
        </span>
        <ChevronsUpDownIcon className={FONT_PICKER_TRIGGER_ICON_CLASS_NAME} />
      </ComboboxTrigger>
      <ComboboxPopup align="end" className="w-72">
        <div className="border-b p-1">
          <ComboboxInput
            className="[&_input]:font-sans rounded-md"
            inputClassName="ring-0"
            placeholder="Search fonts..."
            showTrigger={false}
            size="sm"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="flex items-center justify-between gap-2 border-b px-3 py-1.5 text-xs text-muted-foreground">
          <label className="flex items-center gap-2 cursor-pointer">
            <Switch
              checked={monospaceOnly}
              onCheckedChange={(checked) => setMonospaceOnly(Boolean(checked))}
              aria-label="Only show monospace fonts"
            />
            <span>Monospace only</span>
          </label>
        </div>
        <ComboboxEmpty>No fonts found.</ComboboxEmpty>
        <ComboboxList className="max-h-64">
          {filteredItems.map((item, index) => (
            <ComboboxItem
              key={item.value}
              index={index}
              value={item.value}
              hideIndicator
            >
              <span
                className="truncate"
                style={
                  item.fontFamily
                    ? { fontFamily: `"${item.fontFamily}"` }
                    : undefined
                }
              >
                {item.label}
              </span>
            </ComboboxItem>
          ))}
        </ComboboxList>
        {statusText ? <ComboboxStatus>{statusText}</ComboboxStatus> : null}
      </ComboboxPopup>
    </Combobox>
  );
}
