import { ThreadDetailsControl } from "./chat/ThreadDetailsControl";
import { ComposerContextLabel } from "./ComposerContextLabel";
import { useSupportsMultiplePullRequests } from "~/hooks/useSupportsMultiplePullRequests";
import { resolveThreadCurrentPullRequestLink } from "@t3tools/shared/threadPullRequests";
import { useRightPanelStore } from "../rightPanelStore";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { ContextMenuItem, EnvironmentId, VcsRef, ThreadId } from "@t3tools/contracts";
import { validateGitBranchName } from "@t3tools/shared/git";
import {
  ArrowDownIcon,
  ArrowDownWideNarrowIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  DownloadCloud,
  GitBranchIcon,
  Scissors,
  Trash2,
} from "lucide-react";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useImperativeHandle,
  useMemo,
  useOptimistic,
  useRef,
  useState,
  useTransition,
  type MouseEvent as ReactMouseEvent,
  type Ref,
} from "react";

import { useComposerDraftStore, type DraftId } from "../composerDraftStore";
import { writeTextToClipboard } from "../hooks/useCopyToClipboard";
import { readLocalApi } from "../localApi";
import { useOpenPrLink } from "../lib/openPullRequestLink";
import { usePaginatedBranches } from "../state/queries";
import { useProject, useThreadShell } from "../state/entities";
import { useEnvironmentQuery } from "../state/query";
import { threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { vcsEnvironment } from "../state/vcs";
import { cn } from "../lib/utils";
import {
  THREAD_DETAILS_PANEL_CHEVRON_CLASS,
  THREAD_DETAILS_PANEL_ICON_CLASS,
} from "./chat/threadDetailsPanelStyles";
import { ThreadDetailsPrRows } from "./chat/ThreadDetailsPrRows";
import { parsePullRequestReference } from "../pullRequestReference";
import { getSourceControlPresentation } from "../sourceControlPresentation";
import { formatWorktreePathForDisplay } from "../worktreeCleanup";
import { useComposerMenuProps } from "./chat/composerEventScope";
import {
  deriveLocalBranchNameFromRemoteRef,
  resolveBranchTriggerLabel,
  resolveBranchToolbarPrBranch,
  resolveBranchSelectionTarget,
  resolveBranchToolbarValue,
  resolveDraftEnvModeAfterBranchChange,
  resolveEffectiveEnvMode,
  sanitizeNewRefName,
  shouldIncludeBranchPickerItem,
} from "./BranchToolbar.logic";
import {
  ThreadPullRequestBadgeControl,
  prStatusIndicator,
  resolveThreadPullRequestBadge,
  useLinkedThreadPullRequest,
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
import { ComboboxItem, ComboboxTrigger } from "./ui/combobox";
import { ComposerControl } from "./chat/ComposerControl";
import { Group, GroupSeparator } from "./ui/group";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "./ui/menu";
import { MiddleTruncate } from "./ui/middle-truncate";
import { BranchPicker, BranchPickerRefItem } from "./BranchPicker";
import { stackedThreadToast, toastManager } from "./ui/toast";

export interface BranchToolbarBranchSelectorHandle {
  open: () => void;
}

interface BranchToolbarBranchSelectorProps {
  forceNewWorktree?: boolean;
  ref?: Ref<BranchToolbarBranchSelectorHandle>;
  className?: string;
  displayMode?: "toolbar" | "panel";
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

const WORKTREE_REMOVE_OPERATION = "GitVcsDriver.deleteBranch.removeWorktree";

function failedRemovingWorktree(error: unknown): boolean {
  return (
    isGitCommandError(error) &&
    (error as { operation?: unknown }).operation === WORKTREE_REMOVE_OPERATION
  );
}

export function BranchToolbarBranchSelector({
  forceNewWorktree = false,
  ref,
  className,
  displayMode = "toolbar",
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
  const composerFloatingLayerProps = useComposerMenuProps();
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
  const serverThread = useThreadShell(threadRef);
  const serverSession = serverThread?.runtime ?? null;
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
  const activeWorktreePath = forceNewWorktree
    ? null
    : (serverThread?.worktreePath ?? draftThread?.worktreePath ?? null);
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
    (branch: string | null, worktreePath: string | null, automatic = false) => {
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
        environmentSelection: automatic ? (draftThread?.environmentSelection ?? "auto") : "manual",
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
      draftThread?.environmentSelection,
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
  const [forceWorktreeTarget, setForceWorktreeTarget] = useState<VcsRef | null>(null);

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
  // The server filters refs by substring, so it has to be given the sanitized
  // name as well: querying the raw "new branch" drops an existing new-branch
  // from the response entirely, which would defeat the collision check below.
  // Ref names cannot contain an ASCII space, so sanitizing loses no matches.
  const branchRefQuery = sanitizeNewRefName(deferredTrimmedBranchQuery);
  const branchRefState = usePaginatedBranches({
    environmentId,
    cwd: branchCwd,
    query: branchRefQuery,
  });
  const refs = branchRefState.refs;
  const hasNextPage =
    branchRefState.data?.nextCursor !== null && branchRefState.data?.nextCursor !== undefined;
  const isFetchingNextPage = branchRefState.isFetchingNextPage;
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
  // The branch is created under its sanitized name, so both the collision check
  // and the validation have to use that name. Matching on the raw query would
  // offer to create a branch that already exists, and validating it would
  // reject a name sanitizing has already made legal.
  const newRefName = sanitizeNewRefName(trimmedBranchQuery);
  const createBranchNameError = canCreateBranch ? validateGitBranchName(newRefName) : null;
  const hasExactBranchMatch = branchByName.has(newRefName);
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
  const listedActiveBranch =
    resolvedActiveBranch === null ? null : (branchByName.get(resolvedActiveBranch) ?? null);
  const activeBranchRefQuery = useEnvironmentQuery(
    branchCwd !== null && resolvedActiveBranch !== null
      ? vcsEnvironment.listRefs({
          environmentId,
          input: {
            cwd: branchCwd,
            query: resolvedActiveBranch,
            limit: 10,
          },
        })
      : null,
  );
  const queriedActiveBranch = activeBranchRefQuery.data?.refs.find(
    (refName) => refName.name === resolvedActiveBranch,
  );
  const resolvedActiveBranchIsRemote =
    listedActiveBranch !== null
      ? listedActiveBranch.isRemote === true
      : queriedActiveBranch
        ? queriedActiveBranch.isRemote === true
        : null;
  const [isBranchActionPending, startBranchActionTransition] = useTransition();
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
  const copyBranchName = useCallback((branchName: string) => {
    void writeTextToClipboard(branchName, "branch name").then(
      (didCopy) => {
        if (!didCopy) return;
        toastManager.add({
          type: "success",
          title: "Branch name copied",
          description: branchName,
        });
      },
      (error: unknown) => {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to copy branch name",
            description: toBranchActionErrorMessage(error),
          }),
        );
      },
    );
  }, []);

  const handleBranchContextMenu = useCallback(
    (event: ReactMouseEvent, branchName: string | null) => {
      if (!branchName) return;
      const api = readLocalApi();
      if (!api) return;
      event.preventDefault();
      event.stopPropagation();
      const items: ContextMenuItem<"copy-branch-name">[] = [
        { id: "copy-branch-name", label: "Copy branch name", icon: "copy" },
      ];
      void api.contextMenu.show(items, { x: event.clientX, y: event.clientY }).then((action) => {
        if (action === "copy-branch-name") copyBranchName(branchName);
      });
    },
    [copyBranchName],
  );

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
    const name = sanitizeNewRefName(rawName);
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

  const deleteBranch = (
    ref: VcsRef,
    options: { force: boolean; forceRemoveWorktree?: boolean },
  ) => {
    if (!branchCwd) return;

    const { force, forceRemoveWorktree = false } = options;
    setPendingDelete(null);
    setForceDeleteTarget(null);
    setForceWorktreeTarget(null);

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
          removeWorktree: ref.worktreePath !== null,
          forceRemoveWorktree,
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
        const notes = [
          result.deletedRemote ? "Remote branch also deleted." : null,
          result.removedWorktreePath
            ? `Removed worktree ${formatWorktreePathForDisplay(result.removedWorktreePath)}.`
            : null,
        ].filter((note) => note !== null);
        toastManager.update(
          toastId,
          stackedThreadToast({
            type: "success",
            title: `Deleted branch "${ref.name}".`,
            ...(notes.length > 0 ? { description: notes.join(" ") } : {}),
          }),
        );
        return;
      }
      if (isAtomCommandInterrupted(deleteResult)) {
        toastManager.close(toastId);
        return;
      }
      const error = squashAtomCommandFailure(deleteResult);
      if (failedRemovingWorktree(error)) {
        if (!forceRemoveWorktree) {
          toastManager.close(toastId);
          setForceWorktreeTarget(ref);
          return;
        }
      } else if (!force && isGitCommandError(error)) {
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

  // Default the worktree base to the repo default branch (origin/HEAD), only
  // falling back to the checked-out branch when no default is known.
  const defaultBranchName = useMemo(
    () => refs.find((refName) => refName.isDefault)?.name ?? null,
    [refs],
  );
  const worktreeBaseBranchCandidate = isInitialBranchesLoadPending
    ? null
    : (defaultBranchName ?? currentGitBranch);

  useEffect(() => {
    if (
      effectiveEnvMode !== "worktree" ||
      activeWorktreePath ||
      activeThreadBranch ||
      !worktreeBaseBranchCandidate
    ) {
      return;
    }
    setThreadBranch(worktreeBaseBranchCandidate, null, true);
  }, [
    activeThreadBranch,
    activeWorktreePath,
    effectiveEnvMode,
    setThreadBranch,
    worktreeBaseBranchCandidate,
  ]);

  // ---------------------------------------------------------------------------
  // Combobox / list plumbing
  // ---------------------------------------------------------------------------
  const handleOpenChange = useCallback((open: boolean) => {
    if (!open && (isSortMenuOpenRef.current || isRemoteSyncMenuOpenRef.current)) {
      return;
    }
    setIsBranchMenuOpen(open);
    if (!open) {
      setBranchQuery("");
    }
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      open: () => {
        if (isInitialBranchesLoadPending || isBranchActionPending) return;
        handleOpenChange(true);
      },
    }),
    [handleOpenChange, isBranchActionPending, isInitialBranchesLoadPending],
  );

  const triggerLabel = resolveBranchTriggerLabel({
    activeWorktreePath,
    effectiveEnvMode,
    resolvedActiveBranch,
    resolvedActiveBranchIsRemote,
    startFromOrigin,
  });

  // Branch status is the fallback when this thread has no linked pull requests.
  const branchPrBranch = resolveBranchToolbarPrBranch({
    activeThreadBranch,
    resolvedActiveBranch,
  });
  const branchPr =
    branchPrBranch !== null && branchStatusQuery.data?.refName === branchPrBranch
      ? (branchStatusQuery.data.pr ?? null)
      : null;
  const supportsMultiplePullRequests = useSupportsMultiplePullRequests(environmentId);
  const linkedStatus = useLinkedThreadPullRequest(
    environmentId,
    serverThread?.linkedPullRequest,
    true,
    serverThread?.pullRequests,
    serverThread?.branchPullRequest,
  );
  const currentLinkedPr = supportsMultiplePullRequests
    ? resolveThreadCurrentPullRequestLink(serverThread?.pullRequests ?? [])
    : null;
  const prBadge = supportsMultiplePullRequests
    ? resolveThreadPullRequestBadge(serverThread?.pullRequests)
    : null;
  const displayedPr = linkedStatus?.pr ?? (currentLinkedPr === null ? branchPr : null);
  const displayedPrStatus = prStatusIndicator(
    displayedPr,
    linkedStatus?.sourceControlProvider ?? branchStatusQuery.data?.sourceControlProvider,
  );
  const prNumber = currentLinkedPr?.number ?? displayedPr?.number;
  const prUrl = currentLinkedPr?.url ?? displayedPr?.url;
  const openPrLink = useOpenPrLink(threadRef);
  const panelPrLabel =
    prNumber === undefined
      ? ""
      : `#${prNumber}${displayedPr?.title.trim() ? `: ${displayedPr.title}` : ""}`;

  function selectPickerItem(itemValue: string) {
    if (itemValue === checkoutPullRequestItemValue && prReference && onCheckoutPullRequestRequest) {
      handleOpenChange(false);
      onComposerFocusRequest?.();
      onCheckoutPullRequestRequest(prReference);
    } else if (itemValue === createBranchItemValue) {
      createRef(trimmedBranchQuery);
    } else {
      const refName = branchByName.get(itemValue);
      if (refName) selectBranch(refName);
    }
  }

  function renderPickerItem(itemValue: string, index: number) {
    if (checkoutPullRequestItemValue && itemValue === checkoutPullRequestItemValue) {
      return (
        <ComboboxItem
          hideIndicator
          key={itemValue}
          index={index}
          value={itemValue}
          onClick={() => selectPickerItem(itemValue)}
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
          onClick={() => selectPickerItem(itemValue)}
        >
          <span className="flex min-w-0 flex-col items-start">
            <span className="truncate">Create new branch &quot;{newRefName}&quot;</span>
            {createBranchNameError ? (
              <span className="truncate text-destructive text-xs">{createBranchNameError}</span>
            ) : null}
          </span>
        </ComboboxItem>
      );
    }

    const refName = branchByName.get(itemValue);
    if (!refName) return null;

    return (
      <BranchPickerRefItem
        branch={refName}
        projectCwd={activeProjectCwd}
        index={index}
        value={itemValue}
        onClick={() => selectPickerItem(itemValue)}
        onContextMenu={(event) => handleBranchContextMenu(event, itemValue)}
        actions={
          refName.current ? (
            <span className="size-7 sm:size-6" aria-hidden />
          ) : (
            <span className="flex opacity-0 group-hover:opacity-100">
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Delete branch ${refName.name}`}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  event.preventDefault();
                  setIsBranchMenuOpen(false);
                  setForceDeleteTarget(null);
                  setPendingDelete(refName);
                }}
              >
                <Trash2 />
              </Button>
            </span>
          )
        }
      />
    );
  }

  return (
    <>
      <BranchPicker
        items={branchPickerItems}
        filteredItems={filteredBranchPickerItems}
        open={isBranchMenuOpen}
        onOpenChange={handleOpenChange}
        onSelectItem={selectPickerItem}
        value={resolvedActiveBranch}
        query={branchQuery}
        resultsQuery={deferredTrimmedBranchQuery}
        onQueryChange={setBranchQuery}
        hasNextPage={hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
        onLoadNext={branchRefState.loadNext}
        statusText={branchStatusText}
        renderItem={renderPickerItem}
        getItemType={(item) =>
          item === checkoutPullRequestItemValue
            ? "checkout-pull-request"
            : item === createBranchItemValue
              ? "create-branch"
              : "branch"
        }
        originControl={
          isSelectingWorktreeBase
            ? { checked: startFromOrigin, onCheckedChange: onStartFromOriginChange }
            : undefined
        }
        headerActions={
          <>
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
                      <span className="ms-2 text-3xs uppercase text-muted-foreground">Active</span>
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
                      <span className="ms-2 text-3xs uppercase text-muted-foreground">Active</span>
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
                      <span className="ms-2 text-3xs uppercase text-muted-foreground">Active</span>
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
                      <span className="ms-2 text-3xs uppercase text-muted-foreground">Active</span>
                    )}
                  </MenuItem>
                </MenuPopup>
              </Menu>
            </Group>
          </>
        }
        popupProps={{
          align: displayMode === "panel" ? "start" : "end",
          side: displayMode === "panel" ? "bottom" : "top",
          className: cn("flex flex-col", displayMode === "panel" ? "w-(--anchor-width)" : "w-80"),
          ...(displayMode === "toolbar" ? composerFloatingLayerProps : {}),
        }}
      >
        <div
          className={cn(
            "flex min-w-0",
            displayMode === "panel" ? "w-full flex-col items-stretch" : "items-center gap-1",
            className,
          )}
        >
          {displayMode !== "panel" ? (
            <ThreadPullRequestBadgeControl
              render={<ComposerControl size="xs" />}
              badge={prBadge}
              pullRequests={serverThread?.pullRequests ?? []}
              number={prNumber}
              url={prUrl}
              status={displayedPrStatus}
              onOpenList={() => useRightPanelStore.getState().open(threadRef, "pull-requests")}
              onOpenPullRequest={(event, targetUrl = prUrl) => {
                if (targetUrl) openPrLink(event, targetUrl);
              }}
            />
          ) : null}
          <span
            className="flex min-w-0"
            onMouseDownCapture={(event) => {
              if (event.button !== 0 || event.ctrlKey) {
                event.stopPropagation();
              }
            }}
            onContextMenu={(event) => handleBranchContextMenu(event, resolvedActiveBranch)}
          >
            <ComboboxTrigger
              render={
                displayMode === "panel" ? (
                  <ThreadDetailsControl part="select" />
                ) : (
                  <ComposerControl size="xs" />
                )
              }
              className="min-w-0 max-w-full active:scale-100"
              disabled={isInitialBranchesLoadPending || isBranchActionPending}
            >
              <GitBranchIcon
                className={cn(
                  "size-3 shrink-0 opacity-70",
                  displayMode === "panel" && THREAD_DETAILS_PANEL_ICON_CLASS,
                )}
              />
              <ComposerContextLabel displayMode={displayMode}>
                <MiddleTruncate value={triggerLabel} className="w-full" />
              </ComposerContextLabel>
              {displayMode === "panel" ? (
                <span data-slot="select-icon">
                  <ChevronDownIcon className={THREAD_DETAILS_PANEL_CHEVRON_CLASS} />
                </span>
              ) : (
                <ChevronDownIcon className="size-3 shrink-0 opacity-50" />
              )}
            </ComboboxTrigger>
          </span>
          {displayMode === "panel" && prNumber !== undefined && prUrl !== undefined ? (
            <ThreadDetailsPrRows
              links={serverThread?.pullRequests ?? []}
              currentLink={currentLinkedPr}
              onOpenLink={openPrLink}
              environmentId={environmentId}
              pr={displayedPr}
              number={prNumber}
              reference={currentLinkedPr}
              status={displayedPrStatus}
              project={activeProject}
              label={panelPrLabel}
              openAriaLabel={prUrl ?? "Open pull request"}
              onOpen={(event) => openPrLink(event, prUrl)}
              onActed={() => branchStatusQuery.refresh()}
            />
          ) : null}
        </div>
      </BranchPicker>

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
              {pendingDelete?.worktreePath
                ? ` The worktree at ${formatWorktreePathForDisplay(pendingDelete.worktreePath)} is checked out on this branch and will be removed too.`
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                if (pendingDelete) deleteBranch(pendingDelete, { force: false });
              }}
            >
              {pendingDelete?.worktreePath ? "Delete branch & worktree" : "Delete"}
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
                if (forceDeleteTarget) deleteBranch(forceDeleteTarget, { force: true });
              }}
            >
              Force delete
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>

      <AlertDialog
        open={forceWorktreeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setForceWorktreeTarget(null);
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Discard the worktree for &quot;{forceWorktreeTarget?.name}&quot;?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {forceWorktreeTarget?.worktreePath
                ? `The worktree at ${formatWorktreePathForDisplay(forceWorktreeTarget.worktreePath)} has uncommitted or untracked changes. Removing it discards that work permanently.`
                : "This worktree has uncommitted or untracked changes. Removing it discards that work permanently."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                if (forceWorktreeTarget)
                  deleteBranch(forceWorktreeTarget, {
                    force: false,
                    forceRemoveWorktree: true,
                  });
              }}
            >
              Discard & delete
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}
