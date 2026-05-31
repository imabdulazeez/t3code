import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime";
import type { EnvironmentId, VcsRef, ThreadId } from "@t3tools/contracts";
import { LegendList, type LegendListRef } from "@legendapp/list/react";
import {
  ArrowDownIcon,
  ArrowDownWideNarrowIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  DownloadCloud,
  Scissors,
  Trash2,
} from "lucide-react";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from "react";

import { useComposerDraftStore, type DraftId } from "../composerDraftStore";
import { readEnvironmentApi } from "../environmentApi";
import { useVcsStatus } from "../lib/vcsStatusState";
import { useVcsRefs, vcsRefManager } from "../lib/vcsRefState";
import { newCommandId } from "../lib/utils";
import { cn } from "../lib/utils";
import { parsePullRequestReference } from "../pullRequestReference";
import { getSourceControlPresentation } from "../sourceControlPresentation";
import { useStore } from "../store";
import { createProjectSelectorByRef, createThreadSelectorByRef } from "../storeSelectors";
import {
  deriveLocalBranchNameFromRemoteRef,
  resolveBranchSelectionTarget,
  resolveBranchToolbarValue,
  resolveDraftEnvModeAfterBranchChange,
  resolveEffectiveEnvMode,
  shouldIncludeBranchPickerItem,
} from "./BranchToolbar.logic";
import { useSettings, useUpdateSettings } from "../hooks/useSettings";
import { Group, GroupSeparator } from "./ui/group";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "./ui/menu";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { Button } from "./ui/button";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxListVirtualized,
  ComboboxPopup,
  ComboboxStatus,
  ComboboxTrigger,
} from "./ui/combobox";
import { stackedThreadToast, toastManager } from "./ui/toast";

interface BranchToolbarBranchSelectorProps {
  className?: string;
  environmentId: EnvironmentId;
  threadId: ThreadId;
  draftId?: DraftId;
  envLocked: boolean;
  effectiveEnvModeOverride?: "local" | "worktree";
  activeThreadBranchOverride?: string | null;
  onActiveThreadBranchOverrideChange?: (refName: string | null) => void;
  onCheckoutPullRequestRequest?: (reference: string) => void;
  onComposerFocusRequest?: () => void;
}

const EMPTY_REFS: ReadonlyArray<VcsRef> = [];

function toBranchActionErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "An error occurred.";
}

function isGitCommandError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "_tag" in error &&
    (error as { _tag?: unknown })._tag === "GitCommandError"
  );
}

function getBranchTriggerLabel(input: {
  activeWorktreePath: string | null;
  effectiveEnvMode: "local" | "worktree";
  resolvedActiveBranch: string | null;
}): string {
  const { activeWorktreePath, effectiveEnvMode, resolvedActiveBranch } = input;
  if (!resolvedActiveBranch) {
    return "Select branch";
  }
  if (effectiveEnvMode === "worktree" && !activeWorktreePath) {
    return `From ${resolvedActiveBranch}`;
  }
  return resolvedActiveBranch;
}

export function BranchToolbarBranchSelector({
  className,
  environmentId,
  threadId,
  draftId,
  envLocked,
  effectiveEnvModeOverride,
  activeThreadBranchOverride,
  onActiveThreadBranchOverrideChange,
  onCheckoutPullRequestRequest,
  onComposerFocusRequest,
}: BranchToolbarBranchSelectorProps) {
  // ---------------------------------------------------------------------------
  // Thread / project state (pushed down from parent to colocate with mutation)
  // ---------------------------------------------------------------------------
  const threadRef = useMemo(
    () => scopeThreadRef(environmentId, threadId),
    [environmentId, threadId],
  );
  const serverThreadSelector = useMemo(() => createThreadSelectorByRef(threadRef), [threadRef]);
  const serverThread = useStore(serverThreadSelector);
  const serverSession = serverThread?.session ?? null;
  const setThreadBranchAction = useStore((store) => store.setThreadBranch);
  const draftThread = useComposerDraftStore((store) =>
    draftId ? store.getDraftSession(draftId) : store.getDraftThreadByRef(threadRef),
  );
  const setDraftThreadContext = useComposerDraftStore((store) => store.setDraftThreadContext);

  const activeProjectRef = serverThread
    ? scopeProjectRef(serverThread.environmentId, serverThread.projectId)
    : draftThread
      ? scopeProjectRef(draftThread.environmentId, draftThread.projectId)
      : null;
  const activeProjectSelector = useMemo(
    () => createProjectSelectorByRef(activeProjectRef),
    [activeProjectRef],
  );
  const activeProject = useStore(activeProjectSelector);

  const activeThreadId = serverThread?.id ?? (draftThread ? threadId : undefined);
  const activeThreadBranch =
    activeThreadBranchOverride !== undefined
      ? activeThreadBranchOverride
      : (serverThread?.branch ?? draftThread?.branch ?? null);
  const activeWorktreePath = serverThread?.worktreePath ?? draftThread?.worktreePath ?? null;
  const activeProjectCwd = activeProject?.cwd ?? null;
  const branchCwd = activeWorktreePath ?? activeProjectCwd;
  const hasServerThread = serverThread !== undefined;
  const effectiveEnvMode =
    effectiveEnvModeOverride ??
    resolveEffectiveEnvMode({
      activeWorktreePath,
      hasServerThread,
      draftThreadEnvMode: draftThread?.envMode,
    });

  // ---------------------------------------------------------------------------
  // Thread branch mutation (colocated — only this component calls it)
  // ---------------------------------------------------------------------------
  const setThreadBranch = useCallback(
    (branch: string | null, worktreePath: string | null) => {
      if (!activeThreadId || !activeProject) return;
      const api = readEnvironmentApi(environmentId);
      if (serverSession && worktreePath !== activeWorktreePath && api) {
        void api.orchestration
          .dispatchCommand({
            type: "thread.session.stop",
            commandId: newCommandId(),
            threadId: activeThreadId,
            createdAt: new Date().toISOString(),
          })
          .catch(() => undefined);
      }
      if (api && hasServerThread) {
        void api.orchestration.dispatchCommand({
          type: "thread.meta.update",
          commandId: newCommandId(),
          threadId: activeThreadId,
          branch,
          worktreePath,
        });
      }
      if (hasServerThread) {
        onActiveThreadBranchOverrideChange?.(branch);
        setThreadBranchAction(threadRef, branch, worktreePath);
        return;
      }
      const nextDraftEnvMode = resolveDraftEnvModeAfterBranchChange({
        nextWorktreePath: worktreePath,
        currentWorktreePath: activeWorktreePath,
        effectiveEnvMode,
      });
      setDraftThreadContext(draftId ?? threadRef, {
        branch,
        worktreePath,
        envMode: nextDraftEnvMode,
        projectRef: scopeProjectRef(environmentId, activeProject.id),
      });
    },
    [
      activeThreadId,
      activeProject,
      serverSession,
      activeWorktreePath,
      hasServerThread,
      onActiveThreadBranchOverrideChange,
      setThreadBranchAction,
      setDraftThreadContext,
      draftId,
      threadRef,
      environmentId,
      effectiveEnvMode,
    ],
  );

  // ---------------------------------------------------------------------------
  // Git ref queries
  // ---------------------------------------------------------------------------
  const [isBranchMenuOpen, setIsBranchMenuOpen] = useState(false);
  const [isSortMenuOpen, setIsSortMenuOpen] = useState(false);
  const isSortMenuOpenRef = useRef(false);
  const [isRemoteSyncMenuOpen, setIsRemoteSyncMenuOpen] = useState(false);
  const isRemoteSyncMenuOpenRef = useRef(false);
  const [branchQuery, setBranchQuery] = useState("");
  const deferredBranchQuery = useDeferredValue(branchQuery);
  const deleteRemoteBranchOnDelete = useSettings((s) => s.deleteRemoteBranchOnDelete);
  const branchRemoteSyncMode = useSettings((s) => s.branchRemoteSyncMode);
  const branchSortKey = useSettings((s) => s.branchListSortKey);
  const branchSortDirection = useSettings((s) => s.branchListSortDirection);
  const { updateSettings } = useUpdateSettings();
  const [pendingDelete, setPendingDelete] = useState<VcsRef | null>(null);
  const [forceDeleteTarget, setForceDeleteTarget] = useState<VcsRef | null>(null);

  const branchStatusQuery = useVcsStatus({ environmentId, cwd: branchCwd });
  const trimmedBranchQuery = branchQuery.trim();
  const deferredTrimmedBranchQuery = deferredBranchQuery.trim();
  const branchRefTarget = useMemo(
    () => ({
      environmentId,
      cwd: branchCwd,
      query: deferredTrimmedBranchQuery,
    }),
    [branchCwd, deferredTrimmedBranchQuery, environmentId],
  );
  const branchRefState = useVcsRefs(branchRefTarget);
  const refs = branchRefState.data?.refs ?? EMPTY_REFS;
  const hasNextPage =
    branchRefState.data?.nextCursor !== null && branchRefState.data?.nextCursor !== undefined;
  const [isFetchingNextPage, setIsFetchingNextPage] = useState(false);
  const isInitialBranchesLoadPending = branchRefState.isPending && branchRefState.data === null;
  const currentGitBranch =
    branchStatusQuery.data?.refName ?? refs.find((refName) => refName.current)?.name ?? null;
  const sourceControlPresentation = useMemo(
    () => getSourceControlPresentation(branchStatusQuery.data?.sourceControlProvider),
    [branchStatusQuery.data?.sourceControlProvider],
  );
  const SourceControlIcon = sourceControlPresentation.Icon;
  const canonicalActiveBranch = resolveBranchToolbarValue({
    envMode: effectiveEnvMode,
    activeWorktreePath,
    activeThreadBranch,
    currentGitBranch,
  });
  const branchNames = useMemo(() => {
    const directionFactor = branchSortDirection === "desc" ? -1 : 1;
    const sorted = [...refs].toSorted((a, b) => {
      if (a.current !== b.current) {
        return a.current ? -1 : 1;
      }
      let comparison: number;
      if (branchSortKey === "alphabetical") {
        comparison = a.name.localeCompare(b.name);
      } else {
        comparison = (a.lastCommitAt ?? 0) - (b.lastCommitAt ?? 0);
      }
      if (comparison !== 0) {
        return comparison * directionFactor;
      }
      return a.name.localeCompare(b.name);
    });
    return sorted.map((refName) => refName.name);
  }, [refs, branchSortKey, branchSortDirection]);
  const branchByName = useMemo(
    () => new Map(refs.map((refName) => [refName.name, refName] as const)),
    [refs],
  );
  const normalizedDeferredBranchQuery = deferredTrimmedBranchQuery.toLowerCase();
  const prReference = parsePullRequestReference(trimmedBranchQuery);
  const isSelectingWorktreeBase =
    effectiveEnvMode === "worktree" && !envLocked && !activeWorktreePath;
  const checkoutPullRequestItemValue =
    prReference && onCheckoutPullRequestRequest ? `__checkout_pull_request__:${prReference}` : null;
  const canCreateBranch = !isSelectingWorktreeBase && trimmedBranchQuery.length > 0;
  const hasExactBranchMatch = branchByName.has(trimmedBranchQuery);
  const createBranchItemValue = canCreateBranch
    ? `__create_new_branch__:${trimmedBranchQuery}`
    : null;
  const branchPickerItems = useMemo(() => {
    const items = [...branchNames];
    if (createBranchItemValue && !hasExactBranchMatch) {
      items.push(createBranchItemValue);
    }
    if (checkoutPullRequestItemValue) {
      items.unshift(checkoutPullRequestItemValue);
    }
    return items;
  }, [branchNames, checkoutPullRequestItemValue, createBranchItemValue, hasExactBranchMatch]);
  const filteredBranchPickerItems = useMemo(
    () =>
      normalizedDeferredBranchQuery.length === 0
        ? branchPickerItems
        : branchPickerItems.filter((itemValue) =>
            shouldIncludeBranchPickerItem({
              itemValue,
              normalizedQuery: normalizedDeferredBranchQuery,
              createBranchItemValue,
              checkoutPullRequestItemValue,
            }),
          ),
    [
      branchPickerItems,
      checkoutPullRequestItemValue,
      createBranchItemValue,
      normalizedDeferredBranchQuery,
    ],
  );
  const [resolvedActiveBranch, setOptimisticBranch] = useOptimistic(
    canonicalActiveBranch,
    (_currentBranch: string | null, optimisticBranch: string | null) => optimisticBranch,
  );
  const [isBranchActionPending, startBranchActionTransition] = useTransition();
  const shouldVirtualizeBranchList = filteredBranchPickerItems.length > 40;
  const totalBranchCount = branchRefState.data?.totalCount ?? 0;
  const branchStatusText = isInitialBranchesLoadPending
    ? "Loading branches..."
    : isFetchingNextPage
      ? "Loading more branches..."
      : hasNextPage
        ? `Showing ${refs.length} of ${totalBranchCount} branches`
        : null;

  // ---------------------------------------------------------------------------
  // Branch actions
  // ---------------------------------------------------------------------------
  const runBranchAction = (action: () => Promise<void>) => {
    startBranchActionTransition(async () => {
      await action().catch(() => undefined);
      await vcsRefManager
        .load(branchRefTarget, undefined, { limit: 100, preserveLoadedRefs: true })
        .catch(() => undefined);
    });
  };

  const selectBranch = (refName: VcsRef) => {
    const api = readEnvironmentApi(environmentId);
    if (!api || !branchCwd || !activeProjectCwd || isBranchActionPending) return;

    if (isSelectingWorktreeBase) {
      setThreadBranch(refName.name, null);
      setIsBranchMenuOpen(false);
      onComposerFocusRequest?.();
      return;
    }

    const selectionTarget = resolveBranchSelectionTarget({
      activeProjectCwd,
      activeWorktreePath,
      refName,
    });

    if (selectionTarget.reuseExistingWorktree) {
      setThreadBranch(refName.name, selectionTarget.nextWorktreePath);
      setIsBranchMenuOpen(false);
      onComposerFocusRequest?.();
      return;
    }

    const selectedBranchName = refName.isRemote
      ? deriveLocalBranchNameFromRemoteRef(refName.name)
      : refName.name;

    setIsBranchMenuOpen(false);
    onComposerFocusRequest?.();

    runBranchAction(async () => {
      const previousBranch = resolvedActiveBranch;
      setOptimisticBranch(selectedBranchName);
      try {
        const checkoutResult = await api.vcs.switchRef({
          cwd: selectionTarget.checkoutCwd,
          refName: refName.name,
        });
        const nextBranchName = refName.isRemote
          ? (checkoutResult.refName ?? selectedBranchName)
          : selectedBranchName;
        setOptimisticBranch(nextBranchName);
        setThreadBranch(nextBranchName, selectionTarget.nextWorktreePath);
      } catch (error) {
        setOptimisticBranch(previousBranch);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to switch branch.",
            description: toBranchActionErrorMessage(error),
          }),
        );
      }
    });
  };

  const createRef = (rawName: string) => {
    const name = rawName.trim();
    const api = readEnvironmentApi(environmentId);
    if (!api || !branchCwd || !name || isBranchActionPending) return;

    setIsBranchMenuOpen(false);
    onComposerFocusRequest?.();

    runBranchAction(async () => {
      const previousBranch = resolvedActiveBranch;
      setOptimisticBranch(name);
      try {
        const createBranchResult = await api.vcs.createRef({
          cwd: branchCwd,
          refName: name,
          switchRef: true,
        });
        setOptimisticBranch(createBranchResult.refName);
        setThreadBranch(createBranchResult.refName, activeWorktreePath);
      } catch (error) {
        setOptimisticBranch(previousBranch);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to create and switch branch.",
            description: toBranchActionErrorMessage(error),
          }),
        );
      }
    });
  };

  const deleteBranch = (ref: VcsRef, force: boolean) => {
    const api = readEnvironmentApi(environmentId);
    if (!api || !branchCwd) return;

    runBranchAction(async () => {
      try {
        const result = await api.vcs.deleteBranch({
          cwd: branchCwd,
          refName: ref.name,
          isRemote: ref.isRemote,
          remoteName: ref.remoteName,
          force,
          deleteRemote: deleteRemoteBranchOnDelete,
        });
        setPendingDelete(null);
        setForceDeleteTarget(null);
        toastManager.add(
          stackedThreadToast({
            type: "success",
            title: `Deleted ref "${ref.name}".`,
            ...(result.deletedRemote ? { description: "Remote branch also deleted." } : {}),
          }),
        );
      } catch (error) {
        if (!force && isGitCommandError(error)) {
          setPendingDelete(null);
          setForceDeleteTarget(ref);
          return;
        }
        setPendingDelete(null);
        setForceDeleteTarget(null);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to delete ref.",
            description: toBranchActionErrorMessage(error),
          }),
        );
      }
    });
  };

  const runRemoteSync = (mode: "fetch" | "prune") => {
    const api = readEnvironmentApi(environmentId);
    if (!api || !branchCwd || isBranchActionPending) return;

    runBranchAction(async () => {
      try {
        await api.vcs.fetch({ cwd: branchCwd, prune: mode === "prune" });
        toastManager.add(
          stackedThreadToast({
            type: "success",
            title: mode === "prune" ? "Pruned remote-tracking branches." : "Fetched from remote.",
          }),
        );
      } catch (error) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: mode === "prune" ? "Failed to prune." : "Failed to fetch.",
            description: toBranchActionErrorMessage(error),
          }),
        );
      }
    });
  };

  useEffect(() => {
    if (
      effectiveEnvMode !== "worktree" ||
      activeWorktreePath ||
      activeThreadBranch ||
      !currentGitBranch
    ) {
      return;
    }
    setThreadBranch(currentGitBranch, null);
  }, [activeThreadBranch, activeWorktreePath, currentGitBranch, effectiveEnvMode, setThreadBranch]);

  // ---------------------------------------------------------------------------
  // Combobox / list plumbing
  // ---------------------------------------------------------------------------
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open && (isSortMenuOpenRef.current || isRemoteSyncMenuOpenRef.current)) {
        return;
      }
      setIsBranchMenuOpen(open);
      if (!open) {
        setBranchQuery("");
        return;
      }
      void vcsRefManager
        .load(branchRefTarget, undefined, { limit: 100, preserveLoadedRefs: true })
        .catch(() => undefined);
    },
    [branchRefTarget],
  );

  const branchListScrollElementRef = useRef<HTMLDivElement | null>(null);
  const fetchNextBranchPage = useCallback(() => {
    if (!hasNextPage || isFetchingNextPage) {
      return;
    }

    setIsFetchingNextPage(true);
    void vcsRefManager
      .loadNext(branchRefTarget, undefined, { limit: 100 })
      .catch(() => undefined)
      .finally(() => setIsFetchingNextPage(false));
  }, [branchRefTarget, hasNextPage, isFetchingNextPage]);
  const maybeFetchNextBranchPage = useCallback(() => {
    if (!isBranchMenuOpen || !hasNextPage || isFetchingNextPage) {
      return;
    }

    const scrollElement = branchListScrollElementRef.current;
    if (!scrollElement) {
      return;
    }

    const distanceFromBottom =
      scrollElement.scrollHeight - scrollElement.scrollTop - scrollElement.clientHeight;
    if (distanceFromBottom > 96) {
      return;
    }

    fetchNextBranchPage();
  }, [fetchNextBranchPage, hasNextPage, isBranchMenuOpen, isFetchingNextPage]);
  const branchListRef = useRef<LegendListRef | null>(null);
  const setBranchListRef = useCallback((element: HTMLDivElement | null) => {
    branchListScrollElementRef.current = (element?.parentElement as HTMLDivElement | null) ?? null;
  }, []);

  useEffect(() => {
    if (!isBranchMenuOpen) {
      return;
    }

    if (shouldVirtualizeBranchList) {
      branchListRef.current?.scrollToOffset?.({ offset: 0, animated: false });
    } else {
      branchListScrollElementRef.current?.scrollTo({ top: 0 });
    }
  }, [deferredTrimmedBranchQuery, isBranchMenuOpen, shouldVirtualizeBranchList]);

  useEffect(() => {
    const scrollElement = branchListScrollElementRef.current;
    if (!scrollElement || !isBranchMenuOpen) {
      return;
    }

    const handleScroll = () => {
      maybeFetchNextBranchPage();
    };

    scrollElement.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => {
      scrollElement.removeEventListener("scroll", handleScroll);
    };
  }, [isBranchMenuOpen, maybeFetchNextBranchPage]);

  useEffect(() => {
    if (shouldVirtualizeBranchList) return;
    maybeFetchNextBranchPage();
  }, [refs.length, maybeFetchNextBranchPage, shouldVirtualizeBranchList]);

  const triggerLabel = getBranchTriggerLabel({
    activeWorktreePath,
    effectiveEnvMode,
    resolvedActiveBranch,
  });

  function renderPickerItem(itemValue: string, index: number) {
    if (checkoutPullRequestItemValue && itemValue === checkoutPullRequestItemValue) {
      return (
        <ComboboxItem
          hideIndicator
          key={itemValue}
          index={index}
          value={itemValue}
          onClick={() => {
            if (!prReference || !onCheckoutPullRequestRequest) {
              return;
            }
            setIsBranchMenuOpen(false);
            setBranchQuery("");
            onComposerFocusRequest?.();
            onCheckoutPullRequestRequest(prReference);
          }}
        >
          <div className="flex min-w-0 items-center gap-2 py-1">
            <SourceControlIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="flex min-w-0 flex-col items-start">
              <span className="truncate font-medium">
                Checkout {sourceControlPresentation.terminology.singular}
              </span>
              <span className="truncate text-muted-foreground text-xs">{prReference}</span>
            </span>
          </div>
        </ComboboxItem>
      );
    }
    if (createBranchItemValue && itemValue === createBranchItemValue) {
      return (
        <ComboboxItem
          hideIndicator
          key={itemValue}
          index={index}
          value={itemValue}
          onClick={() => createRef(trimmedBranchQuery)}
        >
          <span className="truncate">Create new branch &quot;{trimmedBranchQuery}&quot;</span>
        </ComboboxItem>
      );
    }

    const refName = branchByName.get(itemValue);
    if (!refName) return null;

    const hasSecondaryWorktree =
      refName.worktreePath && activeProjectCwd && refName.worktreePath !== activeProjectCwd;
    const badge = refName.current
      ? "current"
      : hasSecondaryWorktree
        ? "worktree"
        : refName.isRemote
          ? "remote"
          : refName.isDefault
            ? "default"
            : null;
    return (
      <ComboboxItem
        hideIndicator
        className="group"
        key={itemValue}
        index={index}
        value={itemValue}
        onClick={() => selectBranch(refName)}
      >
        <div className="flex w-full items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate">{itemValue}</span>
            {badge && (
              <span className="shrink-0 text-[10px] text-muted-foreground/45">{badge}</span>
            )}
          </span>
          <div className="flex shrink-0 items-center gap-1.5">
            {refName.current ? (
              <span className="size-7 sm:size-6" aria-hidden />
            ) : (
              <Button
                variant="ghost"
                size="icon-xs"
                className="opacity-0 group-hover:opacity-100"
                aria-label={`Delete branch ${refName.name}`}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  event.preventDefault();
                  setForceDeleteTarget(null);
                  setPendingDelete(refName);
                }}
              >
                <Trash2 />
              </Button>
            )}
          </div>
        </div>
      </ComboboxItem>
    );
  }

  return (
    <>
      <Combobox
        items={branchPickerItems}
        filteredItems={filteredBranchPickerItems}
        autoHighlight
        virtualized={shouldVirtualizeBranchList}
        onItemHighlighted={(_value, eventDetails) => {
          if (!isBranchMenuOpen || eventDetails.index < 0 || eventDetails.reason !== "keyboard") {
            return;
          }
          branchListRef.current?.scrollIndexIntoView?.({
            index: eventDetails.index,
            animated: false,
          });
        }}
        onOpenChange={handleOpenChange}
        open={isBranchMenuOpen}
        value={resolvedActiveBranch}
      >
        <ComboboxTrigger
          render={<Button variant="ghost" size="xs" />}
          className={cn("min-w-0 text-muted-foreground/70 hover:text-foreground/80", className)}
          disabled={isInitialBranchesLoadPending || isBranchActionPending}
        >
          <span className="min-w-0 max-w-[240px] truncate">{triggerLabel}</span>
          <ChevronDownIcon className="shrink-0" />
        </ComboboxTrigger>
        <ComboboxPopup align="end" side="top" className="w-80">
          <div className="flex items-center gap-1 border-b p-1">
            <ComboboxInput
              className="[&_input]:font-sans min-w-0 flex-1 rounded-md"
              inputClassName="ring-0"
              placeholder="Search branches..."
              showTrigger={false}
              size="sm"
              value={branchQuery}
              onChange={(event) => setBranchQuery(event.target.value)}
            />
            <Group aria-label="Sort branches">
              <Menu
                highlightItemOnHover={false}
                open={isSortMenuOpen}
                onOpenChange={(open) => {
                  isSortMenuOpenRef.current = open;
                  setIsSortMenuOpen(open);
                }}
              >
                <MenuTrigger
                  render={<Button size="icon-xs" variant="outline" aria-label="Sort branches" />}
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  <ArrowDownWideNarrowIcon className="size-3" />
                </MenuTrigger>
                <MenuPopup align="end">
                  <MenuItem
                    onClick={() =>
                      updateSettings({
                        branchListSortKey: "alphabetical",
                        branchListSortDirection: "asc",
                      })
                    }
                  >
                    <span className="flex-1">Alphabetical</span>
                    {branchSortKey === "alphabetical" && (
                      <span className="ms-2 text-[10px] uppercase text-muted-foreground">
                        Active
                      </span>
                    )}
                  </MenuItem>
                  <MenuItem
                    onClick={() =>
                      updateSettings({
                        branchListSortKey: "lastCommit",
                        branchListSortDirection: "asc",
                      })
                    }
                  >
                    <span className="flex-1">Last commit</span>
                    {branchSortKey === "lastCommit" && (
                      <span className="ms-2 text-[10px] uppercase text-muted-foreground">
                        Active
                      </span>
                    )}
                  </MenuItem>
                </MenuPopup>
              </Menu>
              <GroupSeparator />
              <Button
                size="icon-xs"
                variant="outline"
                aria-label="Toggle sort direction"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() =>
                  updateSettings({
                    branchListSortDirection: branchSortDirection === "asc" ? "desc" : "asc",
                  })
                }
              >
                {branchSortDirection === "asc" ? (
                  <ArrowUpIcon className="size-3" />
                ) : (
                  <ArrowDownIcon className="size-3" />
                )}
              </Button>
            </Group>
            <Group aria-label="Sync with remote">
              <Button
                size="icon-xs"
                variant="outline"
                aria-label={branchRemoteSyncMode === "prune" ? "Prune remote" : "Fetch from remote"}
                disabled={isBranchActionPending}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => runRemoteSync(branchRemoteSyncMode)}
              >
                {branchRemoteSyncMode === "prune" ? (
                  <Scissors className="size-3" />
                ) : (
                  <DownloadCloud className="size-3" />
                )}
              </Button>
              <GroupSeparator />
              <Menu
                highlightItemOnHover={false}
                open={isRemoteSyncMenuOpen}
                onOpenChange={(open) => {
                  isRemoteSyncMenuOpenRef.current = open;
                  setIsRemoteSyncMenuOpen(open);
                }}
              >
                <MenuTrigger
                  render={
                    <Button size="icon-xs" variant="outline" aria-label="Choose remote sync mode" />
                  }
                  disabled={isBranchActionPending}
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  <ChevronDownIcon className="size-3" />
                </MenuTrigger>
                <MenuPopup align="end">
                  <MenuItem
                    onClick={() => {
                      updateSettings({ branchRemoteSyncMode: "fetch" });
                      runRemoteSync("fetch");
                    }}
                  >
                    <DownloadCloud className="size-3.5" />
                    <span className="flex-1">Fetch</span>
                    {branchRemoteSyncMode === "fetch" && (
                      <span className="ms-2 text-[10px] uppercase text-muted-foreground">
                        Active
                      </span>
                    )}
                  </MenuItem>
                  <MenuItem
                    onClick={() => {
                      updateSettings({ branchRemoteSyncMode: "prune" });
                      runRemoteSync("prune");
                    }}
                  >
                    <Scissors className="size-3.5" />
                    <span className="flex-1">Prune</span>
                    {branchRemoteSyncMode === "prune" && (
                      <span className="ms-2 text-[10px] uppercase text-muted-foreground">
                        Active
                      </span>
                    )}
                  </MenuItem>
                </MenuPopup>
              </Menu>
            </Group>
          </div>
          <ComboboxEmpty>No branches found.</ComboboxEmpty>

          {shouldVirtualizeBranchList ? (
            <ComboboxListVirtualized>
              <LegendList<string>
                ref={branchListRef}
                data={filteredBranchPickerItems}
                keyExtractor={(item) => item}
                renderItem={({ item, index }) => renderPickerItem(item, index)}
                estimatedItemSize={28}
                drawDistance={336}
                onEndReached={() => {
                  if (hasNextPage && !isFetchingNextPage) {
                    fetchNextBranchPage();
                  }
                }}
                style={{ maxHeight: "14rem" }}
              />
            </ComboboxListVirtualized>
          ) : (
            <ComboboxList ref={setBranchListRef} className="max-h-56">
              {filteredBranchPickerItems.map((itemValue, index) =>
                renderPickerItem(itemValue, index),
              )}
            </ComboboxList>
          )}
          {branchStatusText ? <ComboboxStatus>{branchStatusText}</ComboboxStatus> : null}
        </ComboboxPopup>
      </Combobox>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete branch &quot;{pendingDelete?.name}&quot;?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteRemoteBranchOnDelete
                ? "This will delete the branch locally and its remote counterpart."
                : "This will delete the branch locally."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                if (pendingDelete) deleteBranch(pendingDelete, false);
              }}
            >
              Delete
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>

      <AlertDialog
        open={forceDeleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setForceDeleteTarget(null);
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Force delete &quot;{forceDeleteTarget?.name}&quot;?</AlertDialogTitle>
            <AlertDialogDescription>
              This branch may have unmerged commits that will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                if (forceDeleteTarget) deleteBranch(forceDeleteTarget, true);
              }}
            >
              Force delete
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}
