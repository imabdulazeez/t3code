import { ArchiveIcon, ArchiveX, LoaderIcon, PlusIcon, RefreshCwIcon } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import {
  defaultInstanceIdForDriver,
  PROVIDER_DISPLAY_NAMES,
  ProviderDriverKind,
  type ProviderInstanceConfig,
  type ProviderInstanceId,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  DEFAULT_BRANCH_NAME_PROMPT_INSTRUCTIONS,
  DEFAULT_COMMIT_MESSAGE_PROMPT_INSTRUCTIONS,
  DEFAULT_PR_CONTENT_PROMPT_INSTRUCTIONS,
  DEFAULT_UNIFIED_SETTINGS,
} from "@t3tools/contracts/settings";
import { createModelSelection } from "@t3tools/shared/model";
import * as Arr from "effect/Array";
import * as Duration from "effect/Duration";
import * as Equal from "effect/Equal";
import * as Result from "effect/Result";
import { APP_VERSION } from "../../branding";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { TraitsPicker } from "../chat/TraitsPicker";
import { useTheme } from "../../hooks/useTheme";
import { usePrimarySettings, useUpdatePrimarySettings } from "../../hooks/useSettings";
import { useThreadActions } from "../../hooks/useThreadActions";
import {
  getCustomModelOptionsByInstance,
  resolveAppModelSelectionState,
} from "../../modelSelection";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "../../providerInstances";
import { ensureLocalApi, readLocalApi } from "../../localApi";
import {
  primaryServerObservabilityAtom,
  primaryServerProvidersAtom,
  serverEnvironment,
} from "../../state/server";
import { usePrimaryEnvironment } from "../../state/environments";
import { useProjects } from "../../state/entities";
import { useArchivedThreadSnapshots } from "../../lib/archivedThreadsState";
import { formatRelativeTime, formatRelativeTimeLabel } from "../../timestampFormat";
import { Button } from "../ui/button";
import { DraftInput } from "../ui/draft-input";
import { Textarea } from "../ui/textarea";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { AddProviderInstanceDialog } from "./AddProviderInstanceDialog";
import { FontPicker } from "./FontPicker";
import {
  canOneClickUpdateProviderCandidate,
  collectProviderUpdateCandidates,
  hasOneClickUpdateProviderCandidate,
  isProviderUpdateActive,
  type ProviderUpdateCandidate,
} from "../ProviderUpdateLaunchNotification.logic";
import { ProviderInstanceCard } from "./ProviderInstanceCard";
import { DRIVER_OPTIONS, getDriverOption } from "./providerDriverMeta";
import {
  buildProviderInstanceUpdatePatch,
  formatDiagnosticsDescription,
} from "./SettingsPanels.logic";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
  useRelativeTimeTick,
} from "./settingsLayout";
import { ProjectFavicon } from "../ProjectFavicon";
import { useAtomCommand } from "../../state/use-atom-command";

const THEME_OPTIONS = [
  {
    value: "system",
    label: "System",
  },
  {
    value: "light",
    label: "Light",
  },
  {
    value: "dark",
    label: "Dark",
  },
] as const;

const TIMESTAMP_FORMAT_LABELS = {
  locale: "System default",
  "12-hour": "12-hour",
  "24-hour": "24-hour",
} as const;

const DEFAULT_DRIVER_KIND = ProviderDriverKind.make("codex");

function withoutProviderInstanceKey<V>(
  record: Readonly<Record<ProviderInstanceId, V>> | undefined,
  key: ProviderInstanceId,
): Record<ProviderInstanceId, V> {
  const next = { ...record } as Record<ProviderInstanceId, V>;
  delete next[key];
  return next;
}

function withoutProviderInstanceFavorites(
  favorites: ReadonlyArray<{ readonly provider: ProviderInstanceId; readonly model: string }>,
  instanceId: ProviderInstanceId,
) {
  return favorites.filter((favorite) => favorite.provider !== instanceId);
}

const PROVIDER_SETTINGS = DRIVER_OPTIONS.map((definition) => ({
  provider: definition.value,
}));

function ProviderLastChecked({ lastCheckedAt }: { lastCheckedAt: string | null }) {
  useRelativeTimeTick();
  const lastCheckedRelative = lastCheckedAt ? formatRelativeTime(lastCheckedAt) : null;

  if (!lastCheckedRelative) {
    return null;
  }

  return (
    <span className="text-[11px] text-muted-foreground/60">
      {lastCheckedRelative.suffix ? (
        <>
          Checked <span className="font-mono tabular-nums">{lastCheckedRelative.value}</span>{" "}
          {lastCheckedRelative.suffix}
        </>
      ) : (
        <>Checked {lastCheckedRelative.value}</>
      )}
    </span>
  );
}

function AboutVersionTitle() {
  return (
    <span className="inline-flex items-center gap-2">
      <span>Version</span>
      <code className="text-[11px] font-medium text-muted-foreground">{APP_VERSION}</code>
    </span>
  );
}

function AboutVersionSection() {
  return (
    <SettingsRow title={<AboutVersionTitle />} description="Current version of the application." />
  );
}

export function useSettingsRestore(onRestored?: () => void) {
  const { theme, setTheme } = useTheme();
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();

  const isGitWritingModelDirty = !Equal.equals(
    settings.textGenerationModelSelection ?? null,
    DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection ?? null,
  );

  const changedSettingLabels = useMemo(
    () => [
      ...(theme !== "system" ? ["Theme"] : []),
      ...(settings.timestampFormat !== DEFAULT_UNIFIED_SETTINGS.timestampFormat
        ? ["Time format"]
        : []),
      ...(settings.sidebarThreadPreviewCount !== DEFAULT_UNIFIED_SETTINGS.sidebarThreadPreviewCount
        ? ["Visible threads"]
        : []),
      ...(settings.diffWordWrap !== DEFAULT_UNIFIED_SETTINGS.diffWordWrap
        ? ["Diff line wrapping"]
        : []),
      ...(settings.diffIgnoreWhitespace !== DEFAULT_UNIFIED_SETTINGS.diffIgnoreWhitespace
        ? ["Diff whitespace changes"]
        : []),
      ...(settings.diffFontFamily !== DEFAULT_UNIFIED_SETTINGS.diffFontFamily ? ["Diff font"] : []),
      ...(settings.terminalFontFamily !== DEFAULT_UNIFIED_SETTINGS.terminalFontFamily
        ? ["Terminal font"]
        : []),
      ...(settings.autoOpenPlanSidebar !== DEFAULT_UNIFIED_SETTINGS.autoOpenPlanSidebar
        ? ["Auto-open task panel"]
        : []),
      ...(settings.changedFilesExpandedByDefault !==
      DEFAULT_UNIFIED_SETTINGS.changedFilesExpandedByDefault
        ? ["Expand changed files by default"]
        : []),
      ...(settings.enableAssistantStreaming !== DEFAULT_UNIFIED_SETTINGS.enableAssistantStreaming
        ? ["Assistant output"]
        : []),
      ...(Duration.toMillis(settings.automaticGitFetchInterval) !==
      Duration.toMillis(DEFAULT_UNIFIED_SETTINGS.automaticGitFetchInterval)
        ? ["Automatic Git fetch interval"]
        : []),
      ...(settings.defaultThreadEnvMode !== DEFAULT_UNIFIED_SETTINGS.defaultThreadEnvMode
        ? ["New thread mode"]
        : []),
      ...(settings.newWorktreesStartFromOrigin !==
      DEFAULT_UNIFIED_SETTINGS.newWorktreesStartFromOrigin
        ? ["New worktrees start from origin"]
        : []),
      ...(settings.addProjectBaseDirectory !== DEFAULT_UNIFIED_SETTINGS.addProjectBaseDirectory
        ? ["Add project base directory"]
        : []),
      ...(settings.confirmThreadArchive !== DEFAULT_UNIFIED_SETTINGS.confirmThreadArchive
        ? ["Archive confirmation"]
        : []),
      ...(settings.confirmThreadDelete !== DEFAULT_UNIFIED_SETTINGS.confirmThreadDelete
        ? ["Delete confirmation"]
        : []),
      ...(settings.deleteRemoteBranchOnDelete !==
      DEFAULT_UNIFIED_SETTINGS.deleteRemoteBranchOnDelete
        ? ["Delete remote branch"]
        : []),
      ...(isGitWritingModelDirty ? ["Git writing model"] : []),
      ...(settings.commitMessagePromptInstructions !==
      DEFAULT_UNIFIED_SETTINGS.commitMessagePromptInstructions
        ? ["Commit message instructions"]
        : []),
      ...(settings.prContentPromptInstructions !==
      DEFAULT_UNIFIED_SETTINGS.prContentPromptInstructions
        ? ["PR content instructions"]
        : []),
      ...(settings.branchNamePromptInstructions !==
      DEFAULT_UNIFIED_SETTINGS.branchNamePromptInstructions
        ? ["Branch name instructions"]
        : []),
    ],
    [
      isGitWritingModelDirty,
      settings.branchNamePromptInstructions,
      settings.commitMessagePromptInstructions,
      settings.prContentPromptInstructions,
      settings.autoOpenPlanSidebar,
      settings.changedFilesExpandedByDefault,
      settings.confirmThreadArchive,
      settings.confirmThreadDelete,
      settings.deleteRemoteBranchOnDelete,
      settings.addProjectBaseDirectory,
      settings.defaultThreadEnvMode,
      settings.newWorktreesStartFromOrigin,
      settings.diffFontFamily,
      settings.terminalFontFamily,
      settings.diffIgnoreWhitespace,
      settings.diffWordWrap,
      settings.automaticGitFetchInterval,
      settings.enableAssistantStreaming,
      settings.sidebarThreadPreviewCount,
      settings.timestampFormat,
      theme,
    ],
  );

  const restoreDefaults = useCallback(async () => {
    if (changedSettingLabels.length === 0) return;
    const api = readLocalApi();
    const confirmed = await (api ?? ensureLocalApi()).dialogs.confirm(
      ["Restore default settings?", `This will reset: ${changedSettingLabels.join(", ")}.`].join(
        "\n",
      ),
    );
    if (!confirmed) return;

    setTheme("system");
    updateSettings({
      timestampFormat: DEFAULT_UNIFIED_SETTINGS.timestampFormat,
      diffWordWrap: DEFAULT_UNIFIED_SETTINGS.diffWordWrap,
      diffIgnoreWhitespace: DEFAULT_UNIFIED_SETTINGS.diffIgnoreWhitespace,
      sidebarThreadPreviewCount: DEFAULT_UNIFIED_SETTINGS.sidebarThreadPreviewCount,
      autoOpenPlanSidebar: DEFAULT_UNIFIED_SETTINGS.autoOpenPlanSidebar,
      changedFilesExpandedByDefault: DEFAULT_UNIFIED_SETTINGS.changedFilesExpandedByDefault,
      diffFontFamily: DEFAULT_UNIFIED_SETTINGS.diffFontFamily,
      terminalFontFamily: DEFAULT_UNIFIED_SETTINGS.terminalFontFamily,
      enableAssistantStreaming: DEFAULT_UNIFIED_SETTINGS.enableAssistantStreaming,
      automaticGitFetchInterval: DEFAULT_UNIFIED_SETTINGS.automaticGitFetchInterval,
      defaultThreadEnvMode: DEFAULT_UNIFIED_SETTINGS.defaultThreadEnvMode,
      newWorktreesStartFromOrigin: DEFAULT_UNIFIED_SETTINGS.newWorktreesStartFromOrigin,
      addProjectBaseDirectory: DEFAULT_UNIFIED_SETTINGS.addProjectBaseDirectory,
      confirmThreadArchive: DEFAULT_UNIFIED_SETTINGS.confirmThreadArchive,
      confirmThreadDelete: DEFAULT_UNIFIED_SETTINGS.confirmThreadDelete,
      deleteRemoteBranchOnDelete: DEFAULT_UNIFIED_SETTINGS.deleteRemoteBranchOnDelete,
      textGenerationModelSelection: DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection,
      commitMessagePromptInstructions: DEFAULT_UNIFIED_SETTINGS.commitMessagePromptInstructions,
      prContentPromptInstructions: DEFAULT_UNIFIED_SETTINGS.prContentPromptInstructions,
      branchNamePromptInstructions: DEFAULT_UNIFIED_SETTINGS.branchNamePromptInstructions,
    });
    onRestored?.();
  }, [changedSettingLabels, onRestored, setTheme, updateSettings]);

  return {
    changedSettingLabels,
    restoreDefaults,
  };
}

function DraftTextarea({
  value,
  onCommit,
  className,
  ...rest
}: Omit<React.ComponentProps<typeof Textarea>, "value" | "onChange" | "defaultValue"> & {
  readonly value: string;
  readonly onCommit: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const focusedRef = useRef(false);

  useEffect(() => {
    if (!focusedRef.current) setDraft(value);
  }, [value]);

  return (
    <Textarea
      {...rest}
      className={className}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onFocus={() => {
        focusedRef.current = true;
      }}
      onBlur={() => {
        focusedRef.current = false;
        if (draft !== value) onCommit(draft);
      }}
    />
  );
}

function PromptInstructionsRow({
  title,
  value,
  defaultValue,
  onChange,
  ariaLabel,
}: {
  readonly title: string;
  readonly value: string;
  readonly defaultValue: string;
  readonly onChange: (next: string) => void;
  readonly ariaLabel: string;
}) {
  const isCustom = value.length > 0;
  return (
    <div className="border-t border-border/60 px-4 py-3.5 sm:px-5">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-h-5 items-center gap-1.5">
          <h3 className="text-[13px] font-semibold tracking-[-0.01em] text-foreground">{title}</h3>
          <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center">
            {isCustom ? (
              <SettingResetButton label={ariaLabel} onClick={() => onChange("")} />
            ) : null}
          </span>
        </div>
        <Button
          size="xs"
          variant="outline"
          disabled={isCustom}
          onClick={() => onChange(defaultValue)}
        >
          Edit default
        </Button>
      </div>
      <DraftTextarea
        className="w-full [&_textarea]:min-h-[140px]"
        value={value}
        onCommit={onChange}
        placeholder={defaultValue}
        spellCheck={false}
        aria-label={ariaLabel}
      />
    </div>
  );
}

export function GeneralSettingsPanel() {
  const { theme, setTheme } = useTheme();
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();
  const observability = useAtomValue(primaryServerObservabilityAtom);
  const serverProviders = useAtomValue(primaryServerProvidersAtom);
  const diagnosticsDescription = formatDiagnosticsDescription({
    localTracingEnabled: observability?.localTracingEnabled ?? false,
    otlpTracesEnabled: observability?.otlpTracesEnabled ?? false,
    otlpTracesUrl: observability?.otlpTracesUrl,
    otlpMetricsEnabled: observability?.otlpMetricsEnabled ?? false,
    otlpMetricsUrl: observability?.otlpMetricsUrl,
  });

  const textGenerationModelSelection = resolveAppModelSelectionState(settings, serverProviders);
  const textGenInstanceId = textGenerationModelSelection.instanceId;
  const textGenModel = textGenerationModelSelection.model;
  const textGenModelOptions = textGenerationModelSelection.options;
  const gitModelInstanceEntries = sortProviderInstanceEntries(
    applyProviderInstanceSettings(deriveProviderInstanceEntries(serverProviders), settings),
  );
  const textGenInstanceEntry = gitModelInstanceEntries.find(
    (entry) => entry.instanceId === textGenInstanceId,
  );
  const textGenProvider: ProviderDriverKind =
    textGenInstanceEntry?.driverKind ?? DEFAULT_DRIVER_KIND;
  const gitModelOptionsByInstance = getCustomModelOptionsByInstance(
    settings,
    serverProviders,
    textGenInstanceId,
    textGenModel,
  );
  const isGitWritingModelDirty = !Equal.equals(
    settings.textGenerationModelSelection ?? null,
    DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection ?? null,
  );

  return (
    <SettingsPageContainer>
      <SettingsSection title="Appearance">
        <SettingsRow
          title="Theme"
          description="Choose how T3 Code looks across the app."
          resetAction={
            theme !== "system" ? (
              <SettingResetButton label="theme" onClick={() => setTheme("system")} />
            ) : null
          }
          control={
            <Select
              value={theme}
              onValueChange={(value) => {
                if (value === "system" || value === "light" || value === "dark") {
                  setTheme(value);
                }
              }}
            >
              <SelectTrigger className="w-full sm:w-40" aria-label="Theme preference">
                <SelectValue>
                  {THEME_OPTIONS.find((option) => option.value === theme)?.label ?? "System"}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {THEME_OPTIONS.map((option) => (
                  <SelectItem hideIndicator key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />

        <SettingsRow
          title="Time format"
          description="System default follows your browser or OS clock preference."
          resetAction={
            settings.timestampFormat !== DEFAULT_UNIFIED_SETTINGS.timestampFormat ? (
              <SettingResetButton
                label="time format"
                onClick={() =>
                  updateSettings({
                    timestampFormat: DEFAULT_UNIFIED_SETTINGS.timestampFormat,
                  })
                }
              />
            ) : null
          }
          control={
            <Select
              value={settings.timestampFormat}
              onValueChange={(value) => {
                if (value === "locale" || value === "12-hour" || value === "24-hour") {
                  updateSettings({ timestampFormat: value });
                }
              }}
            >
              <SelectTrigger className="w-full sm:w-40" aria-label="Timestamp format">
                <SelectValue>{TIMESTAMP_FORMAT_LABELS[settings.timestampFormat]}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="locale">
                  {TIMESTAMP_FORMAT_LABELS.locale}
                </SelectItem>
                <SelectItem hideIndicator value="12-hour">
                  {TIMESTAMP_FORMAT_LABELS["12-hour"]}
                </SelectItem>
                <SelectItem hideIndicator value="24-hour">
                  {TIMESTAMP_FORMAT_LABELS["24-hour"]}
                </SelectItem>
              </SelectPopup>
            </Select>
          }
        />

        <SettingsRow
          title="Diff font"
          description="Choose the font used in the code diff view."
          resetAction={
            settings.diffFontFamily !== DEFAULT_UNIFIED_SETTINGS.diffFontFamily ? (
              <SettingResetButton
                label="diff font"
                onClick={() =>
                  updateSettings({ diffFontFamily: DEFAULT_UNIFIED_SETTINGS.diffFontFamily })
                }
              />
            ) : null
          }
          control={
            <FontPicker
              value={settings.diffFontFamily}
              onValueChange={(next) => updateSettings({ diffFontFamily: next })}
              className="w-full sm:w-64"
            />
          }
        />

        <SettingsRow
          title="Terminal font"
          description="Choose the font used in the terminal."
          resetAction={
            settings.terminalFontFamily !== DEFAULT_UNIFIED_SETTINGS.terminalFontFamily ? (
              <SettingResetButton
                label="terminal font"
                onClick={() =>
                  updateSettings({
                    terminalFontFamily: DEFAULT_UNIFIED_SETTINGS.terminalFontFamily,
                  })
                }
              />
            ) : null
          }
          control={
            <FontPicker
              value={settings.terminalFontFamily}
              onValueChange={(next) => updateSettings({ terminalFontFamily: next })}
              className="w-full sm:w-64"
            />
          }
        />

        <SettingsRow
          title="Diff line wrapping"
          description="Set the default wrap state when the diff panel opens."
          resetAction={
            settings.diffWordWrap !== DEFAULT_UNIFIED_SETTINGS.diffWordWrap ? (
              <SettingResetButton
                label="diff line wrapping"
                onClick={() =>
                  updateSettings({
                    diffWordWrap: DEFAULT_UNIFIED_SETTINGS.diffWordWrap,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.diffWordWrap}
              onCheckedChange={(checked) => updateSettings({ diffWordWrap: Boolean(checked) })}
              aria-label="Wrap diff lines by default"
            />
          }
        />

        <SettingsRow
          title="Hide whitespace changes"
          description="Set whether the diff panel ignores whitespace-only edits by default."
          resetAction={
            settings.diffIgnoreWhitespace !== DEFAULT_UNIFIED_SETTINGS.diffIgnoreWhitespace ? (
              <SettingResetButton
                label="diff whitespace changes"
                onClick={() =>
                  updateSettings({
                    diffIgnoreWhitespace: DEFAULT_UNIFIED_SETTINGS.diffIgnoreWhitespace,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.diffIgnoreWhitespace}
              onCheckedChange={(checked) =>
                updateSettings({ diffIgnoreWhitespace: Boolean(checked) })
              }
              aria-label="Hide whitespace changes by default"
            />
          }
        />
      </SettingsSection>

      <SettingsSection title="Threads & tasks">
        <SettingsRow
          title="New threads"
          description="Pick the default workspace mode for newly created draft threads."
          resetAction={
            settings.defaultThreadEnvMode !== DEFAULT_UNIFIED_SETTINGS.defaultThreadEnvMode ||
            settings.newWorktreesStartFromOrigin !==
              DEFAULT_UNIFIED_SETTINGS.newWorktreesStartFromOrigin ? (
              <SettingResetButton
                label="new threads"
                onClick={() =>
                  updateSettings({
                    defaultThreadEnvMode: DEFAULT_UNIFIED_SETTINGS.defaultThreadEnvMode,
                    newWorktreesStartFromOrigin:
                      DEFAULT_UNIFIED_SETTINGS.newWorktreesStartFromOrigin,
                  })
                }
              />
            ) : null
          }
          control={
            <Select
              value={settings.defaultThreadEnvMode}
              onValueChange={(value) => {
                if (value === "local" || value === "worktree") {
                  updateSettings({ defaultThreadEnvMode: value });
                }
              }}
            >
              <SelectTrigger className="w-full sm:w-44" aria-label="Default thread mode">
                <SelectValue>
                  {settings.defaultThreadEnvMode === "worktree" ? "New worktree" : "Local"}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="local">
                  Local
                </SelectItem>
                <SelectItem hideIndicator value="worktree">
                  New worktree
                </SelectItem>
              </SelectPopup>
            </Select>
          }
        />

        {settings.defaultThreadEnvMode === "worktree" ? (
          <SettingsRow
            className="bg-muted/20 sm:pl-9"
            title="Start from origin"
            description="Creates the worktree from the latest matching branch on origin instead of your local branch."
            resetAction={
              settings.newWorktreesStartFromOrigin !==
              DEFAULT_UNIFIED_SETTINGS.newWorktreesStartFromOrigin ? (
                <SettingResetButton
                  label="new worktrees start from origin"
                  onClick={() =>
                    updateSettings({
                      newWorktreesStartFromOrigin:
                        DEFAULT_UNIFIED_SETTINGS.newWorktreesStartFromOrigin,
                    })
                  }
                />
              ) : null
            }
            control={
              <Switch
                checked={settings.newWorktreesStartFromOrigin}
                onCheckedChange={(checked) =>
                  updateSettings({ newWorktreesStartFromOrigin: Boolean(checked) })
                }
                aria-label="Start new worktrees from origin by default"
              />
            }
          />
        ) : null}

        <SettingsRow
          title="Auto-open task panel"
          description="Open the right-side plan and task panel automatically when steps appear."
          resetAction={
            settings.autoOpenPlanSidebar !== DEFAULT_UNIFIED_SETTINGS.autoOpenPlanSidebar ? (
              <SettingResetButton
                label="auto-open task panel"
                onClick={() =>
                  updateSettings({
                    autoOpenPlanSidebar: DEFAULT_UNIFIED_SETTINGS.autoOpenPlanSidebar,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.autoOpenPlanSidebar}
              onCheckedChange={(checked) =>
                updateSettings({ autoOpenPlanSidebar: Boolean(checked) })
              }
              aria-label="Open the task panel automatically"
            />
          }
        />

        <SettingsRow
          title="Expand changed files by default"
          description="When a turn modifies files, show all directories expanded instead of collapsed."
          resetAction={
            settings.changedFilesExpandedByDefault !==
            DEFAULT_UNIFIED_SETTINGS.changedFilesExpandedByDefault ? (
              <SettingResetButton
                label="expand changed files by default"
                onClick={() =>
                  updateSettings({
                    changedFilesExpandedByDefault:
                      DEFAULT_UNIFIED_SETTINGS.changedFilesExpandedByDefault,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.changedFilesExpandedByDefault}
              onCheckedChange={(checked) =>
                updateSettings({ changedFilesExpandedByDefault: Boolean(checked) })
              }
              aria-label="Expand changed files by default"
            />
          }
        />

        <SettingsRow
          title="Assistant output"
          description="Show token-by-token output while a response is in progress."
          resetAction={
            settings.enableAssistantStreaming !==
            DEFAULT_UNIFIED_SETTINGS.enableAssistantStreaming ? (
              <SettingResetButton
                label="assistant output"
                onClick={() =>
                  updateSettings({
                    enableAssistantStreaming: DEFAULT_UNIFIED_SETTINGS.enableAssistantStreaming,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.enableAssistantStreaming}
              onCheckedChange={(checked) =>
                updateSettings({ enableAssistantStreaming: Boolean(checked) })
              }
              aria-label="Stream assistant messages"
            />
          }
        />

        <SettingsRow
          title="Provider update checks"
          description="Check installed provider CLIs for newer available versions."
          resetAction={
            settings.enableProviderUpdateChecks !==
            DEFAULT_UNIFIED_SETTINGS.enableProviderUpdateChecks ? (
              <SettingResetButton
                label="provider update checks"
                onClick={() =>
                  updateSettings({
                    enableProviderUpdateChecks: DEFAULT_UNIFIED_SETTINGS.enableProviderUpdateChecks,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.enableProviderUpdateChecks}
              onCheckedChange={(checked) =>
                updateSettings({ enableProviderUpdateChecks: Boolean(checked) })
              }
              aria-label="Check provider versions"
            />
          }
        />

        <SettingsRow
          title="Archive confirmation"
          description="Require a second click on the inline archive action before a thread is archived."
          resetAction={
            settings.confirmThreadArchive !== DEFAULT_UNIFIED_SETTINGS.confirmThreadArchive ? (
              <SettingResetButton
                label="archive confirmation"
                onClick={() =>
                  updateSettings({
                    confirmThreadArchive: DEFAULT_UNIFIED_SETTINGS.confirmThreadArchive,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.confirmThreadArchive}
              onCheckedChange={(checked) =>
                updateSettings({ confirmThreadArchive: Boolean(checked) })
              }
              aria-label="Confirm thread archiving"
            />
          }
        />

        <SettingsRow
          title="Delete confirmation"
          description="Ask before deleting a thread and its chat history."
          resetAction={
            settings.confirmThreadDelete !== DEFAULT_UNIFIED_SETTINGS.confirmThreadDelete ? (
              <SettingResetButton
                label="delete confirmation"
                onClick={() =>
                  updateSettings({
                    confirmThreadDelete: DEFAULT_UNIFIED_SETTINGS.confirmThreadDelete,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.confirmThreadDelete}
              onCheckedChange={(checked) =>
                updateSettings({ confirmThreadDelete: Boolean(checked) })
              }
              aria-label="Confirm thread deletion"
            />
          }
        />
      </SettingsSection>

      <SettingsSection title="Projects">
        <SettingsRow
          title="Add project starts in"
          description='Leave empty to use "~/" when the Add Project browser opens.'
          resetAction={
            settings.addProjectBaseDirectory !==
            DEFAULT_UNIFIED_SETTINGS.addProjectBaseDirectory ? (
              <SettingResetButton
                label="add project base directory"
                onClick={() =>
                  updateSettings({
                    addProjectBaseDirectory: DEFAULT_UNIFIED_SETTINGS.addProjectBaseDirectory,
                  })
                }
              />
            ) : null
          }
          control={
            <DraftInput
              className="w-full sm:w-72"
              value={settings.addProjectBaseDirectory}
              onCommit={(next) => updateSettings({ addProjectBaseDirectory: next })}
              placeholder="~/"
              spellCheck={false}
              aria-label="Add project base directory"
            />
          }
        />
      </SettingsSection>

      <SettingsSection title="Version control">
        <SettingsRow
          title="Auto-create PR on push"
          description="When pushing a feature branch with no open PR, also create a pull request automatically."
          resetAction={
            settings.autoCreatePrOnPush !== DEFAULT_UNIFIED_SETTINGS.autoCreatePrOnPush ? (
              <SettingResetButton
                label="auto-create PR on push"
                onClick={() =>
                  updateSettings({
                    autoCreatePrOnPush: DEFAULT_UNIFIED_SETTINGS.autoCreatePrOnPush,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.autoCreatePrOnPush}
              onCheckedChange={(checked) =>
                updateSettings({ autoCreatePrOnPush: Boolean(checked) })
              }
              aria-label="Auto-create PR on push"
            />
          }
        />

        <SettingsRow
          title="Delete remote branch"
          description="When deleting a branch, also delete its remote counterpart."
          resetAction={
            settings.deleteRemoteBranchOnDelete !==
            DEFAULT_UNIFIED_SETTINGS.deleteRemoteBranchOnDelete ? (
              <SettingResetButton
                label="delete remote branch"
                onClick={() =>
                  updateSettings({
                    deleteRemoteBranchOnDelete: DEFAULT_UNIFIED_SETTINGS.deleteRemoteBranchOnDelete,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.deleteRemoteBranchOnDelete}
              onCheckedChange={(checked) =>
                updateSettings({ deleteRemoteBranchOnDelete: Boolean(checked) })
              }
              aria-label="Delete remote branch on delete"
            />
          }
        />

        <SettingsRow
          title="Text generation model"
          description="Configure the model used for generated commit messages, PR titles, and similar Git text."
          resetAction={
            isGitWritingModelDirty ? (
              <SettingResetButton
                label="text generation model"
                onClick={() =>
                  updateSettings({
                    textGenerationModelSelection:
                      DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection,
                  })
                }
              />
            ) : null
          }
          control={
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              <ProviderModelPicker
                activeInstanceId={textGenInstanceId}
                model={textGenModel}
                lockedProvider={null}
                instanceEntries={gitModelInstanceEntries}
                modelOptionsByInstance={gitModelOptionsByInstance}
                triggerVariant="outline"
                triggerClassName="min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground"
                onInstanceModelChange={(instanceId, model) => {
                  updateSettings({
                    textGenerationModelSelection: resolveAppModelSelectionState(
                      {
                        ...settings,
                        textGenerationModelSelection: createModelSelection(instanceId, model),
                      },
                      serverProviders,
                    ),
                  });
                }}
              />
              <TraitsPicker
                provider={textGenProvider}
                models={
                  // Use the exact instance's models (rather than the
                  // first-kind-match) so a custom text-gen instance like
                  // `codex_personal` gets its own model list, not the
                  // default Codex one.
                  textGenInstanceEntry?.models ?? []
                }
                model={textGenModel}
                prompt=""
                onPromptChange={() => {}}
                modelOptions={textGenModelOptions}
                allowPromptInjectedEffort={false}
                triggerVariant="outline"
                triggerClassName="min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground"
                onModelOptionsChange={(nextOptions) => {
                  updateSettings({
                    textGenerationModelSelection: resolveAppModelSelectionState(
                      {
                        ...settings,
                        textGenerationModelSelection: createModelSelection(
                          textGenInstanceId,
                          textGenModel,
                          nextOptions,
                        ),
                      },
                      serverProviders,
                    ),
                  });
                }}
              />
            </div>
          }
        />
        <div className="border-t border-border/60 px-4 pt-4 pb-2 sm:px-5">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-foreground/60">
            Version control prompts
          </h3>
          <p className="mt-1 text-xs text-muted-foreground/80">
            Replace the default natural-language instructions used by version-control text
            generation. The JSON output format and dynamic context (diff, branch, etc.) are always
            included automatically. Leave empty to use the built-in instructions.
          </p>
        </div>
        <PromptInstructionsRow
          title="Commit message"
          value={settings.commitMessagePromptInstructions}
          defaultValue={DEFAULT_COMMIT_MESSAGE_PROMPT_INSTRUCTIONS}
          onChange={(next) => updateSettings({ commitMessagePromptInstructions: next })}
          ariaLabel="Commit message instructions"
        />
        <PromptInstructionsRow
          title="PR content"
          value={settings.prContentPromptInstructions}
          defaultValue={DEFAULT_PR_CONTENT_PROMPT_INSTRUCTIONS}
          onChange={(next) => updateSettings({ prContentPromptInstructions: next })}
          ariaLabel="PR content instructions"
        />
        <PromptInstructionsRow
          title="Branch name"
          value={settings.branchNamePromptInstructions}
          defaultValue={DEFAULT_BRANCH_NAME_PROMPT_INSTRUCTIONS}
          onChange={(next) => updateSettings({ branchNamePromptInstructions: next })}
          ariaLabel="Branch name instructions"
        />
      </SettingsSection>

      <SettingsSection title="About">
        <AboutVersionSection />
        <SettingsRow
          title="Diagnostics"
          description={diagnosticsDescription}
          control={
            <Button render={<Link to="/settings/diagnostics" />} size="xs" variant="outline">
              View diagnostics
            </Button>
          }
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}

export function ProviderSettingsPanel() {
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();
  const serverProviders = useAtomValue(primaryServerProvidersAtom);
  const primaryEnvironment = usePrimaryEnvironment();
  const refreshServerProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const updateProvider = useAtomCommand(serverEnvironment.updateProvider, {
    reportFailure: false,
  });
  const [isRefreshingProviders, setIsRefreshingProviders] = useState(false);
  const [isAddInstanceDialogOpen, setIsAddInstanceDialogOpen] = useState(false);
  const [updatingProviderDrivers, setUpdatingProviderDrivers] = useState<
    ReadonlySet<ProviderDriverKind>
  >(() => new Set());
  const [openInstanceDetails, setOpenInstanceDetails] = useState<Record<string, boolean>>({});
  const refreshingRef = useRef(false);

  const providerUpdateCandidates = useMemo(
    () => collectProviderUpdateCandidates(serverProviders),
    [serverProviders],
  );
  const providerUpdateCandidateByInstanceId = useMemo(
    () => new Map(providerUpdateCandidates.map((candidate) => [candidate.instanceId, candidate])),
    [providerUpdateCandidates],
  );
  const visibleProviderSettings = PROVIDER_SETTINGS.filter(
    (providerSettings) =>
      providerSettings.provider !== "cursor" ||
      serverProviders.some(
        (provider) =>
          provider.instanceId === defaultInstanceIdForDriver(ProviderDriverKind.make("cursor")),
      ),
  );
  const textGenerationModelSelection = resolveAppModelSelectionState(settings, serverProviders);
  const textGenInstanceId = textGenerationModelSelection.instanceId;
  const lastCheckedAt =
    serverProviders.length > 0
      ? serverProviders.reduce(
          (latest, provider) => (provider.checkedAt > latest ? provider.checkedAt : latest),
          serverProviders[0]!.checkedAt,
        )
      : null;

  const refreshProviders = useCallback(() => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setIsRefreshingProviders(true);
    if (!primaryEnvironment) {
      refreshingRef.current = false;
      setIsRefreshingProviders(false);
      return;
    }
    void (async () => {
      const result = await refreshServerProviders({
        environmentId: primaryEnvironment.environmentId,
        input: {},
      });
      refreshingRef.current = false;
      setIsRefreshingProviders(false);
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        console.warn("Failed to refresh providers", squashAtomCommandFailure(result));
      }
    })();
  }, [primaryEnvironment, refreshServerProviders]);

  const runProviderUpdate = useCallback(
    async (candidate: ProviderUpdateCandidate) => {
      if (!primaryEnvironment) return;
      let started = false;
      setUpdatingProviderDrivers((previous) => {
        if (previous.has(candidate.driver)) {
          return previous;
        }
        started = true;
        const next = new Set(previous);
        next.add(candidate.driver);
        return next;
      });
      if (!started) {
        return;
      }

      const result = await updateProvider({
        environmentId: primaryEnvironment.environmentId,
        input: {
          provider: candidate.driver,
          instanceId: candidate.instanceId,
        },
      });
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: `Could not update ${PROVIDER_DISPLAY_NAMES[candidate.driver] ?? candidate.driver}`,
            description:
              error instanceof Error
                ? error.message
                : "The provider update command could not be started.",
          }),
        );
      }
      setUpdatingProviderDrivers((previous) => {
        if (!previous.has(candidate.driver)) {
          return previous;
        }
        const next = new Set(previous);
        next.delete(candidate.driver);
        return next;
      });
    },
    [primaryEnvironment, updateProvider],
  );

  interface InstanceRow {
    readonly instanceId: ProviderInstanceId;
    readonly instance: ProviderInstanceConfig;
    readonly driver: ProviderDriverKind;
    readonly isDefault: boolean;
    readonly isDirty?: boolean;
  }

  const instancesByDriver = new Map<
    ProviderDriverKind,
    Array<[ProviderInstanceId, ProviderInstanceConfig]>
  >();
  for (const [rawId, instance] of Object.entries(settings.providerInstances ?? {})) {
    const driver = instance.driver;
    const list = instancesByDriver.get(driver) ?? [];
    list.push([rawId as ProviderInstanceId, instance]);
    instancesByDriver.set(driver, list);
  }

  const defaultSlotIdsBySource = new Set<string>(
    visibleProviderSettings.map((providerSettings) =>
      String(defaultInstanceIdForDriver(providerSettings.provider)),
    ),
  );

  const rows: InstanceRow[] = [];
  const visibleDriverKinds = new Set<ProviderDriverKind>(
    visibleProviderSettings.map((providerSettings) => providerSettings.provider),
  );

  for (const providerSettings of visibleProviderSettings) {
    type LegacyProviderSettings = (typeof settings.providers)[keyof typeof settings.providers];
    const legacyProviders = settings.providers as Record<string, LegacyProviderSettings>;
    const defaultLegacyProviders = DEFAULT_UNIFIED_SETTINGS.providers as Record<
      string,
      LegacyProviderSettings
    >;
    const driver = providerSettings.provider;
    const defaultInstanceId = defaultInstanceIdForDriver(driver);
    const explicitInstance = settings.providerInstances?.[defaultInstanceId];
    const legacyConfig = legacyProviders[providerSettings.provider]!;
    const defaultLegacyConfig = defaultLegacyProviders[providerSettings.provider]!;
    const effectiveInstance: ProviderInstanceConfig =
      explicitInstance ??
      ({
        driver,
        enabled: legacyConfig.enabled,
        config: legacyConfig,
      } satisfies ProviderInstanceConfig);
    const isDirty =
      explicitInstance !== undefined || !Equal.equals(legacyConfig, defaultLegacyConfig);
    rows.push({
      instanceId: defaultInstanceId,
      instance: effectiveInstance,
      driver,
      isDefault: true,
      isDirty,
    });
    for (const [id, instance] of instancesByDriver.get(providerSettings.provider) ?? []) {
      if (id === defaultInstanceId) continue;
      rows.push({ instanceId: id, instance, driver: instance.driver, isDefault: false });
    }
  }
  for (const [driver, list] of instancesByDriver) {
    if (visibleDriverKinds.has(driver)) continue;
    for (const [id, instance] of list) {
      rows.push({
        instanceId: id,
        instance,
        driver: instance.driver,
        isDefault: defaultSlotIdsBySource.has(String(id)),
      });
    }
  }

  const updateProviderInstance = (
    row: InstanceRow,
    next: ProviderInstanceConfig,
    options?: {
      readonly textGenerationModelSelection?: Parameters<
        typeof buildProviderInstanceUpdatePatch
      >[0]["textGenerationModelSelection"];
    },
  ) => {
    updateSettings(
      buildProviderInstanceUpdatePatch({
        settings,
        instanceId: row.instanceId,
        instance: next,
        driver: row.driver,
        isDefault: row.isDefault,
        textGenerationModelSelection: options?.textGenerationModelSelection,
      }),
    );
  };

  const deleteProviderInstance = (id: ProviderInstanceId) => {
    updateSettings({
      providerInstances: withoutProviderInstanceKey(settings.providerInstances, id),
      providerModelPreferences: withoutProviderInstanceKey(settings.providerModelPreferences, id),
      favorites: withoutProviderInstanceFavorites(settings.favorites ?? [], id),
    });
  };

  const updateProviderModelPreferences = (
    instanceId: ProviderInstanceId,
    next: {
      readonly hiddenModels: ReadonlyArray<string>;
      readonly modelOrder: ReadonlyArray<string>;
    },
  ) => {
    const hiddenModels = [...new Set(next.hiddenModels.filter((slug) => slug.trim().length > 0))];
    const modelOrder = [...new Set(next.modelOrder.filter((slug) => slug.trim().length > 0))];
    const rest = withoutProviderInstanceKey(settings.providerModelPreferences, instanceId);
    updateSettings({
      providerModelPreferences:
        hiddenModels.length === 0 && modelOrder.length === 0
          ? rest
          : {
              ...rest,
              [instanceId]: {
                hiddenModels,
                modelOrder,
              },
            },
    });
  };

  const updateProviderFavoriteModels = (
    instanceId: ProviderInstanceId,
    nextFavoriteModels: ReadonlyArray<string>,
  ) => {
    const favoriteModels = [
      ...new Set(
        Arr.filterMap(nextFavoriteModels, (slug) => {
          const trimmedSlug = slug.trim();
          return trimmedSlug.length > 0 ? Result.succeed(trimmedSlug) : Result.failVoid;
        }),
      ),
    ];
    updateSettings({
      favorites: [
        ...withoutProviderInstanceFavorites(settings.favorites ?? [], instanceId),
        ...favoriteModels.map((model) => ({ provider: instanceId, model })),
      ],
    });
  };

  const resetDefaultInstance = (driverKind: ProviderDriverKind) => {
    type LegacyProviderSettings = (typeof settings.providers)[keyof typeof settings.providers];
    const defaultLegacyProviders = DEFAULT_UNIFIED_SETTINGS.providers as Record<
      string,
      LegacyProviderSettings | undefined
    >;
    const defaultInstanceId = defaultInstanceIdForDriver(driverKind);
    const defaultLegacyProvider = defaultLegacyProviders[driverKind];
    if (defaultLegacyProvider === undefined) return;
    updateSettings({
      providers: {
        ...settings.providers,
        [driverKind]: defaultLegacyProvider,
      } as typeof settings.providers,
      providerInstances: withoutProviderInstanceKey(settings.providerInstances, defaultInstanceId),
      providerModelPreferences: withoutProviderInstanceKey(
        settings.providerModelPreferences,
        defaultInstanceId,
      ),
      favorites: withoutProviderInstanceFavorites(settings.favorites ?? [], defaultInstanceId),
    });
  };

  return (
    <SettingsPageContainer>
      <SettingsSection
        title="Providers"
        headerAction={
          <div className="flex items-center gap-1.5">
            <ProviderLastChecked lastCheckedAt={lastCheckedAt} />
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    className="size-5 rounded-sm p-0 text-muted-foreground hover:text-foreground"
                    onClick={() => setIsAddInstanceDialogOpen(true)}
                    aria-label="Add provider instance"
                  >
                    <PlusIcon className="size-3" />
                  </Button>
                }
              />
              <TooltipPopup side="top">Add provider instance</TooltipPopup>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    className="size-5 rounded-sm p-0 text-muted-foreground hover:text-foreground"
                    disabled={isRefreshingProviders}
                    onClick={() => void refreshProviders()}
                    aria-label="Refresh provider status"
                  >
                    {isRefreshingProviders ? (
                      <LoaderIcon className="size-3 animate-spin" />
                    ) : (
                      <RefreshCwIcon className="size-3" />
                    )}
                  </Button>
                }
              />
              <TooltipPopup side="top">Refresh provider status</TooltipPopup>
            </Tooltip>
          </div>
        }
      >
        {rows.map((row) => {
          const driverOption = getDriverOption(row.driver);
          const liveProvider = serverProviders.find(
            (candidate) => candidate.instanceId === row.instanceId,
          );
          const updateCandidate = liveProvider
            ? providerUpdateCandidateByInstanceId.get(liveProvider.instanceId)
            : undefined;
          const isDriverUpdateRunning =
            updateCandidate !== undefined &&
            (updatingProviderDrivers.has(updateCandidate.driver) ||
              serverProviders.some(
                (provider) =>
                  provider.driver === updateCandidate.driver && isProviderUpdateActive(provider),
              ));
          const showInlineUpdateButton =
            updateCandidate !== undefined &&
            hasOneClickUpdateProviderCandidate(updateCandidate, serverProviders);
          const canRunInlineUpdate =
            updateCandidate !== undefined &&
            canOneClickUpdateProviderCandidate(updateCandidate, serverProviders) &&
            !updatingProviderDrivers.has(updateCandidate.driver);
          const modelPreferences = settings.providerModelPreferences?.[row.instanceId] ?? {
            hiddenModels: [],
            modelOrder: [],
          };
          const favoriteModels = Arr.filterMap(settings.favorites ?? [], (favorite) =>
            favorite.provider === row.instanceId ? Result.succeed(favorite.model) : Result.failVoid,
          );
          const resetLabel = driverOption?.label ?? String(row.driver);
          const headerAction =
            row.isDefault && row.isDirty ? (
              <SettingResetButton
                label={`${resetLabel} provider settings`}
                onClick={() => resetDefaultInstance(row.driver)}
              />
            ) : null;
          return (
            <ProviderInstanceCard
              key={row.instanceId}
              instanceId={row.instanceId}
              instance={row.instance}
              driverOption={driverOption}
              liveProvider={liveProvider}
              isExpanded={openInstanceDetails[row.instanceId] ?? false}
              onExpandedChange={(open) =>
                setOpenInstanceDetails((existing) => ({
                  ...existing,
                  [row.instanceId]: open,
                }))
              }
              onUpdate={(next) => {
                const wasEnabled = row.instance.enabled ?? true;
                const isDisabling = next.enabled === false && wasEnabled;
                const shouldClearTextGen = isDisabling && textGenInstanceId === row.instanceId;
                if (shouldClearTextGen) {
                  updateProviderInstance(row, next, {
                    textGenerationModelSelection:
                      DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection,
                  });
                } else {
                  updateProviderInstance(row, next);
                }
              }}
              onDelete={row.isDefault ? undefined : () => deleteProviderInstance(row.instanceId)}
              headerAction={headerAction}
              hiddenModels={modelPreferences.hiddenModels}
              favoriteModels={favoriteModels}
              modelOrder={modelPreferences.modelOrder}
              onHiddenModelsChange={(hiddenModels) =>
                updateProviderModelPreferences(row.instanceId, {
                  ...modelPreferences,
                  hiddenModels,
                })
              }
              onFavoriteModelsChange={(favoriteModels) =>
                updateProviderFavoriteModels(row.instanceId, favoriteModels)
              }
              onModelOrderChange={(modelOrder) =>
                updateProviderModelPreferences(row.instanceId, {
                  ...modelPreferences,
                  modelOrder,
                })
              }
              onRunUpdate={
                showInlineUpdateButton && updateCandidate
                  ? () => {
                      if (!canRunInlineUpdate) {
                        return;
                      }
                      void runProviderUpdate(updateCandidate);
                    }
                  : undefined
              }
              isUpdating={showInlineUpdateButton ? isDriverUpdateRunning : undefined}
            />
          );
        })}
      </SettingsSection>

      {isAddInstanceDialogOpen ? (
        <AddProviderInstanceDialog open onOpenChange={setIsAddInstanceDialogOpen} />
      ) : null}
    </SettingsPageContainer>
  );
}

export function ArchivedThreadsPanel() {
  const projects = useProjects();
  const { unarchiveThread, confirmAndDeleteThread } = useThreadActions();
  const environmentIds = useMemo(
    () => [...new Set(projects.map((project) => project.environmentId))],
    [projects],
  );
  const {
    snapshots: archivedSnapshots,
    error: archiveError,
    isLoading: isLoadingArchive,
    refresh: refreshArchivedThreads,
  } = useArchivedThreadSnapshots(environmentIds);

  const archivedGroups = useMemo(() => {
    const projectsByEnvironmentAndId = new Map(
      archivedSnapshots.flatMap(({ environmentId, snapshot }) =>
        snapshot.projects.map(
          (project) =>
            [
              `${environmentId}:${project.id}`,
              {
                id: project.id,
                environmentId,
                name: project.title,
                cwd: project.workspaceRoot,
              },
            ] as const,
        ),
      ),
    );
    const threads = archivedSnapshots.flatMap(({ environmentId, snapshot }) =>
      snapshot.threads.map((thread) => ({
        ...thread,
        environmentId,
      })),
    );

    const archivedProjects = Array.from(projectsByEnvironmentAndId.values());
    const groups: Array<{
      readonly project: (typeof archivedProjects)[number];
      readonly threads: Array<(typeof threads)[number]>;
    }> = [];
    for (const project of archivedProjects) {
      const projectThreads: Array<(typeof threads)[number]> = [];
      for (const thread of threads) {
        if (thread.projectId === project.id && thread.environmentId === project.environmentId) {
          projectThreads.push(thread);
        }
      }
      if (projectThreads.length > 0) {
        groups.push({
          project,
          threads: projectThreads.toSorted((left, right) => {
            const leftKey = left.archivedAt ?? left.createdAt;
            const rightKey = right.archivedAt ?? right.createdAt;
            return rightKey.localeCompare(leftKey) || right.id.localeCompare(left.id);
          }),
        });
      }
    }
    return groups;
  }, [archivedSnapshots]);

  const handleArchivedThreadContextMenu = useCallback(
    async (threadRef: ScopedThreadRef, position: { x: number; y: number }) => {
      const api = readLocalApi();
      if (!api) return;
      const clicked = await api.contextMenu.show(
        [
          { id: "unarchive", label: "Unarchive" },
          { id: "delete", label: "Delete", destructive: true },
        ],
        position,
      );

      if (clicked === "unarchive") {
        const result = await unarchiveThread(threadRef);
        if (result._tag === "Success") {
          refreshArchivedThreads();
        } else if (!isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Failed to unarchive thread",
              description: error instanceof Error ? error.message : "An error occurred.",
            }),
          );
        }
        return;
      }

      if (clicked === "delete") {
        const result = await confirmAndDeleteThread(threadRef);
        if (result._tag === "Success") {
          refreshArchivedThreads();
        } else if (!isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Failed to delete thread",
              description: error instanceof Error ? error.message : "An error occurred.",
            }),
          );
        }
      }
    },
    [confirmAndDeleteThread, refreshArchivedThreads, unarchiveThread],
  );

  return (
    <SettingsPageContainer>
      {archivedGroups.length === 0 ? (
        <SettingsSection title="Archived threads">
          <SettingsRow
            title={
              <span className="inline-flex items-center gap-2">
                {isLoadingArchive ? (
                  <LoaderIcon className="size-3.5 animate-spin text-muted-foreground" />
                ) : (
                  <ArchiveIcon className="size-3.5 text-muted-foreground" />
                )}
                {isLoadingArchive
                  ? "Loading archived threads"
                  : archiveError
                    ? "Could not load archived threads"
                    : "No archived threads"}
              </span>
            }
            description={
              isLoadingArchive
                ? "Checking connected environments."
                : (archiveError ?? "Archived threads will appear here.")
            }
          />
        </SettingsSection>
      ) : (
        archivedGroups.map(({ project, threads: projectThreads }) => (
          <SettingsSection
            key={project.id}
            title={project.name}
            icon={<ProjectFavicon environmentId={project.environmentId} cwd={project.cwd} />}
          >
            {projectThreads.map((thread) => (
              <SettingsRow
                key={thread.id}
                onContextMenu={(event) => {
                  event.preventDefault();
                  void (async () => {
                    const result = await settlePromise(() =>
                      handleArchivedThreadContextMenu(
                        scopeThreadRef(thread.environmentId, thread.id),
                        {
                          x: event.clientX,
                          y: event.clientY,
                        },
                      ),
                    );
                    if (result._tag === "Failure") {
                      const error = squashAtomCommandFailure(result);
                      toastManager.add(
                        stackedThreadToast({
                          type: "error",
                          title: "Archived thread action failed",
                          description:
                            error instanceof Error ? error.message : "An error occurred.",
                        }),
                      );
                    }
                  })();
                }}
                title={thread.title}
                description={
                  <>
                    Archived {formatRelativeTimeLabel(thread.archivedAt ?? thread.createdAt)}
                    {" \u00b7 Created "}
                    {formatRelativeTimeLabel(thread.createdAt)}
                  </>
                }
                control={
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 shrink-0 cursor-pointer gap-1.5 px-2.5"
                    onClick={() => {
                      void (async () => {
                        const result = await unarchiveThread(
                          scopeThreadRef(thread.environmentId, thread.id),
                        );
                        if (result._tag === "Success") {
                          refreshArchivedThreads();
                          return;
                        }
                        if (!isAtomCommandInterrupted(result)) {
                          const error = squashAtomCommandFailure(result);
                          toastManager.add(
                            stackedThreadToast({
                              type: "error",
                              title: "Failed to unarchive thread",
                              description:
                                error instanceof Error ? error.message : "An error occurred.",
                            }),
                          );
                        }
                      })();
                    }}
                  >
                    <ArchiveX className="size-3.5" />
                    <span>Unarchive</span>
                  </Button>
                }
              />
            ))}
          </SettingsSection>
        ))
      )}
    </SettingsPageContainer>
  );
}
