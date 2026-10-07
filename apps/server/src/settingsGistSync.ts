import {
  LegacySettingsGistDocument,
  SETTINGS_GIST_FILENAME,
  SettingsGistId,
  SettingsGistDocument,
  SettingsGistSyncError,
  upgradeSettingsGistDocument,
  type GistSyncedClientSettings,
  type GistSyncedServerSettings,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as GitHubApi from "./sourceControl/GitHubApi.ts";

const GistFile = Schema.Struct({
  content: Schema.String,
});

const GistResponse = Schema.Struct({
  id: SettingsGistId,
  files: Schema.Record(Schema.String, GistFile),
  history: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        version: Schema.String,
      }),
    ),
  ),
});

const decodeGistResponse = Schema.decodeUnknownEffect(Schema.fromJsonString(GistResponse));
const decodeSettingsDocument = Schema.decodeUnknownEffect(
  Schema.fromJsonString(SettingsGistDocument),
);
const decodeLegacySettingsDocument = Schema.decodeUnknownEffect(
  Schema.fromJsonString(LegacySettingsGistDocument),
);
const encodeSettingsDocument = Schema.encodeEffect(Schema.fromJsonString(SettingsGistDocument));

const GIST_HOST = "github.com";

function commandError(operation: "pull" | "create" | "update", error: GitHubApi.GitHubApiError) {
  return new SettingsGistSyncError({ operation, message: error.message });
}

function invalidGistError(message: string) {
  return new SettingsGistSyncError({ operation: "pull", message });
}

export const pullSettingsGist = Effect.fn("settingsGistSync.pull")(function* (input: {
  readonly api: GitHubApi.GitHubApi["Service"];
  readonly gistId: string;
}) {
  const output = yield* input.api
    .rest({
      host: GIST_HOST,
      operation: "pullSettingsGist",
      path: `gists/${encodeURIComponent(input.gistId)}`,
    })
    .pipe(Effect.mapError((error) => commandError("pull", error)));
  const response = yield* decodeGistResponse(output.body).pipe(
    Effect.mapError(() => invalidGistError("GitHub returned an invalid Gist response.")),
  );
  const file = response.files[SETTINGS_GIST_FILENAME];
  if (!file) {
    return yield* invalidGistError(`The Gist does not contain ${SETTINGS_GIST_FILENAME}.`);
  }
  const document = yield* decodeSettingsDocument(file.content).pipe(
    Effect.mapError(() => invalidGistError(`${SETTINGS_GIST_FILENAME} is invalid or unsupported.`)),
  );
  const legacy = yield* decodeLegacySettingsDocument(file.content).pipe(
    Effect.orElseSucceed((): LegacySettingsGistDocument => ({ settings: {} })),
  );
  const upgraded = upgradeSettingsGistDocument(document, legacy);
  const lastSyncedAt = DateTime.formatIso(yield* DateTime.now);
  return {
    gistId: response.id,
    lastSyncedAt,
    revision: response.history?.[0]?.version || document.updatedAt,
    settings: upgraded.document.settings,
    serverSettings: upgraded.document.serverSettings,
    migrated: upgraded.migrated,
  };
});

export const pushSettingsGist = Effect.fn("settingsGistSync.push")(function* (input: {
  readonly api: GitHubApi.GitHubApi["Service"];
  readonly gistId: string;
  readonly settings: GistSyncedClientSettings;
  readonly serverSettings: GistSyncedServerSettings;
}) {
  const lastSyncedAt = DateTime.formatIso(yield* DateTime.now);
  const content = yield* encodeSettingsDocument({
    schemaVersion: 1,
    updatedAt: lastSyncedAt,
    settings: input.settings,
    serverSettings: input.serverSettings,
  }).pipe(
    Effect.mapError(
      () =>
        new SettingsGistSyncError({
          operation: input.gistId ? "update" : "create",
          message: "Could not encode T3 Code settings for Gist sync.",
        }),
    ),
  );
  const operation = input.gistId ? "update" : "create";
  const output = yield* input.api
    .rest({
      host: GIST_HOST,
      operation: input.gistId ? "updateSettingsGist" : "createSettingsGist",
      method: input.gistId ? "PATCH" : "POST",
      path: input.gistId ? `gists/${encodeURIComponent(input.gistId)}` : "gists",
      body: {
        ...(input.gistId ? {} : { description: "T3 Code settings sync", public: false }),
        files: { [SETTINGS_GIST_FILENAME]: { content } },
      },
    })
    .pipe(Effect.mapError((error) => commandError(operation, error)));
  const response = yield* decodeGistResponse(output.body).pipe(
    Effect.mapError(
      () =>
        new SettingsGistSyncError({
          operation,
          message: "GitHub returned an invalid Gist response.",
        }),
    ),
  );
  return {
    gistId: response.id,
    lastSyncedAt,
    revision: response.history?.[0]?.version || lastSyncedAt,
    settings: input.settings,
    serverSettings: input.serverSettings,
  };
});
