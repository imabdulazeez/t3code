/**
 * Single Zustand store for terminal UI state keyed by scoped terminal owner.
 *
 * Terminal transition helpers are intentionally private to keep the public
 * API constrained to store actions/selectors.
 */

import {
  parseScopedThreadKey,
  projectTerminalOwnerRef,
  terminalOwnerKey,
  type TerminalOwnerRef,
  threadTerminalOwnerRef,
} from "@t3tools/client-runtime";
import { type ProjectId, type ProjectScriptScope, type TerminalEvent } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { resolveStorage } from "./lib/storage";
import { terminalRunningSubprocessFromEvent } from "./terminalActivity";
import {
  DEFAULT_THREAD_TERMINAL_HEIGHT,
  DEFAULT_THREAD_TERMINAL_ID,
  MAX_TERMINALS_PER_GROUP,
  type ThreadTerminalGroup,
} from "./types";

interface ThreadTerminalState {
  terminalOpen: boolean;
  terminalHeight: number;
  terminalIds: string[];
  runningTerminalIds: string[];
  terminalCommands: Record<string, string>;
  activeTerminalId: string;
  terminalGroups: ThreadTerminalGroup[];
  activeTerminalGroupId: string;
}

const LEGACY_PROJECT_TERMINAL_THREAD_PREFIX = "project:";

export interface ThreadTerminalLaunchContext {
  cwd: string;
  worktreePath: string | null;
}

export interface TerminalEventEntry {
  id: number;
  event: TerminalEvent;
}

const TERMINAL_STATE_STORAGE_KEY = "t3code:terminal-state:v1";
const EMPTY_TERMINAL_EVENT_ENTRIES: ReadonlyArray<TerminalEventEntry> = [];
const MAX_TERMINAL_EVENT_BUFFER = 200;

interface PersistedTerminalStateStoreState {
  terminalStateByThreadKey?: Record<string, ThreadTerminalState>;
  defaultTerminalScopeByProjectId?: Record<string, ProjectScriptScope>;
}

function migrateLegacyThreadKeyToOwnerKey(legacyKey: string): string | null {
  const parsed = parseScopedThreadKey(legacyKey);
  if (!parsed) {
    return null;
  }
  const localId = parsed.threadId as unknown as string;
  if (localId.startsWith(LEGACY_PROJECT_TERMINAL_THREAD_PREFIX)) {
    const projectId = localId.slice(LEGACY_PROJECT_TERMINAL_THREAD_PREFIX.length);
    if (projectId.length === 0) {
      return null;
    }
    return terminalOwnerKey(projectTerminalOwnerRef(parsed.environmentId, projectId as ProjectId));
  }
  return terminalOwnerKey(threadTerminalOwnerRef(parsed.environmentId, parsed.threadId));
}

function resolveOwnerStateKey(rawKey: string, version: number): string | null {
  if (version >= 4) {
    return rawKey.includes("::") ? rawKey : null;
  }
  return migrateLegacyThreadKeyToOwnerKey(rawKey);
}

export function migratePersistedTerminalStateStoreState(
  persistedState: unknown,
  version: number,
): PersistedTerminalStateStoreState {
  if (version >= 1 && persistedState && typeof persistedState === "object") {
    const candidate = persistedState as PersistedTerminalStateStoreState;
    const nextTerminalStateByThreadKey: Record<string, ThreadTerminalState> = {};
    for (const [rawKey, threadState] of Object.entries(candidate.terminalStateByThreadKey ?? {})) {
      const ownerKey = resolveOwnerStateKey(rawKey, version);
      if (!ownerKey) {
        continue;
      }
      const safeState = threadState as Partial<ThreadTerminalState>;
      nextTerminalStateByThreadKey[ownerKey] = normalizeThreadTerminalState({
        ...createDefaultThreadTerminalState(),
        ...safeState,
        terminalCommands: safeState.terminalCommands ?? {},
      });
    }
    const defaultTerminalScopeByProjectId =
      candidate.defaultTerminalScopeByProjectId &&
      typeof candidate.defaultTerminalScopeByProjectId === "object"
        ? Object.fromEntries(
            Object.entries(candidate.defaultTerminalScopeByProjectId).filter(
              ([, scope]) => scope === "chat" || scope === "project",
            ),
          )
        : {};
    return {
      terminalStateByThreadKey: nextTerminalStateByThreadKey,
      defaultTerminalScopeByProjectId,
    };
  }
  return { terminalStateByThreadKey: {}, defaultTerminalScopeByProjectId: {} };
}

function createTerminalStateStorage() {
  return resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined);
}

function normalizeTerminalIds(terminalIds: string[]): string[] {
  return [...new Set(terminalIds.map((id) => id.trim()).filter((id) => id.length > 0))];
}

function normalizeRunningTerminalIds(
  runningTerminalIds: string[],
  terminalIds: string[],
): string[] {
  if (runningTerminalIds.length === 0) return [];
  const validTerminalIdSet = new Set(terminalIds);
  return [...new Set(runningTerminalIds)]
    .map((id) => id.trim())
    .filter((id) => id.length > 0 && validTerminalIdSet.has(id));
}

function normalizeTerminalCommands(
  terminalCommands: Record<string, string> | undefined,
  terminalIds: string[],
): Record<string, string> {
  if (!terminalCommands) return {};
  const validTerminalIdSet = new Set(terminalIds);
  const next: Record<string, string> = {};
  for (const [id, command] of Object.entries(terminalCommands)) {
    if (validTerminalIdSet.has(id) && typeof command === "string" && command.length > 0) {
      next[id] = command;
    }
  }
  return next;
}

function stringRecordsEqual(a: Record<string, string>, b: Record<string, string>): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

function fallbackGroupId(terminalId: string): string {
  return `group-${terminalId}`;
}

function assignUniqueGroupId(baseId: string, usedGroupIds: Set<string>): string {
  let candidate = baseId;
  let index = 2;
  while (usedGroupIds.has(candidate)) {
    candidate = `${baseId}-${index}`;
    index += 1;
  }
  usedGroupIds.add(candidate);
  return candidate;
}

function findGroupIndexByTerminalId(
  terminalGroups: ThreadTerminalGroup[],
  terminalId: string,
): number {
  return terminalGroups.findIndex((group) => group.terminalIds.includes(terminalId));
}

function normalizeTerminalGroupIds(terminalIds: string[]): string[] {
  return [...new Set(terminalIds.map((id) => id.trim()).filter((id) => id.length > 0))];
}

function normalizeTerminalGroups(
  terminalGroups: ThreadTerminalGroup[],
  terminalIds: string[],
): ThreadTerminalGroup[] {
  if (terminalIds.length === 0) {
    return [];
  }

  const validTerminalIdSet = new Set(terminalIds);
  const assignedTerminalIds = new Set<string>();
  const nextGroups: ThreadTerminalGroup[] = [];
  const usedGroupIds = new Set<string>();

  for (const group of terminalGroups) {
    const groupTerminalIds = normalizeTerminalGroupIds(group.terminalIds).filter((terminalId) => {
      if (!validTerminalIdSet.has(terminalId)) return false;
      if (assignedTerminalIds.has(terminalId)) return false;
      return true;
    });
    if (groupTerminalIds.length === 0) continue;
    for (const terminalId of groupTerminalIds) {
      assignedTerminalIds.add(terminalId);
    }
    const baseGroupId =
      group.id.trim().length > 0
        ? group.id.trim()
        : fallbackGroupId(groupTerminalIds[0] ?? DEFAULT_THREAD_TERMINAL_ID);
    nextGroups.push({
      id: assignUniqueGroupId(baseGroupId, usedGroupIds),
      terminalIds: groupTerminalIds,
    });
  }

  for (const terminalId of terminalIds) {
    if (assignedTerminalIds.has(terminalId)) continue;
    nextGroups.push({
      id: assignUniqueGroupId(fallbackGroupId(terminalId), usedGroupIds),
      terminalIds: [terminalId],
    });
  }

  if (nextGroups.length === 0) {
    return [
      {
        id: fallbackGroupId(DEFAULT_THREAD_TERMINAL_ID),
        terminalIds: [DEFAULT_THREAD_TERMINAL_ID],
      },
    ];
  }

  return nextGroups;
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

function terminalGroupsEqual(left: ThreadTerminalGroup[], right: ThreadTerminalGroup[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const leftGroup = left[index];
    const rightGroup = right[index];
    if (!leftGroup || !rightGroup) return false;
    if (leftGroup.id !== rightGroup.id) return false;
    if (!arraysEqual(leftGroup.terminalIds, rightGroup.terminalIds)) return false;
  }
  return true;
}

function threadTerminalStateEqual(left: ThreadTerminalState, right: ThreadTerminalState): boolean {
  return (
    left.terminalOpen === right.terminalOpen &&
    left.terminalHeight === right.terminalHeight &&
    left.activeTerminalId === right.activeTerminalId &&
    left.activeTerminalGroupId === right.activeTerminalGroupId &&
    arraysEqual(left.terminalIds, right.terminalIds) &&
    arraysEqual(left.runningTerminalIds, right.runningTerminalIds) &&
    stringRecordsEqual(left.terminalCommands, right.terminalCommands) &&
    terminalGroupsEqual(left.terminalGroups, right.terminalGroups)
  );
}

const DEFAULT_THREAD_TERMINAL_STATE: ThreadTerminalState = Object.freeze({
  terminalOpen: false,
  terminalHeight: DEFAULT_THREAD_TERMINAL_HEIGHT,
  terminalIds: [DEFAULT_THREAD_TERMINAL_ID],
  runningTerminalIds: [],
  terminalCommands: {},
  activeTerminalId: DEFAULT_THREAD_TERMINAL_ID,
  terminalGroups: [
    {
      id: fallbackGroupId(DEFAULT_THREAD_TERMINAL_ID),
      terminalIds: [DEFAULT_THREAD_TERMINAL_ID],
    },
  ],
  activeTerminalGroupId: fallbackGroupId(DEFAULT_THREAD_TERMINAL_ID),
});

function createDefaultThreadTerminalState(): ThreadTerminalState {
  return {
    ...DEFAULT_THREAD_TERMINAL_STATE,
    terminalIds: [...DEFAULT_THREAD_TERMINAL_STATE.terminalIds],
    runningTerminalIds: [...DEFAULT_THREAD_TERMINAL_STATE.runningTerminalIds],
    terminalCommands: { ...DEFAULT_THREAD_TERMINAL_STATE.terminalCommands },
    terminalGroups: copyTerminalGroups(DEFAULT_THREAD_TERMINAL_STATE.terminalGroups),
  };
}

function getDefaultThreadTerminalState(): ThreadTerminalState {
  return DEFAULT_THREAD_TERMINAL_STATE;
}

function normalizeThreadTerminalState(state: ThreadTerminalState): ThreadTerminalState {
  const terminalIds = normalizeTerminalIds(state.terminalIds);
  const nextTerminalIds = terminalIds;
  const runningTerminalIds = normalizeRunningTerminalIds(state.runningTerminalIds, nextTerminalIds);
  const activeTerminalId = nextTerminalIds.includes(state.activeTerminalId)
    ? state.activeTerminalId
    : (nextTerminalIds[0] ?? DEFAULT_THREAD_TERMINAL_ID);
  const terminalGroups = normalizeTerminalGroups(state.terminalGroups, nextTerminalIds);
  const activeGroupIdFromState = terminalGroups.some(
    (group) => group.id === state.activeTerminalGroupId,
  )
    ? state.activeTerminalGroupId
    : null;
  const activeGroupIdFromTerminal =
    terminalGroups.find((group) => group.terminalIds.includes(activeTerminalId))?.id ?? null;

  const terminalCommands = normalizeTerminalCommands(state.terminalCommands, nextTerminalIds);
  const normalized: ThreadTerminalState = {
    terminalOpen: state.terminalOpen,
    terminalHeight:
      Number.isFinite(state.terminalHeight) && state.terminalHeight > 0
        ? state.terminalHeight
        : DEFAULT_THREAD_TERMINAL_HEIGHT,
    terminalIds: nextTerminalIds,
    runningTerminalIds,
    terminalCommands,
    activeTerminalId,
    terminalGroups,
    activeTerminalGroupId:
      activeGroupIdFromState ??
      activeGroupIdFromTerminal ??
      terminalGroups[0]?.id ??
      fallbackGroupId(DEFAULT_THREAD_TERMINAL_ID),
  };
  return threadTerminalStateEqual(state, normalized) ? state : normalized;
}

function isDefaultThreadTerminalState(state: ThreadTerminalState): boolean {
  const normalized = normalizeThreadTerminalState(state);
  return threadTerminalStateEqual(normalized, DEFAULT_THREAD_TERMINAL_STATE);
}

function isValidTerminalId(terminalId: string): boolean {
  return terminalId.trim().length > 0;
}

function ownerRefLocalId(ownerRef: TerminalOwnerRef): string {
  return ownerRef.owner.type === "thread" ? ownerRef.owner.threadId : ownerRef.owner.projectId;
}

function isUsableOwnerRef(
  ownerRef: TerminalOwnerRef | null | undefined,
): ownerRef is TerminalOwnerRef {
  return Boolean(ownerRef) && ownerRefLocalId(ownerRef as TerminalOwnerRef).length > 0;
}

function terminalStateKey(ownerRef: TerminalOwnerRef): string {
  return terminalOwnerKey(ownerRef);
}

function terminalEventBufferKey(ownerRef: TerminalOwnerRef, terminalId: string): string {
  return `${terminalStateKey(ownerRef)}\u0000${terminalId}`;
}

function copyTerminalGroups(groups: ThreadTerminalGroup[]): ThreadTerminalGroup[] {
  return groups.map((group) => ({
    id: group.id,
    terminalIds: [...group.terminalIds],
  }));
}

function appendTerminalEventEntry(
  terminalEventEntriesByKey: Record<string, ReadonlyArray<TerminalEventEntry>>,
  nextTerminalEventId: number,
  ownerRef: TerminalOwnerRef,
  event: TerminalEvent,
) {
  const key = terminalEventBufferKey(ownerRef, event.terminalId);
  const currentEntries = terminalEventEntriesByKey[key] ?? EMPTY_TERMINAL_EVENT_ENTRIES;
  const nextEntry: TerminalEventEntry = {
    id: nextTerminalEventId,
    event,
  };
  const nextEntries =
    currentEntries.length >= MAX_TERMINAL_EVENT_BUFFER
      ? [...currentEntries.slice(1), nextEntry]
      : [...currentEntries, nextEntry];

  return {
    terminalEventEntriesByKey: {
      ...terminalEventEntriesByKey,
      [key]: nextEntries,
    },
    nextTerminalEventId: nextTerminalEventId + 1,
  };
}

function launchContextFromStartEvent(
  event: Extract<TerminalEvent, { type: "started" | "restarted" }>,
): ThreadTerminalLaunchContext {
  return {
    cwd: event.snapshot.cwd,
    worktreePath: event.snapshot.worktreePath,
  };
}

function upsertTerminalIntoGroups(
  state: ThreadTerminalState,
  terminalId: string,
  mode: "split" | "new",
): ThreadTerminalState {
  const normalized = normalizeThreadTerminalState(state);
  if (!isValidTerminalId(terminalId)) {
    return normalized;
  }

  if (normalized.terminalIds.length === 0) {
    return normalizeThreadTerminalState({
      ...normalized,
      terminalOpen: true,
      terminalIds: [terminalId],
      activeTerminalId: terminalId,
      terminalGroups: [{ id: fallbackGroupId(terminalId), terminalIds: [terminalId] }],
      activeTerminalGroupId: fallbackGroupId(terminalId),
    });
  }

  const isNewTerminal = !normalized.terminalIds.includes(terminalId);
  const terminalIds = isNewTerminal
    ? [...normalized.terminalIds, terminalId]
    : normalized.terminalIds;
  const terminalGroups = copyTerminalGroups(normalized.terminalGroups);

  const existingGroupIndex = findGroupIndexByTerminalId(terminalGroups, terminalId);
  if (existingGroupIndex >= 0) {
    terminalGroups[existingGroupIndex]!.terminalIds = terminalGroups[
      existingGroupIndex
    ]!.terminalIds.filter((id) => id !== terminalId);
    if (terminalGroups[existingGroupIndex]!.terminalIds.length === 0) {
      terminalGroups.splice(existingGroupIndex, 1);
    }
  }

  if (mode === "new") {
    const usedGroupIds = new Set(terminalGroups.map((group) => group.id));
    const nextGroupId = assignUniqueGroupId(fallbackGroupId(terminalId), usedGroupIds);
    terminalGroups.push({ id: nextGroupId, terminalIds: [terminalId] });
    return normalizeThreadTerminalState({
      ...normalized,
      terminalOpen: true,
      terminalIds,
      activeTerminalId: terminalId,
      terminalGroups,
      activeTerminalGroupId: nextGroupId,
    });
  }

  let activeGroupIndex = terminalGroups.findIndex(
    (group) => group.id === normalized.activeTerminalGroupId,
  );
  if (activeGroupIndex < 0) {
    activeGroupIndex = findGroupIndexByTerminalId(terminalGroups, normalized.activeTerminalId);
  }
  if (activeGroupIndex < 0) {
    const usedGroupIds = new Set(terminalGroups.map((group) => group.id));
    const nextGroupId = assignUniqueGroupId(
      fallbackGroupId(normalized.activeTerminalId),
      usedGroupIds,
    );
    terminalGroups.push({ id: nextGroupId, terminalIds: [normalized.activeTerminalId] });
    activeGroupIndex = terminalGroups.length - 1;
  }

  const destinationGroup = terminalGroups[activeGroupIndex];
  if (!destinationGroup) {
    return normalized;
  }

  if (
    isNewTerminal &&
    !destinationGroup.terminalIds.includes(terminalId) &&
    destinationGroup.terminalIds.length >= MAX_TERMINALS_PER_GROUP
  ) {
    return normalized;
  }

  if (!destinationGroup.terminalIds.includes(terminalId)) {
    const anchorIndex = destinationGroup.terminalIds.indexOf(normalized.activeTerminalId);
    if (anchorIndex >= 0) {
      destinationGroup.terminalIds.splice(anchorIndex + 1, 0, terminalId);
    } else {
      destinationGroup.terminalIds.push(terminalId);
    }
  }

  return normalizeThreadTerminalState({
    ...normalized,
    terminalOpen: true,
    terminalIds,
    activeTerminalId: terminalId,
    terminalGroups,
    activeTerminalGroupId: destinationGroup.id,
  });
}

function setThreadTerminalOpen(state: ThreadTerminalState, open: boolean): ThreadTerminalState {
  const normalized = normalizeThreadTerminalState(state);
  if (normalized.terminalOpen === open) return normalized;
  return { ...normalized, terminalOpen: open };
}

function setThreadTerminalHeight(state: ThreadTerminalState, height: number): ThreadTerminalState {
  const normalized = normalizeThreadTerminalState(state);
  if (!Number.isFinite(height) || height <= 0 || normalized.terminalHeight === height) {
    return normalized;
  }
  return { ...normalized, terminalHeight: height };
}

function splitThreadTerminal(state: ThreadTerminalState, terminalId: string): ThreadTerminalState {
  return upsertTerminalIntoGroups(state, terminalId, "split");
}

function newThreadTerminal(state: ThreadTerminalState, terminalId: string): ThreadTerminalState {
  return upsertTerminalIntoGroups(state, terminalId, "new");
}

function setThreadActiveTerminal(
  state: ThreadTerminalState,
  terminalId: string,
): ThreadTerminalState {
  const normalized = normalizeThreadTerminalState(state);
  if (!normalized.terminalIds.includes(terminalId)) {
    return normalized;
  }
  const activeTerminalGroupId =
    normalized.terminalGroups.find((group) => group.terminalIds.includes(terminalId))?.id ??
    normalized.activeTerminalGroupId;
  if (
    normalized.activeTerminalId === terminalId &&
    normalized.activeTerminalGroupId === activeTerminalGroupId
  ) {
    return normalized;
  }
  return {
    ...normalized,
    activeTerminalId: terminalId,
    activeTerminalGroupId,
  };
}

function closeThreadTerminal(state: ThreadTerminalState, terminalId: string): ThreadTerminalState {
  const normalized = normalizeThreadTerminalState(state);
  if (!normalized.terminalIds.includes(terminalId)) {
    return normalized;
  }

  const remainingTerminalIds = normalized.terminalIds.filter((id) => id !== terminalId);
  if (remainingTerminalIds.length === 0) {
    return normalizeThreadTerminalState({
      ...normalized,
      terminalOpen: false,
      terminalIds: [],
      runningTerminalIds: [],
      terminalCommands: {},
      activeTerminalId: DEFAULT_THREAD_TERMINAL_ID,
      terminalGroups: [],
      activeTerminalGroupId: fallbackGroupId(DEFAULT_THREAD_TERMINAL_ID),
    });
  }

  const closedTerminalIndex = normalized.terminalIds.indexOf(terminalId);
  const nextActiveTerminalId =
    normalized.activeTerminalId === terminalId
      ? (remainingTerminalIds[Math.min(closedTerminalIndex, remainingTerminalIds.length - 1)] ??
        remainingTerminalIds[0] ??
        DEFAULT_THREAD_TERMINAL_ID)
      : normalized.activeTerminalId;

  const terminalGroups = normalized.terminalGroups
    .map((group) => ({
      ...group,
      terminalIds: group.terminalIds.filter((id) => id !== terminalId),
    }))
    .filter((group) => group.terminalIds.length > 0);

  const nextActiveTerminalGroupId =
    terminalGroups.find((group) => group.terminalIds.includes(nextActiveTerminalId))?.id ??
    terminalGroups[0]?.id ??
    fallbackGroupId(nextActiveTerminalId);

  const remainingCommands = { ...normalized.terminalCommands };
  delete remainingCommands[terminalId];
  return normalizeThreadTerminalState({
    terminalOpen: normalized.terminalOpen,
    terminalHeight: normalized.terminalHeight,
    terminalIds: remainingTerminalIds,
    runningTerminalIds: normalized.runningTerminalIds.filter((id) => id !== terminalId),
    terminalCommands: remainingCommands,
    activeTerminalId: nextActiveTerminalId,
    terminalGroups,
    activeTerminalGroupId: nextActiveTerminalGroupId,
  });
}

function setThreadTerminalCommand(
  state: ThreadTerminalState,
  terminalId: string,
  command: string | null,
): ThreadTerminalState {
  const normalized = normalizeThreadTerminalState(state);
  if (!normalized.terminalIds.includes(terminalId)) {
    return normalized;
  }
  const current = normalized.terminalCommands[terminalId];
  if (command === null || command.length === 0) {
    if (current === undefined) return normalized;
    const nextCommands = { ...normalized.terminalCommands };
    delete nextCommands[terminalId];
    return { ...normalized, terminalCommands: nextCommands };
  }
  if (current === command) return normalized;
  return {
    ...normalized,
    terminalCommands: { ...normalized.terminalCommands, [terminalId]: command },
  };
}

function setThreadTerminalActivity(
  state: ThreadTerminalState,
  terminalId: string,
  hasRunningSubprocess: boolean,
): ThreadTerminalState {
  const normalized = normalizeThreadTerminalState(state);
  if (!normalized.terminalIds.includes(terminalId)) {
    return normalized;
  }
  const alreadyRunning = normalized.runningTerminalIds.includes(terminalId);
  if (hasRunningSubprocess === alreadyRunning) {
    return normalized;
  }
  const runningTerminalIds = new Set(normalized.runningTerminalIds);
  if (hasRunningSubprocess) {
    runningTerminalIds.add(terminalId);
  } else {
    runningTerminalIds.delete(terminalId);
  }
  return { ...normalized, runningTerminalIds: [...runningTerminalIds] };
}

export function findRunningTerminalIdByCommand(
  state: ThreadTerminalState,
  command: string,
): string | null {
  const trimmed = command.trim();
  if (trimmed.length === 0) return null;
  for (const [terminalId, recorded] of Object.entries(state.terminalCommands)) {
    if (recorded === trimmed && state.runningTerminalIds.includes(terminalId)) {
      return terminalId;
    }
  }
  return null;
}

export function selectThreadTerminalState(
  terminalStateByThreadKey: Record<string, ThreadTerminalState>,
  ownerRef: TerminalOwnerRef | null | undefined,
): ThreadTerminalState {
  if (!isUsableOwnerRef(ownerRef)) {
    return getDefaultThreadTerminalState();
  }
  return terminalStateByThreadKey[terminalStateKey(ownerRef)] ?? getDefaultThreadTerminalState();
}

function updateTerminalStateByOwnerKey(
  terminalStateByThreadKey: Record<string, ThreadTerminalState>,
  ownerRef: TerminalOwnerRef,
  updater: (state: ThreadTerminalState) => ThreadTerminalState,
): Record<string, ThreadTerminalState> {
  if (!isUsableOwnerRef(ownerRef)) {
    return terminalStateByThreadKey;
  }

  const ownerKey = terminalStateKey(ownerRef);
  const current = selectThreadTerminalState(terminalStateByThreadKey, ownerRef);
  const next = updater(current);
  if (next === current) {
    return terminalStateByThreadKey;
  }

  if (isDefaultThreadTerminalState(next)) {
    if (terminalStateByThreadKey[ownerKey] === undefined) {
      return terminalStateByThreadKey;
    }
    const { [ownerKey]: _removed, ...rest } = terminalStateByThreadKey;
    return rest;
  }

  return {
    ...terminalStateByThreadKey,
    [ownerKey]: next,
  };
}

export function selectTerminalEventEntries(
  terminalEventEntriesByKey: Record<string, ReadonlyArray<TerminalEventEntry>>,
  ownerRef: TerminalOwnerRef | null | undefined,
  terminalId: string,
): ReadonlyArray<TerminalEventEntry> {
  if (!isUsableOwnerRef(ownerRef) || terminalId.trim().length === 0) {
    return EMPTY_TERMINAL_EVENT_ENTRIES;
  }
  return (
    terminalEventEntriesByKey[terminalEventBufferKey(ownerRef, terminalId)] ??
    EMPTY_TERMINAL_EVENT_ENTRIES
  );
}

interface TerminalStateStoreState {
  terminalStateByThreadKey: Record<string, ThreadTerminalState>;
  terminalLaunchContextByThreadKey: Record<string, ThreadTerminalLaunchContext>;
  terminalEventEntriesByKey: Record<string, ReadonlyArray<TerminalEventEntry>>;
  defaultTerminalScopeByProjectId: Record<string, ProjectScriptScope>;
  setDefaultTerminalScope: (projectId: ProjectId, scope: ProjectScriptScope) => void;
  nextTerminalEventId: number;
  setTerminalOpen: (ownerRef: TerminalOwnerRef, open: boolean) => void;
  setTerminalHeight: (ownerRef: TerminalOwnerRef, height: number) => void;
  splitTerminal: (ownerRef: TerminalOwnerRef, terminalId: string) => void;
  newTerminal: (ownerRef: TerminalOwnerRef, terminalId: string) => void;
  ensureTerminal: (
    ownerRef: TerminalOwnerRef,
    terminalId: string,
    options?: { open?: boolean; active?: boolean },
  ) => void;
  setActiveTerminal: (ownerRef: TerminalOwnerRef, terminalId: string) => void;
  closeTerminal: (ownerRef: TerminalOwnerRef, terminalId: string) => void;
  setTerminalCommand: (
    ownerRef: TerminalOwnerRef,
    terminalId: string,
    command: string | null,
  ) => void;
  setTerminalLaunchContext: (
    ownerRef: TerminalOwnerRef,
    context: ThreadTerminalLaunchContext,
  ) => void;
  clearTerminalLaunchContext: (ownerRef: TerminalOwnerRef) => void;
  setTerminalActivity: (
    ownerRef: TerminalOwnerRef,
    terminalId: string,
    hasRunningSubprocess: boolean,
  ) => void;
  recordTerminalEvent: (ownerRef: TerminalOwnerRef, event: TerminalEvent) => void;
  applyTerminalEvent: (ownerRef: TerminalOwnerRef, event: TerminalEvent) => void;
  clearTerminalState: (ownerRef: TerminalOwnerRef) => void;
  removeTerminalState: (ownerRef: TerminalOwnerRef) => void;
  removeOrphanedTerminalStates: (activeOwnerKeys: Set<string>) => void;
}

export const useTerminalStateStore = create<TerminalStateStoreState>()(
  persist(
    (set) => {
      const updateTerminal = (
        ownerRef: TerminalOwnerRef,
        updater: (state: ThreadTerminalState) => ThreadTerminalState,
      ) => {
        set((state) => {
          const nextTerminalStateByThreadKey = updateTerminalStateByOwnerKey(
            state.terminalStateByThreadKey,
            ownerRef,
            updater,
          );
          if (nextTerminalStateByThreadKey === state.terminalStateByThreadKey) {
            return state;
          }
          return {
            terminalStateByThreadKey: nextTerminalStateByThreadKey,
          };
        });
      };

      return {
        terminalStateByThreadKey: {},
        terminalLaunchContextByThreadKey: {},
        terminalEventEntriesByKey: {},
        defaultTerminalScopeByProjectId: {},
        setDefaultTerminalScope: (projectId, scope) =>
          set((state) => {
            if (state.defaultTerminalScopeByProjectId[projectId] === scope) return state;
            return {
              defaultTerminalScopeByProjectId: {
                ...state.defaultTerminalScopeByProjectId,
                [projectId]: scope,
              },
            };
          }),
        nextTerminalEventId: 1,
        setTerminalOpen: (ownerRef, open) =>
          updateTerminal(ownerRef, (state) => setThreadTerminalOpen(state, open)),
        setTerminalHeight: (ownerRef, height) =>
          updateTerminal(ownerRef, (state) => setThreadTerminalHeight(state, height)),
        splitTerminal: (ownerRef, terminalId) =>
          updateTerminal(ownerRef, (state) => splitThreadTerminal(state, terminalId)),
        newTerminal: (ownerRef, terminalId) =>
          updateTerminal(ownerRef, (state) => newThreadTerminal(state, terminalId)),
        ensureTerminal: (ownerRef, terminalId, options) =>
          updateTerminal(ownerRef, (state) => {
            let nextState = state;
            if (!state.terminalIds.includes(terminalId)) {
              nextState = newThreadTerminal(nextState, terminalId);
            }
            if (options?.active === false) {
              nextState = {
                ...nextState,
                activeTerminalId: state.activeTerminalId,
                activeTerminalGroupId: state.activeTerminalGroupId,
              };
            }
            if (options?.active ?? true) {
              nextState = setThreadActiveTerminal(nextState, terminalId);
            }
            if (options?.open) {
              nextState = setThreadTerminalOpen(nextState, true);
            }
            return normalizeThreadTerminalState(nextState);
          }),
        setActiveTerminal: (ownerRef, terminalId) =>
          updateTerminal(ownerRef, (state) => setThreadActiveTerminal(state, terminalId)),
        closeTerminal: (ownerRef, terminalId) =>
          updateTerminal(ownerRef, (state) => closeThreadTerminal(state, terminalId)),
        setTerminalCommand: (ownerRef, terminalId, command) =>
          updateTerminal(ownerRef, (state) => setThreadTerminalCommand(state, terminalId, command)),
        setTerminalLaunchContext: (ownerRef, context) =>
          set((state) => {
            if (!isUsableOwnerRef(ownerRef)) return state;
            return {
              terminalLaunchContextByThreadKey: {
                ...state.terminalLaunchContextByThreadKey,
                [terminalStateKey(ownerRef)]: context,
              },
            };
          }),
        clearTerminalLaunchContext: (ownerRef) =>
          set((state) => {
            if (!isUsableOwnerRef(ownerRef)) return state;
            const ownerKey = terminalStateKey(ownerRef);
            if (!state.terminalLaunchContextByThreadKey[ownerKey]) {
              return state;
            }
            const { [ownerKey]: _removed, ...rest } = state.terminalLaunchContextByThreadKey;
            return { terminalLaunchContextByThreadKey: rest };
          }),
        setTerminalActivity: (ownerRef, terminalId, hasRunningSubprocess) =>
          updateTerminal(ownerRef, (state) =>
            setThreadTerminalActivity(state, terminalId, hasRunningSubprocess),
          ),
        recordTerminalEvent: (ownerRef, event) =>
          set((state) => {
            if (!isUsableOwnerRef(ownerRef)) return state;
            return appendTerminalEventEntry(
              state.terminalEventEntriesByKey,
              state.nextTerminalEventId,
              ownerRef,
              event,
            );
          }),
        applyTerminalEvent: (ownerRef, event) =>
          set((state) => {
            if (!isUsableOwnerRef(ownerRef)) return state;
            const ownerKey = terminalStateKey(ownerRef);
            let nextTerminalStateByThreadKey = state.terminalStateByThreadKey;
            let nextTerminalLaunchContextByThreadKey = state.terminalLaunchContextByThreadKey;

            if (event.type === "started" || event.type === "restarted") {
              nextTerminalStateByThreadKey = updateTerminalStateByOwnerKey(
                nextTerminalStateByThreadKey,
                ownerRef,
                (current) => {
                  let nextState = current;
                  if (!current.terminalIds.includes(event.terminalId)) {
                    nextState = newThreadTerminal(nextState, event.terminalId);
                  }
                  nextState = setThreadActiveTerminal(nextState, event.terminalId);
                  nextState = setThreadTerminalOpen(nextState, true);
                  return normalizeThreadTerminalState(nextState);
                },
              );
              nextTerminalLaunchContextByThreadKey = {
                ...nextTerminalLaunchContextByThreadKey,
                [ownerKey]: launchContextFromStartEvent(event),
              };
            }

            const hasRunningSubprocess = terminalRunningSubprocessFromEvent(event);
            if (hasRunningSubprocess !== null) {
              nextTerminalStateByThreadKey = updateTerminalStateByOwnerKey(
                nextTerminalStateByThreadKey,
                ownerRef,
                (current) =>
                  setThreadTerminalActivity(current, event.terminalId, hasRunningSubprocess),
              );
            }

            const nextEventState = appendTerminalEventEntry(
              state.terminalEventEntriesByKey,
              state.nextTerminalEventId,
              ownerRef,
              event,
            );

            return {
              terminalStateByThreadKey: nextTerminalStateByThreadKey,
              terminalLaunchContextByThreadKey: nextTerminalLaunchContextByThreadKey,
              ...nextEventState,
            };
          }),
        clearTerminalState: (ownerRef) =>
          set((state) => {
            if (!isUsableOwnerRef(ownerRef)) return state;
            const ownerKey = terminalStateKey(ownerRef);
            const nextTerminalStateByThreadKey = updateTerminalStateByOwnerKey(
              state.terminalStateByThreadKey,
              ownerRef,
              () => createDefaultThreadTerminalState(),
            );
            const hadLaunchContext = state.terminalLaunchContextByThreadKey[ownerKey] !== undefined;
            const { [ownerKey]: _removed, ...remainingLaunchContexts } =
              state.terminalLaunchContextByThreadKey;
            const nextTerminalEventEntriesByKey = { ...state.terminalEventEntriesByKey };
            let removedEventEntries = false;
            for (const key of Object.keys(nextTerminalEventEntriesByKey)) {
              if (key.startsWith(`${ownerKey}\u0000`)) {
                delete nextTerminalEventEntriesByKey[key];
                removedEventEntries = true;
              }
            }
            if (
              nextTerminalStateByThreadKey === state.terminalStateByThreadKey &&
              !hadLaunchContext &&
              !removedEventEntries
            ) {
              return state;
            }
            return {
              terminalStateByThreadKey: nextTerminalStateByThreadKey,
              terminalLaunchContextByThreadKey: remainingLaunchContexts,
              terminalEventEntriesByKey: nextTerminalEventEntriesByKey,
            };
          }),
        removeTerminalState: (ownerRef) =>
          set((state) => {
            if (!isUsableOwnerRef(ownerRef)) return state;
            const ownerKey = terminalStateKey(ownerRef);
            const hadTerminalState = state.terminalStateByThreadKey[ownerKey] !== undefined;
            const hadLaunchContext = state.terminalLaunchContextByThreadKey[ownerKey] !== undefined;
            const nextTerminalEventEntriesByKey = { ...state.terminalEventEntriesByKey };
            let removedEventEntries = false;
            for (const key of Object.keys(nextTerminalEventEntriesByKey)) {
              if (key.startsWith(`${ownerKey}\u0000`)) {
                delete nextTerminalEventEntriesByKey[key];
                removedEventEntries = true;
              }
            }
            if (!hadTerminalState && !hadLaunchContext && !removedEventEntries) {
              return state;
            }
            const nextTerminalStateByThreadKey = { ...state.terminalStateByThreadKey };
            delete nextTerminalStateByThreadKey[ownerKey];
            const nextLaunchContexts = { ...state.terminalLaunchContextByThreadKey };
            delete nextLaunchContexts[ownerKey];
            return {
              terminalStateByThreadKey: nextTerminalStateByThreadKey,
              terminalLaunchContextByThreadKey: nextLaunchContexts,
              terminalEventEntriesByKey: nextTerminalEventEntriesByKey,
            };
          }),
        removeOrphanedTerminalStates: (activeOwnerKeys) =>
          set((state) => {
            const orphanedIds = Object.keys(state.terminalStateByThreadKey).filter(
              (key) => !activeOwnerKeys.has(key),
            );
            const orphanedLaunchContextIds = Object.keys(
              state.terminalLaunchContextByThreadKey,
            ).filter((key) => !activeOwnerKeys.has(key));
            const nextTerminalEventEntriesByKey = { ...state.terminalEventEntriesByKey };
            let removedEventEntries = false;
            for (const key of Object.keys(nextTerminalEventEntriesByKey)) {
              const [ownerKey] = key.split("\u0000");
              if (ownerKey && !activeOwnerKeys.has(ownerKey)) {
                delete nextTerminalEventEntriesByKey[key];
                removedEventEntries = true;
              }
            }
            if (
              orphanedIds.length === 0 &&
              orphanedLaunchContextIds.length === 0 &&
              !removedEventEntries
            ) {
              return state;
            }
            const next = { ...state.terminalStateByThreadKey };
            for (const id of orphanedIds) {
              delete next[id];
            }
            const nextLaunchContexts = { ...state.terminalLaunchContextByThreadKey };
            for (const id of orphanedLaunchContextIds) {
              delete nextLaunchContexts[id];
            }
            return {
              terminalStateByThreadKey: next,
              terminalLaunchContextByThreadKey: nextLaunchContexts,
              terminalEventEntriesByKey: nextTerminalEventEntriesByKey,
            };
          }),
      };
    },
    {
      name: TERMINAL_STATE_STORAGE_KEY,
      version: 4,
      storage: createJSONStorage(createTerminalStateStorage),
      migrate: migratePersistedTerminalStateStoreState,
      partialize: (state) => ({
        terminalStateByThreadKey: state.terminalStateByThreadKey,
        defaultTerminalScopeByProjectId: state.defaultTerminalScopeByProjectId,
      }),
    },
  ),
);
