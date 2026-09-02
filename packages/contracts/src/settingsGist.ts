import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";
import {
  GistSyncedClientSettings,
  GistSyncedServerSettings,
  SidebarAutoSettleAfterDays,
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

const LEGACY_AUTO_SETTLE_KEYS = ["sidebarAutoSettleAfterDays", "sidebarAutoSettleOnMerge"] as const;

const LegacyAutoSettleSettings = Schema.Struct({
  sidebarAutoSettleAfterDays: Schema.optionalKey(Schema.NullOr(SidebarAutoSettleAfterDays)),
  sidebarAutoSettleOnMerge: Schema.optionalKey(Schema.Boolean),
});

export const LegacySettingsGistDocument = Schema.Struct({
  settings: LegacyAutoSettleSettings,
  serverSettings: Schema.optionalKey(LegacyAutoSettleSettings),
});
export type LegacySettingsGistDocument = typeof LegacySettingsGistDocument.Type;

export function upgradeSettingsGistDocument(
  document: SettingsGistDocument,
  legacy: LegacySettingsGistDocument,
): { readonly document: SettingsGistDocument; readonly migrated: boolean } {
  const serverSettings: Record<string, unknown> = { ...document.serverSettings };
  let migrated = false;
  for (const key of LEGACY_AUTO_SETTLE_KEYS) {
    const value = legacy.settings[key];
    if (value === undefined) continue;
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

export class SettingsGistSyncError extends Schema.TaggedErrorClass<SettingsGistSyncError>()(
  "SettingsGistSyncError",
  {
    operation: Schema.Literals(["pull", "create", "update"]),
    message: Schema.String,
  },
) {}
