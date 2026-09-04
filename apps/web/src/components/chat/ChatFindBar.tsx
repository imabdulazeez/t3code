"use client";

import { useAtomValue } from "@effect/atom-react";
import type { LegendListRef } from "@legendapp/list/react";
import { ChevronDownIcon, ChevronUpIcon, SearchIcon, XIcon } from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { isCommandPaletteOpen } from "../../commandPaletteBus";
import { resolveShortcutCommand } from "../../keybindings";
import { isTerminalFocused } from "../../lib/terminalFocus";
import { Button } from "../ui/button";
import { primaryServerKeybindingsAtom } from "~/state/server";
import { cn } from "~/lib/utils";
import {
  type ChatFindMatch,
  chatFindMatchKey,
  deriveChatFindMatches,
  resolveChatFindActiveIndex,
  resolveChatFindStartIndex,
  stepChatFindIndex,
} from "./ChatFindBar.logic";
import {
  applyChatFindHighlights,
  clearChatFindHighlights,
  findMountedChatRow,
} from "./chatFindHighlight";
import { onOpenChatFind } from "./chatFindBus";
import type { MessagesTimelineRow } from "./MessagesTimeline.logic";

const EMPTY_MATCHES: ReadonlyArray<ChatFindMatch> = [];
const REVEAL_VIEW_OFFSET = 96;
const REVEAL_TOP_MARGIN = 24;
const REVEAL_BOTTOM_FRACTION = 0.6;

interface ChatFindBarProps {
  rows: ReadonlyArray<MessagesTimelineRow>;
  listRef: RefObject<LegendListRef | null>;
  topFadeEnabled: boolean;
  onManualNavigation: () => void;
}

interface ChatFindHighlightState {
  open: boolean;
  query: string;
  matchRowIds: ReadonlySet<string>;
  activeMatch: ChatFindMatch | null;
}

export const ChatFindBar = memo(function ChatFindBar({
  rows,
  listRef,
  topFadeEnabled,
  onManualNavigation,
}: ChatFindBarProps) {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [focusToken, setFocusToken] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const openRef = useRef(false);
  const queryRef = useRef("");
  const activeMatchRef = useRef<ChatFindMatch | null>(null);
  const revealKeyRef = useRef<string | null>(null);
  const revealFirstMatchRef = useRef(false);
  const scrollingRef = useRef(false);
  const frameRef = useRef<number | null>(null);
  const highlightStateRef = useRef<ChatFindHighlightState>({
    open: false,
    query: "",
    matchRowIds: new Set(),
    activeMatch: null,
  });

  const trimmedQuery = query.trim();
  const matches = useMemo(
    () => (open ? deriveChatFindMatches(rows, trimmedQuery) : EMPTY_MATCHES),
    [open, rows, trimmedQuery],
  );
  const matchRowIds = useMemo(() => new Set(matches.map((match) => match.rowId)), [matches]);
  const activeMatch = matches[activeIndex] ?? null;

  const runHighlight = useCallback(() => {
    frameRef.current = null;
    const list = listRef.current;
    const scrollNode = list?.getScrollableNode();
    if (!list || !(scrollNode instanceof HTMLElement)) return;
    const state = highlightStateRef.current;
    if (!state.open || state.query.length === 0) {
      clearChatFindHighlights();
      return;
    }
    const activeRange = applyChatFindHighlights({
      scrollNode,
      query: state.query,
      matchRowIds: state.matchRowIds,
      active: state.activeMatch,
    });
    if (revealKeyRef.current === null || scrollingRef.current) return;
    if (
      state.activeMatch === null ||
      revealKeyRef.current !== chatFindMatchKey(state.activeMatch)
    ) {
      revealKeyRef.current = null;
      return;
    }
    if (activeRange === null) return;
    const rect = activeRange.getBoundingClientRect();
    if (rect.height <= 0) return;
    revealKeyRef.current = null;
    const scrollRect = scrollNode.getBoundingClientRect();
    const inView =
      rect.top >= scrollRect.top + REVEAL_TOP_MARGIN &&
      rect.bottom <= scrollRect.top + scrollNode.clientHeight * REVEAL_BOTTOM_FRACTION;
    if (inView) return;
    const listState = list.getState();
    const offset = Math.max(
      0,
      (listState.scroll ?? scrollNode.scrollTop) + rect.top - scrollRect.top - REVEAL_VIEW_OFFSET,
    );
    scrollingRef.current = true;
    void list.scrollToOffset({ offset, animated: true }).finally(() => {
      scrollingRef.current = false;
    });
  }, [listRef]);

  const scheduleHighlight = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(runHighlight);
  }, [runHighlight]);

  useLayoutEffect(() => {
    highlightStateRef.current = { open, query: trimmedQuery, matchRowIds, activeMatch };
    activeMatchRef.current = activeMatch;
    openRef.current = open;
    queryRef.current = trimmedQuery;
    if (open) scheduleHighlight();
  });

  const reveal = useCallback(
    (match: ChatFindMatch) => {
      const list = listRef.current;
      if (!list) return;
      onManualNavigation();
      revealKeyRef.current = chatFindMatchKey(match);
      const scrollNode = list.getScrollableNode();
      const mounted =
        scrollNode instanceof HTMLElement && findMountedChatRow(scrollNode, match.rowId) !== null;
      if (!mounted) {
        scrollingRef.current = true;
        void list
          .scrollToIndex({
            index: match.rowIndex,
            animated: true,
            viewOffset: REVEAL_VIEW_OFFSET,
          })
          .catch(() => {})
          .finally(() => {
            scrollingRef.current = false;
            scheduleHighlight();
          });
      }
      scheduleHighlight();
    },
    [listRef, onManualNavigation, scheduleHighlight],
  );

  useEffect(() => {
    setActiveIndex((current) =>
      resolveChatFindActiveIndex(matches, current, activeMatchRef.current),
    );
    if (!revealFirstMatchRef.current) return;
    revealFirstMatchRef.current = false;
    if (matches.length === 0) return;
    const scrollNode = listRef.current?.getScrollableNode();
    let fromRowIndex: number | null = null;
    if (scrollNode instanceof HTMLElement) {
      const top = scrollNode.getBoundingClientRect().top;
      for (const element of scrollNode.querySelectorAll<HTMLElement>("[data-timeline-row-id]")) {
        if (element.getBoundingClientRect().bottom <= top) continue;
        const rowId = element.dataset.timelineRowId;
        const rowIndex = rows.findIndex((row) => row.id === rowId);
        if (rowIndex !== -1) fromRowIndex = rowIndex;
        break;
      }
    }
    const startIndex = resolveChatFindStartIndex(matches, fromRowIndex);
    setActiveIndex(startIndex);
    const match = matches[startIndex];
    if (match) reveal(match);
  }, [listRef, matches, reveal, rows]);

  useEffect(() => {
    if (!open) {
      clearChatFindHighlights();
      return;
    }
    const scrollNode = listRef.current?.getScrollableNode();
    if (!(scrollNode instanceof HTMLElement)) return;
    const observer = new MutationObserver(scheduleHighlight);
    observer.observe(scrollNode, { childList: true, characterData: true, subtree: true });
    const cancelReveal = () => {
      revealKeyRef.current = null;
    };
    scrollNode.addEventListener("wheel", cancelReveal, { passive: true });
    scrollNode.addEventListener("touchstart", cancelReveal, { passive: true });
    return () => {
      observer.disconnect();
      scrollNode.removeEventListener("wheel", cancelReveal);
      scrollNode.removeEventListener("touchstart", cancelReveal);
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      clearChatFindHighlights();
    };
  }, [listRef, open, scheduleHighlight]);

  const openBar = useCallback(() => {
    if (!openRef.current && queryRef.current.length > 0) {
      activeMatchRef.current = null;
      revealFirstMatchRef.current = true;
    }
    setOpen(true);
    setFocusToken((token) => token + 1);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || isCommandPaletteOpen()) return;
      const command = resolveShortcutCommand(event, keybindings, {
        context: { terminalFocus: isTerminalFocused() },
      });
      if (command !== "chat.find") return;
      event.preventDefault();
      event.stopPropagation();
      openBar();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [keybindings, openBar]);

  useEffect(() => onOpenChatFind(openBar), [openBar]);

  useEffect(() => {
    if (!open || focusToken === 0) return;
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [focusToken, open]);

  const close = useCallback(() => {
    setOpen(false);
    revealKeyRef.current = null;
    revealFirstMatchRef.current = false;
  }, []);

  const step = useCallback(
    (direction: 1 | -1) => {
      if (matches.length === 0) return;
      const nextIndex = stepChatFindIndex(activeIndex, matches.length, direction);
      setActiveIndex(nextIndex);
      const match = matches[nextIndex];
      if (match) reveal(match);
    },
    [activeIndex, matches, reveal],
  );

  const onQueryChange = useCallback((value: string) => {
    setQuery(value);
    setActiveIndex(0);
    activeMatchRef.current = null;
    revealFirstMatchRef.current = value.trim().length > 0;
  }, []);

  const onInputKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.nativeEvent.isComposing) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        step(event.shiftKey ? -1 : 1);
      }
    },
    [close, step],
  );

  if (!open) return null;

  const hasQuery = trimmedQuery.length > 0;
  const countLabel = !hasQuery
    ? null
    : matches.length === 0
      ? "No matches"
      : `${activeIndex + 1} of ${matches.length}`;

  return (
    <div
      role="search"
      aria-label="Find in chat"
      data-chat-find-bar="true"
      className={cn(
        "absolute right-4 z-30 flex items-center gap-0.5 rounded-[var(--control-radius)] border border-border bg-popover p-1 text-foreground shadow-md",
        topFadeEnabled ? "top-[var(--workspace-titlebar-scroll-fade-height)]" : "top-2",
      )}
    >
      <SearchIcon className="ml-1.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={onInputKeyDown}
        placeholder="Find in chat"
        aria-label="Find in chat"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        className="h-6 w-44 min-w-0 bg-transparent px-1.5 text-xs text-foreground outline-none placeholder:text-placeholder"
      />
      <span
        className={cn(
          "min-w-14 shrink-0 pr-1 text-right text-xs tabular-nums",
          hasQuery && matches.length === 0
            ? "text-destructive-foreground"
            : "text-muted-foreground",
        )}
        aria-live="polite"
      >
        {countLabel}
      </span>
      <Button
        variant="ghost-muted"
        size="icon-xs"
        aria-label="Previous match"
        title="Previous match (Shift+Enter)"
        disabled={matches.length === 0}
        onClick={() => step(-1)}
      >
        <ChevronUpIcon />
      </Button>
      <Button
        variant="ghost-muted"
        size="icon-xs"
        aria-label="Next match"
        title="Next match (Enter)"
        disabled={matches.length === 0}
        onClick={() => step(1)}
      >
        <ChevronDownIcon />
      </Button>
      <Button
        variant="ghost-muted"
        size="icon-xs"
        aria-label="Close find"
        title="Close (Esc)"
        onClick={close}
      >
        <XIcon />
      </Button>
    </div>
  );
});
