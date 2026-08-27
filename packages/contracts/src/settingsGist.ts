import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";
import { GistSyncedClientSettings, GistSyncedServerSettings } from "./settings.ts";

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
});
export type SettingsGistSyncResult = typeof SettingsGistSyncResult.Type;

export class SettingsGistSyncError extends Schema.TaggedErrorClass<SettingsGistSyncError>()(
  "SettingsGistSyncError",
  {
    operation: Schema.Literals(["pull", "create", "update"]),
    message: Schema.String,
  },
) {}
