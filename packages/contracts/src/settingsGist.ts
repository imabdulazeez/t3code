import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";
import {
  GistSyncedClientSettings,
  GistSyncedServerSettings,
  SidebarAutoSettleAfterDays,
  ModelFavorites,
  ProviderModelPreferences,
} from "./settings.ts";

export const SETTINGS_GIST_FILENAME = "t3code-settings.json";
export const SettingsGistId = TrimmedNonEmptyString.check(Schema.isPattern(/^[a-f0-9]+$/i));
export type SettingsGistId = typeof SettingsGistId.Type;

export const SettingsGistDocument = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  updatedAt: TrimmedNonEmptyString,
  settings: GistSyncedClientSettings,
  serverSettings: GistSyncedServerSettings,
});
export type SettingsGistDocument = typeof SettingsGistDocument.Type;

const LEGACY_SERVER_SETTING_KEYS = [
  "sidebarAutoSettleAfterDays",
  "sidebarAutoSettleOnMerge",
  "favorites",
  "providerModelPreferences",
] as const;

const LegacySyncedSettings = Schema.Struct({
  sidebarAutoSettleAfterDays: Schema.optionalKey(Schema.NullOr(SidebarAutoSettleAfterDays)),
  sidebarAutoSettleOnMerge: Schema.optionalKey(Schema.Boolean),
  favorites: Schema.optionalKey(Schema.NullOr(ModelFavorites)),
  providerModelPreferences: Schema.optionalKey(Schema.NullOr(ProviderModelPreferences)),
});

export const LegacySettingsGistDocument = Schema.Struct({
  settings: LegacySyncedSettings,
  serverSettings: Schema.optionalKey(LegacySyncedSettings),
});
export type LegacySettingsGistDocument = typeof LegacySettingsGistDocument.Type;

export function upgradeSettingsGistDocument(
  document: SettingsGistDocument,
  legacy: LegacySettingsGistDocument,
): { readonly document: SettingsGistDocument; readonly migrated: boolean } {
  const serverSettings: Record<string, unknown> = { ...document.serverSettings };
  let migrated = false;
  for (const key of LEGACY_SERVER_SETTING_KEYS) {
    const value = legacy.settings[key];
    if (
      value === undefined ||
      (value === null && (key === "favorites" || key === "providerModelPreferences"))
    )
      continue;
    migrated = true;
    if (legacy.serverSettings?.[key] === undefined) serverSettings[key] = value;
  }
  if (!migrated) return { document, migrated };
  return {
    document: { ...document, serverSettings: serverSettings as GistSyncedServerSettings },
    migrated,
  };
}

export const SettingsGistPullInput = Schema.Struct({
  gistId: SettingsGistId,
});
export type SettingsGistPullInput = typeof SettingsGistPullInput.Type;

export const SettingsGistPushInput = Schema.Struct({
  gistId: Schema.Union([Schema.Literal(""), SettingsGistId]),
  settings: GistSyncedClientSettings,
  serverSettings: GistSyncedServerSettings,
});
export type SettingsGistPushInput = typeof SettingsGistPushInput.Type;

export const SettingsGistSyncResult = Schema.Struct({
  gistId: SettingsGistId,
  lastSyncedAt: TrimmedNonEmptyString,
  revision: TrimmedNonEmptyString,
  settings: GistSyncedClientSettings,
  serverSettings: GistSyncedServerSettings,
  migrated: Schema.optionalKey(Schema.Boolean),
});
export type SettingsGistSyncResult = typeof SettingsGistSyncResult.Type;

export class SettingsGistSyncError extends Schema.TaggedError<SettingsGistSyncError>()(
  "SettingsGistSyncError",
  {
    operation: Schema.Literals(["pull", "create", "update"]),
    message: Schema.String,
  },
) {}
