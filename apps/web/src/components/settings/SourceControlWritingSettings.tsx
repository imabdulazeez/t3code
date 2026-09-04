import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import type { ProviderInstanceId, SourceControlWritingStyleMode } from "@t3tools/contracts";
import {
  DEFAULT_BRANCH_NAME_PROMPT_INSTRUCTIONS,
  DEFAULT_COMMIT_MESSAGE_PROMPT_INSTRUCTIONS,
  DEFAULT_PR_CONTENT_PROMPT_INSTRUCTIONS,
  DEFAULT_UNIFIED_SETTINGS,
} from "@t3tools/contracts/settings";
import { createModelSelection } from "@t3tools/shared/model";
import { resolveSourceControlWriterModelSelection } from "@t3tools/shared/serverSettings";

import { usePrimarySettings, useUpdatePrimarySettings } from "../../hooks/useSettings";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "../../providerInstances";
import {
  getCustomModelOptionsByInstance,
  resolveAppModelSelectionState,
} from "../../modelSelection";
import { primaryServerProvidersAtom } from "../../state/server";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import {
  SETTINGS_PICKER_TRIGGER_CLASSNAME,
  SettingResetButton,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

const MODE_OPTIONS: Record<SourceControlWritingStyleMode, { label: string; description: string }> =
  {
    repo_conventions: {
      label: "Repository conventions",
      description: "In each project, matches recent change descriptions and change request titles.",
    },
    conventional_commits: {
      label: "Conventional Commits",
      description: "Use Conventional Commit prefixes and keep change request text concise.",
    },
    custom: {
      label: "Custom instructions",
      description:
        "Use your instructions for change descriptions and change requests in every project.",
    },
  };

export function SourceControlWritingSettingsSection() {
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();
  const navigate = useNavigate();
  const environmentId = usePrimaryEnvironmentId();
  const serverProviders = useAtomValue(primaryServerProvidersAtom);
  const customInstructionsRef = useRef<HTMLTextAreaElement>(null);
  const style = settings.sourceControlWritingStyle;
  const defaults = DEFAULT_UNIFIED_SETTINGS.sourceControlWritingStyle;
  const isSourceControlWritingStyleDirty =
    style.mode !== defaults.mode || style.customInstructions !== defaults.customInstructions;
  const styleInstructionsOverridden =
    settings.commitMessagePromptInstructions.length > 0 &&
    settings.prContentPromptInstructions.length > 0;

  const textGenerationProviders = serverProviders.filter(
    (provider) => provider.supportsTextGeneration !== false,
  );
  const defaultModelSelection = resolveAppModelSelectionState(settings, textGenerationProviders);
  const usesDedicatedModel = settings.sourceControlWriterModelSelection !== null;
  const activeSelection = resolveAppModelSelectionState(
    {
      ...settings,
      textGenerationModelSelection: resolveSourceControlWriterModelSelection(
        settings,
        textGenerationProviders,
      ),
    },
    textGenerationProviders,
  );
  const instanceEntries = sortProviderInstanceEntries(
    applyProviderInstanceSettings(deriveProviderInstanceEntries(textGenerationProviders), settings),
  );
  const canEnableDedicatedModel = instanceEntries.some(
    (entry) =>
      entry.instanceId === defaultModelSelection.instanceId && entry.enabled && entry.isAvailable,
  );
  const modelOptionsByInstance = getCustomModelOptionsByInstance(
    settings,
    textGenerationProviders,
    activeSelection.instanceId,
    activeSelection.model,
  );

  return (
    <SettingsSection id="source-control-text-generation" title="Text generation">
      <SettingsRow
        serverScoped
        {...searchableSetting("source-control-writing-style")}
        description={
          styleInstructionsOverridden
            ? style.mode === "repo_conventions"
              ? "Custom commit message and PR content prompts below replace these instructions. This mode still supplies the repository's recent commit subjects as examples."
              : "Custom commit message and PR content prompts below replace these instructions, so this setting has no effect."
            : MODE_OPTIONS[style.mode].description
        }
        resetAction={
          isSourceControlWritingStyleDirty ? (
            <SettingResetButton
              label="source control writing style"
              onClick={() =>
                updateSettings({
                  sourceControlWritingStyle: {
                    mode: defaults.mode,
                    customInstructions: defaults.customInstructions,
                  },
                })
              }
            />
          ) : null
        }
        control={
          <Select
            value={style.mode}
            onValueChange={(value) => {
              const customInstructions = customInstructionsRef.current?.value.trim();
              updateSettings({
                sourceControlWritingStyle: {
                  mode: value as SourceControlWritingStyleMode,
                  ...(customInstructions !== undefined ? { customInstructions } : {}),
                },
              });
            }}
          >
            <SelectTrigger
              size="sm"
              className="w-full sm:w-56"
              aria-label="Source control writing style"
            >
              <SelectValue>{MODE_OPTIONS[style.mode].label}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {(Object.keys(MODE_OPTIONS) as SourceControlWritingStyleMode[]).map((mode) => (
                <SelectItem key={mode} hideIndicator value={mode}>
                  {MODE_OPTIONS[mode].label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      >
        {style.mode === "custom" ? (
          <div className="mt-3 max-w-2xl pb-3.5">
            <Textarea
              key={style.customInstructions}
              ref={customInstructionsRef}
              defaultValue={style.customInstructions}
              onBlur={(event) => {
                const customInstructions = event.target.value.trim();
                if (customInstructions !== style.customInstructions) {
                  updateSettings({ sourceControlWritingStyle: { customInstructions } });
                }
              }}
              rows={4}
              placeholder="Keep titles concise. Use short bullet points in descriptions."
              aria-label="Custom source control writing instructions"
            />
          </div>
        ) : null}
      </SettingsRow>

      <SettingsRow
        serverScoped
        {...searchableSetting("follow-change-request-templates")}
        description="Use the repository's template for change request descriptions when available."
        resetAction={
          style.followChangeRequestTemplates !== defaults.followChangeRequestTemplates ? (
            <SettingResetButton
              label="change request templates"
              onClick={() =>
                updateSettings({
                  sourceControlWritingStyle: {
                    followChangeRequestTemplates: defaults.followChangeRequestTemplates,
                  },
                })
              }
            />
          ) : null
        }
        control={
          <Switch
            checked={style.followChangeRequestTemplates}
            onCheckedChange={(checked) =>
              updateSettings({
                sourceControlWritingStyle: {
                  followChangeRequestTemplates: Boolean(checked),
                },
              })
            }
            aria-label="Follow change request templates"
          />
        }
      />

      <SettingsRow
        serverScoped
        {...searchableSetting("source-control-writer-model")}
        description="Model for source control text and branch or bookmark names. Off uses the global default."
        control={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {usesDedicatedModel && !canEnableDedicatedModel ? (
              <span className="text-sm text-muted-foreground">
                No text generation providers available.
              </span>
            ) : null}
            {usesDedicatedModel && canEnableDedicatedModel ? (
              <ProviderModelPicker
                activeInstanceId={activeSelection.instanceId}
                model={activeSelection.model}
                lockedProvider={null}
                instanceEntries={instanceEntries}
                modelOptionsByInstance={modelOptionsByInstance}
                triggerVariant="outline"
                triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
                triggerAriaLabel="Source control writer model"
                {...(environmentId
                  ? {
                      onOpenProviderSetup: (instanceId: ProviderInstanceId) => {
                        void navigate({
                          to: "/settings/providers",
                          search: { environmentId, instanceId },
                        });
                      },
                    }
                  : {})}
                onInstanceModelChange={(instanceId, model) => {
                  updateSettings({
                    sourceControlWriterModelSelection: createModelSelection(instanceId, model),
                  });
                }}
              />
            ) : null}
            <Switch
              checked={usesDedicatedModel}
              disabled={!usesDedicatedModel && !canEnableDedicatedModel}
              onCheckedChange={(checked) =>
                updateSettings({
                  sourceControlWriterModelSelection: checked
                    ? createModelSelection(
                        defaultModelSelection.instanceId,
                        defaultModelSelection.model,
                        defaultModelSelection.options,
                      )
                    : null,
                })
              }
              aria-label="Use a separate source control writer model"
            />
          </div>
        }
      />

      <div className="border-t border-border/60 px-4 pt-4 pb-2 sm:px-5">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-foreground/60">
          Version control prompts
        </h3>
        <p className="mt-1 text-xs text-muted-foreground/80">
          Replace the default natural-language instructions used by version-control text generation.
          A custom prompt replaces the writing style's instructions above; the JSON output format,
          dynamic context (diff, branch, etc.), repository examples, and change request templates
          still apply. Leave empty to use the built-in instructions.
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
  );
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
