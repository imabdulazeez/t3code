export interface SystemFont {
  readonly family: string;
  readonly isMonospace: boolean;
}

export interface SystemFontList {
  readonly fonts: ReadonlyArray<SystemFont>;
  readonly source: "local-fonts" | "fallback";
}

interface FontData {
  readonly family: string;
  readonly fullName?: string;
  readonly postscriptName?: string;
  readonly style?: string;
}

interface QueryLocalFontsWindow {
  queryLocalFonts?: () => Promise<ReadonlyArray<FontData>>;
}

const KNOWN_MONOSPACE_FAMILIES: ReadonlyArray<string> = [
  "Andale Mono",
  "Cascadia Code",
  "Cascadia Mono",
  "Consolas",
  "Courier",
  "Courier New",
  "DejaVu Sans Mono",
  "Fira Code",
  "Fira Mono",
  "Hack",
  "IBM Plex Mono",
  "Inconsolata",
  "JetBrains Mono",
  "Liberation Mono",
  "Menlo",
  "Monaco",
  "MonoLisa",
  "Noto Sans Mono",
  "Operator Mono",
  "PT Mono",
  "Roboto Mono",
  "SF Mono",
  "Source Code Pro",
  "Ubuntu Mono",
  "Victor Mono",
];

const MONOSPACE_NAME_HINTS: ReadonlyArray<string> = [
  "mono",
  "code",
  "console",
  "courier",
  "terminal",
  "typewriter",
];

const KNOWN_MONOSPACE_SET = new Set(KNOWN_MONOSPACE_FAMILIES.map((name) => name.toLowerCase()));

function isLikelyMonospace(family: string): boolean {
  const lower = family.toLowerCase();
  if (KNOWN_MONOSPACE_SET.has(lower)) return true;
  return MONOSPACE_NAME_HINTS.some((hint) => lower.includes(hint));
}

function buildFallbackFontList(): SystemFontList {
  const fonts = KNOWN_MONOSPACE_FAMILIES.map((family) => ({
    family,
    isMonospace: true,
  }));
  return { fonts, source: "fallback" };
}

let cachedFontsPromise: Promise<SystemFontList> | null = null;

async function loadSystemFontsUncached(): Promise<SystemFontList> {
  if (typeof window === "undefined") {
    return buildFallbackFontList();
  }
  const queryLocalFonts = (window as QueryLocalFontsWindow).queryLocalFonts;
  if (typeof queryLocalFonts !== "function") {
    return buildFallbackFontList();
  }

  try {
    const fontData = await queryLocalFonts();
    const familyMap = new Map<string, SystemFont>();
    for (const entry of fontData) {
      const family = entry.family?.trim();
      if (!family) continue;
      if (familyMap.has(family)) continue;
      familyMap.set(family, {
        family,
        isMonospace: isLikelyMonospace(family),
      });
    }
    if (familyMap.size === 0) {
      return buildFallbackFontList();
    }
    const fonts = [...familyMap.values()].sort((left, right) =>
      left.family.localeCompare(right.family, undefined, { sensitivity: "base" }),
    );
    return { fonts, source: "local-fonts" };
  } catch (error) {
    console.warn("[systemFonts] queryLocalFonts() failed; using fallback", error);
    return buildFallbackFontList();
  }
}

export function loadSystemFonts(): Promise<SystemFontList> {
  if (!cachedFontsPromise) {
    cachedFontsPromise = loadSystemFontsUncached().catch((error) => {
      cachedFontsPromise = null;
      throw error;
    });
  }
  return cachedFontsPromise;
}

export function isMonospaceFamily(family: string): boolean {
  return isLikelyMonospace(family);
}
