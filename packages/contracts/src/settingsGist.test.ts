import { describe, expect, it } from "@effect/vitest";

import * as Schema from "effect/Schema";

import {
  ClientSettingsSchema,
  DEFAULT_CLIENT_SETTINGS,
  DEFAULT_SERVER_SETTINGS,
  GIST_SYNCED_CLIENT_SETTING_KEYS,
  GIST_SYNCED_SERVER_SETTING_KEYS,
  LOCAL_ONLY_CLIENT_SETTING_KEYS,
  LOCAL_ONLY_SERVER_SETTING_KEYS,
  ServerSettings,
  selectGistSyncedClientSettings,
  selectGistSyncedServerSettings,
} from "./settings.ts";
import { SettingsGistDocument } from "./settingsGist.ts";

const decodeSettingsGistDocument = Schema.decodeUnknownSync(SettingsGistDocument);

describe("gist synced settings", () => {
  it("syncs every client setting that is not explicitly local-only", () => {
    const allKeys = Object.keys(ClientSettingsSchema.fields).sort();
    const partitioned = [
      ...GIST_SYNCED_CLIENT_SETTING_KEYS,
      ...LOCAL_ONLY_CLIENT_SETTING_KEYS,
    ].sort();
    expect(partitioned).toEqual(allKeys);
    expect(Object.keys(selectGistSyncedClientSettings(DEFAULT_CLIENT_SETTINGS)).sort()).toEqual(
      [...GIST_SYNCED_CLIENT_SETTING_KEYS].sort(),
    );
  });

  it("syncs every server setting that is not explicitly local-only", () => {
    const allKeys = Object.keys(ServerSettings.fields).sort();
    const partitioned = [
      ...GIST_SYNCED_SERVER_SETTING_KEYS,
      ...LOCAL_ONLY_SERVER_SETTING_KEYS,
    ].sort();
    expect(partitioned).toEqual(allKeys);
    const selected = selectGistSyncedServerSettings(DEFAULT_SERVER_SETTINGS);
    expect(Object.keys(selected).sort()).toEqual([...GIST_SYNCED_SERVER_SETTING_KEYS].sort());
    expect(selected).not.toHaveProperty("gistSettingsSync");
    expect(selected).not.toHaveProperty("providerInstances");
  });

  it("decodes documents written before a setting existed with that setting's default", () => {
    const decoded = decodeSettingsGistDocument({
      schemaVersion: 1,
      updatedAt: "2026-01-01T00:00:00.000Z",
      settings: { wordWrap: false },
      serverSettings: { newWorktreesStartFromOrigin: false },
    });
    expect(decoded.settings.wordWrap).toBe(false);
    expect(decoded.settings.timestampFormat).toBe(DEFAULT_CLIENT_SETTINGS.timestampFormat);
    expect(decoded.serverSettings.newWorktreesStartFromOrigin).toBe(false);
    expect(decoded.serverSettings.sidebarAutoSettleOnMerge).toBe(
      DEFAULT_SERVER_SETTINGS.sidebarAutoSettleOnMerge,
    );
    expect(decoded.serverSettings).not.toHaveProperty("gistSettingsSync");
  });
});
