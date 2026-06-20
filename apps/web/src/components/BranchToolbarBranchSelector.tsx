import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, VcsRef, ThreadId } from "@t3tools/contracts";
import { validateGitBranchName } from "@t3tools/shared/git";
import { LegendList, type LegendListRef } from "@legendapp/list/react";
import {
  ArrowDownIcon,
  ArrowDownWideNarrowIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  DownloadCloud,
  GitBranchIcon,
  RefreshCwIcon,
  Scissors,
  SearchIcon,
  Trash2,
} from "lucide-react";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from "react";

import { useComposerDraftStore, type DraftId } from "../composerDraftStore";
import { useOpenPrLink } from "../lib/openPullRequestLink";
import { usePaginatedBranches } from "../state/queries";
import { useProject, useThread } from "../state/entities";
import { useEnvironmentQuery } from "../state/query";
import { threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { vcsEnvironment } from "../state/vcs";
import { cn } from "../lib/utils";
import { parsePullRequestReference } from "../pullRequestReference";
import { getSourceControlPresentation } from "../sourceControlPresentation";
import {
  deriveLocalBranchNameFromRemoteRef,
  resolveBranchSelectionTarget,
  resolveBranchToolbarValue,
  resolveDraftEnvModeAfterBranchChange,
  resolveEffectiveEnvMode,
  shouldIncludeBranchPickerItem,
} from "./BranchToolbar.logic";
import {
  ChangeRequestStatusIcon,
  prStatusIndicator,
  resolveThreadPr,
} from "./ThreadStatusIndicators";
import { useClientSettings, useUpdateClientSettings } from "../hooks/useSettings";
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
import { Group, GroupSeparator } from "./ui/group";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "./ui/menu";
import { Switch } from "./ui/switch";
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
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

interface BranchToolbarBranchSelectorProps {
  className?: string;
  environmentId: EnvironmentId;
  threadId: ThreadId;
  draftId?: DraftId;
  envLocked: boolean;
  effectiveEnvModeOverride?: "local" | "worktree";
  activeThreadBranchOverride?: string | null;
  onActiveThreadBranchOverrideChange?: (refName: string | null) => void;
  startFromOrigin: boolean;
  onStartFromOriginChange: (startFromOrigin: boolean) => void;
  onCheckoutPullRequestRequest?: (reference: string) => void;
  onComposerFocusRequest?: () => void;
}

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
  startFromOrigin,
  onStartFromOriginChange,
  onCheckoutPullRequestRequest,
  onComposerFocusRequest,
}: BranchToolbarBranchSelectorProps) {
  const startFromOriginSwitchId = useId();
  const stopThreadSession = useAtomCommand(threadEnvironment.stopSession, "thread session stop");
  const updateThreadMetadata = useAtomCommand(
    threadEnvironment.updateMetadata,
    "thread metadata update",
  );
  const switchRef = useAtomCommand(vcsEnvironment.switchRef, {
    reportFailure: false,
  });
  const createRefMutation = useAtomCommand(vcsEnvironment.createRef, {
    reportFailure: false,
  });
  const deleteBranchMutation = useAtomCommand(vcsEnvironment.deleteBranch, {
    reportFailure: false,
  });
  const fetchMutation = useAtomCommand(vcsEnvironment.fetch, {
    reportFailure: false,
  });
  // ---------------------------------------------------------------------------
  // Thread / project state (pushed down from parent to colocate with mutation)
  // ---------------------------------------------------------------------------
  const threadRef = useMemo(
    () => scopeThreadRef(environmentId, threadId),
    [environmentId, threadId],
  );
  const serverThread = useThread(threadRef);
  const serverSession = serverThread?.session ?? null;
  const draftThread = useComposerDraftStore((store) =>
    draftId ? store.getDraftSession(draftId) : store.getDraftThreadByRef(threadRef),
  );
  const setDraftThreadContext = useComposerDraftStore((store) => store.setDraftThreadContext);

  const activeProjectRef = serverThread
    ? scopeProjectRef(serverThread.environmentId, serverThread.projectId)
    : draftThread
      ? scopeProjectRef(draftThread.environmentId, draftThread.projectId)
      : null;
  const activeProject = useProject(activeProjectRef);

  const activeThreadId = serverThread?.id ?? (draftThread ? threadId : undefined);
  const activeThreadBranch =
    activeThreadBranchOverride !== undefined
      ? activeThreadBranchOverride
      : (serverThread?.branch ?? draftThread?.branch ?? null);
  const activeWorktreePath = serverThread?.worktreePath ?? draftThread?.worktreePath ?? null;
  const activeProjectCwd = activeProject?.workspaceRoot ?? null;
  const branchCwd = activeWorktreePath ?? activeProjectCwd;
  const hasServerThread = serverThread !== null;
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
      if (serverSession && worktreePath !== activeWorktreePath) {
        void stopThreadSession({
          environmentId,
          input: { threadId: activeThreadId },
        });
      }
      if (hasServerThread) {
        void updateThreadMetadata({
          environmentId,
          input: {
            threadId: activeThreadId,
            branch,
            worktreePath,
          },
        });
      }
      if (hasServerThread) {
        onActiveThreadBranchOverrideChange?.(branch);
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
      setDraftThreadContext,
      draftId,
      threadRef,
      environmentId,
      effectiveEnvMode,
      stopThreadSession,
      updateThreadMetadata,
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
  const deleteRemoteBranchOnDelete = useClientSettings((s) => s.deleteRemoteBranchOnDelete);
  const branchRemoteSyncMode = useClientSettings((s) => s.branchRemoteSyncMode);
  const branchSortKey = useClientSettings((s) => s.branchListSortKey);
  const branchSortDirection = useClientSettings((s) => s.branchListSortDirection);
  const updateClientSettings = useUpdateClientSettings();
  const [pendingDelete, setPendingDelete] = useState<VcsRef | null>(null);
  const [forceDeleteTarget, setForceDeleteTarget] = useState<VcsRef | null>(null);

  const branchStatusQuery = useEnvironmentQuery(
    branchCwd === null
      ? null
      : vcsEnvironment.status({
          environmentId,
          input: { cwd: branchCwd },
        }),
  );
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
  const branchRefState = usePaginatedBranches(branchRefTarget);
  const refs = branchRefState.refs;
  const hasNextPage =
    branchRefState.data?.nextCursor !== null && branchRefState.data?.nextCursor !== undefined;
  const isFetchingNextPage = branchRefState.isPending && branchRefState.data !== null;
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
  const createBranchNameError = canCreateBranch ? validateGitBranchName(trimmedBranchQuery) : null;
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
      await action();
      branchRefState.refresh();
      branchStatusQuery.refresh();
    });
  };

  const selectBranch = (refName: VcsRef) => {
    if (!branchCwd || !activeProjectCwd || isBranchActionPending) return;

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
      const checkoutResult = await switchRef({
        environmentId,
        input: {
          cwd: selectionTarget.checkoutCwd,
          refName: refName.name,
        },
      });
      if (checkoutResult._tag === "Success") {
        const nextBranchName = refName.isRemote
          ? (checkoutResult.value.refName ?? selectedBranchName)
          : selectedBranchName;
        setOptimisticBranch(nextBranchName);
        setThreadBranch(nextBranchName, selectionTarget.nextWorktreePath);
        return;
      }
      setOptimisticBranch(previousBranch);
      if (!isAtomCommandInterrupted(checkoutResult)) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to switch branch.",
            description: toBranchActionErrorMessage(squashAtomCommandFailure(checkoutResult)),
          }),
        );
      }
    });
  };

  const createRef = (rawName: string) => {
    const name = rawName.trim();
    if (!branchCwd || !name || isBranchActionPending) return;

    const validationError = validateGitBranchName(name);
    if (validationError) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Invalid branch name.",
          description: validationError,
        }),
      );
      return;
    }

    setIsBranchMenuOpen(false);
    onComposerFocusRequest?.();

    runBranchAction(async () => {
      const previousBranch = resolvedActiveBranch;
      setOptimisticBranch(name);
      const createBranchResult = await createRefMutation({
        environmentId,
        input: {
          cwd: branchCwd,
          refName: name,
          switchRef: true,
        },
      });
      if (createBranchResult._tag === "Success") {
        setOptimisticBranch(createBranchResult.value.refName);
        setThreadBranch(createBranchResult.value.refName, activeWorktreePath);
        return;
      }
      setOptimisticBranch(previousBranch);
      if (!isAtomCommandInterrupted(createBranchResult)) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to create and switch branch.",
            description: toBranchActionErrorMessage(squashAtomCommandFailure(createBranchResult)),
          }),
        );
      }
    });
  };

  const deleteBranch = (ref: VcsRef, force: boolean) => {
    if (!branchCwd) return;

    setPendingDelete(null);
    setForceDeleteTarget(null);

    const toastId = toastManager.add({
      type: "loading",
      title: `Deleting branch "${ref.name}"...`,
      timeout: 0,
    });

    runBranchAction(async () => {
      const deleteResult = await deleteBranchMutation({
        environmentId,
        input: {
          cwd: branchCwd,
          refName: ref.name,
          ...(ref.isRemote === undefined ? {} : { isRemote: ref.isRemote }),
          ...(ref.remoteName === undefined ? {} : { remoteName: ref.remoteName }),
          force,
          deleteRemote: deleteRemoteBranchOnDelete,
        },
      });
      if (deleteResult._tag === "Success") {
        const result = deleteResult.value;
        if (ref.isRemote || result.deletedRemote) {
          await fetchMutation({
            environmentId,
            input: { cwd: branchCwd, prune: true },
          }).catch(() => undefined);
        }
        toastManager.update(
          toastId,
          stackedThreadToast({
            type: "success",
            title: `Deleted branch "${ref.name}".`,
            ...(result.deletedRemote ? { description: "Remote branch also deleted." } : {}),
          }),
        );
        return;
      }
      if (isAtomCommandInterrupted(deleteResult)) {
        toastManager.close(toastId);
        return;
      }
      const error = squashAtomCommandFailure(deleteResult);
      if (!force && isGitCommandError(error)) {
        toastManager.close(toastId);
        setForceDeleteTarget(ref);
        return;
      }
      toastManager.update(
        toastId,
        stackedThreadToast({
          type: "error",
          title: "Failed to delete branch.",
          description: toBranchActionErrorMessage(error),
        }),
      );
    });
  };

  const runRemoteSync = (mode: "fetch" | "prune") => {
    if (!branchCwd || isBranchActionPending) return;

    runBranchAction(async () => {
      const fetchResult = await fetchMutation({
        environmentId,
        input: { cwd: branchCwd, prune: mode === "prune" },
      });
      if (fetchResult._tag === "Success") {
        toastManager.add(
          stackedThreadToast({
            type: "success",
            title: mode === "prune" ? "Pruned remote-tracking branches." : "Fetched from remote.",
          }),
        );
        return;
      }
      if (isAtomCommandInterrupted(fetchResult)) {
        return;
      }
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: mode === "prune" ? "Failed to prune." : "Failed to fetch.",
          description: toBranchActionErrorMessage(squashAtomCommandFailure(fetchResult)),
        }),
      );
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
      branchRefState.refresh();
    },
    [branchRefState.refresh],
  );

  const branchListScrollElementRef = useRef<HTMLElement | null>(null);
  const [showTopBranchScrollFade, setShowTopBranchScrollFade] = useState(false);
  const [showBottomBranchScrollFade, setShowBottomBranchScrollFade] = useState(false);
  const fetchNextBranchPage = useCallback(() => {
    if (!hasNextPage || isFetchingNextPage) {
      return;
    }

    branchRefState.loadNext();
  }, [branchRefState.loadNext, hasNextPage, isFetchingNextPage]);
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
  const updateBranchListScrollFades = useCallback(() => {
    const scrollElement = branchListRef.current?.getScrollableNode?.();
    if (!(scrollElement instanceof HTMLElement)) {
      return;
    }
    branchListScrollElementRef.current = scrollElement;
    const maxScrollOffset = Math.max(0, scrollElement.scrollHeight - scrollElement.clientHeight);
    setShowTopBranchScrollFade(scrollElement.scrollTop > 1);
    setShowBottomBranchScrollFade(maxScrollOffset - scrollElement.scrollTop > 1);
  }, []);
  const setBranchListRef = useCallback((element: HTMLDivElement | null) => {
    branchListScrollElementRef.current = (element?.parentElement as HTMLDivElement | null) ?? null;
  }, []);

  useLayoutEffect(() => {
    if (!isBranchMenuOpen) {
      return;
    }

    setShowTopBranchScrollFade(false);
    setShowBottomBranchScrollFade(filteredBranchPickerItems.length > 8);
    let nestedFrame = 0;
    const frame = requestAnimationFrame(() => {
      updateBranchListScrollFades();
      nestedFrame = requestAnimationFrame(updateBranchListScrollFades);
    });
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(nestedFrame);
    };
  }, [
    deferredTrimmedBranchQuery,
    filteredBranchPickerItems.length,
    isBranchMenuOpen,
    updateBranchListScrollFades,
  ]);

  useEffect(() => {
    if (!isBranchMenuOpen) {
      return;
    }

    branchListRef.current?.scrollToOffset?.({ offset: 0, animated: false });
  }, [deferredTrimmedBranchQuery, isBranchMenuOpen]);

  useEffect(() => {
    maybeFetchNextBranchPage();
  }, [refs.length, maybeFetchNextBranchPage]);

  const triggerLabel = getBranchTriggerLabel({
    activeWorktreePath,
    effectiveEnvMode,
    resolvedActiveBranch,
  });

  // PR pill shown next to the branch selector when the active branch has one.
  const branchPr = resolveThreadPr(resolvedActiveBranch, branchStatusQuery.data ?? null);
  const branchPrStatus = prStatusIndicator(branchPr, branchStatusQuery.data?.sourceControlProvider);
  // Action-oriented tooltip (the pill opens the PR), distinct from the sidebar's
  // state-description tooltip.
  const branchPrTooltip = branchPr
    ? `Open ${sourceControlPresentation.terminology.singular} #${branchPr.number} (${branchPr.state}) in browser`
    : "";
  const openPrLink = useOpenPrLink();

  function renderPickerItem(itemValue: string, index: number) {
    if (checkoutPullRequestItemValue && itemValue === checkoutPullRequestItemValue) {
      return (
        <ComboboxItem
          hideIndicator
          key={itemValue}
          index={index}
          value={itemValue}
          className="pe-2"
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
          className="pe-1.5"
          onClick={() => createRef(trimmedBranchQuery)}
        >
          <span className="flex min-w-0 flex-col items-start">
            <span className="truncate">Create new branch &quot;{trimmedBranchQuery}&quot;</span>
            {createBranchNameError ? (
              <span className="truncate text-destructive text-xs">{createBranchNameError}</span>
            ) : null}
          </span>
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
        className="group pe-1.5"
        key={itemValue}
        index={index}
        value={itemValue}
        onClick={() => selectBranch(refName)}
      >
        <div className="flex w-full min-w-0 items-center justify-between gap-2">
          <span className="flex min-w-0 flex-1 items-center gap-2">
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
        <div className={cn("flex min-w-0 items-center gap-1", className)}>
          {branchPr && branchPrStatus ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label={branchPrTooltip}
                    onClick={(event) => openPrLink(event, branchPrStatus.url)}
                    className={cn(
                      "inline-flex shrink-0 items-center gap-0.5 rounded px-1 py-0.5 text-[11px] font-medium tabular-nums transition-colors hover:bg-muted/60",
                      branchPrStatus.colorClass,
                    )}
                  />
                }
              >
                <ChangeRequestStatusIcon className="size-3" />
                <span>#{branchPr.number}</span>
              </TooltipTrigger>
              <TooltipPopup side="top">{branchPrTooltip}</TooltipPopup>
            </Tooltip>
          ) : null}
          <ComboboxTrigger
            render={<Button variant="ghost" size="xs" />}
            className="min-w-0 text-muted-foreground/70 hover:text-foreground/80"
            disabled={isInitialBranchesLoadPending || isBranchActionPending}
          >
            <GitBranchIcon className="size-3 shrink-0 opacity-70" />
            <span className="min-w-0 max-w-[240px] truncate">{triggerLabel}</span>
            <ChevronDownIcon className="size-3 shrink-0 opacity-50" />
          </ComboboxTrigger>
        </div>
        <ComboboxPopup align="end" side="top" className="flex w-80 flex-col">
          <div className="flex shrink-0 items-center gap-1 px-3 pt-2.5 pb-1.5">
            <div className="relative -translate-y-px min-w-0 flex-1 border-b border-border/70 pb-1.5 transition-colors focus-within:border-ring">
              <SearchIcon
                aria-hidden="true"
                className="pointer-events-none absolute top-1.5 left-0 size-4 shrink-0 text-muted-foreground/55"
              />
              <ComboboxInput
                className="[&_input]:h-6.5 [&_input]:ps-5 [&_input]:font-sans [&_input]:leading-6.5"
                inputClassName="rounded-none bg-transparent text-sm"
                placeholder="Search refs..."
                showTrigger={false}
                size="sm"
                unstyled
                value={branchQuery}
                onChange={(event) => setBranchQuery(event.target.value)}
              />
            </div>
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
                      updateClientSettings({
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
                      updateClientSettings({
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
                  updateClientSettings({
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
                      updateClientSettings({ branchRemoteSyncMode: "fetch" });
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
                      updateClientSettings({ branchRemoteSyncMode: "prune" });
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
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <ComboboxEmpty>No refs found.</ComboboxEmpty>
            {shouldVirtualizeBranchList ? (
              <div className="relative min-h-0 w-full max-h-56 flex-1 overflow-hidden">
                <ComboboxListVirtualized className="size-full min-w-0 p-0">
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
                    onLayout={() => {
                      updateBranchListScrollFades();
                      maybeFetchNextBranchPage();
                    }}
                    onScroll={() => {
                      updateBranchListScrollFades();
                      maybeFetchNextBranchPage();
                    }}
                    className={cn(
                      "scrollbar-gutter-stable overflow-x-hidden overscroll-y-contain ps-1 pe-0 pt-2 pb-1 [--fade-size:1.5rem]",
                      showTopBranchScrollFade && "mask-t-from-[calc(100%-var(--fade-size))]",
                      showBottomBranchScrollFade && "mask-b-from-[calc(100%-var(--fade-size))]",
                    )}
                    style={{ maxHeight: "14rem" }}
                  />
                </ComboboxListVirtualized>
              </div>
            ) : (
              <ComboboxList ref={setBranchListRef} className="max-h-56">
                {filteredBranchPickerItems.map((itemValue, index) =>
                  renderPickerItem(itemValue, index),
                )}
              </ComboboxList>
            )}
            {isSelectingWorktreeBase ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <label
                      htmlFor={startFromOriginSwitchId}
                      className="flex cursor-pointer items-center justify-between gap-3 border-t border-border/60 px-3 py-2 text-xs"
                    >
                      <span className="flex min-w-0 items-center gap-1.5 font-medium text-muted-foreground">
                        <RefreshCwIcon aria-hidden="true" className="size-3 shrink-0 opacity-70" />
                        <span className="truncate">Start from origin</span>
                      </span>
                      <Switch
                        id={startFromOriginSwitchId}
                        checked={startFromOrigin}
                        className="[--thumb-size:--spacing(3.5)]"
                        aria-label="Start worktree from origin"
                        onCheckedChange={(checked) => onStartFromOriginChange(Boolean(checked))}
                      />
                    </label>
                  }
                />
                <TooltipPopup side="top" className="max-w-72 whitespace-normal leading-tight">
                  Creates the worktree from the latest matching branch on origin instead of your
                  local branch.
                </TooltipPopup>
              </Tooltip>
            ) : null}
            {branchStatusText ? <ComboboxStatus>{branchStatusText}</ComboboxStatus> : null}
          </div>
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
