import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as DesktopConfig from "../app/DesktopConfig.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import {
  DEFAULT_DESKTOP_SETTINGS,
  type DesktopSettings as DesktopSettingsValue,
} from "./DesktopAppSettings.ts";
import * as DesktopAppSettings from "./DesktopAppSettings.ts";

const DesktopSettingsPatch = Schema.Struct({
  serverExposureMode: Schema.optionalKey(Schema.Literals(["local-only", "network-accessible"])),
  tailscaleServeEnabled: Schema.optionalKey(Schema.Boolean),
  tailscaleServePort: Schema.optionalKey(Schema.Number),
});

const decodeDesktopSettingsPatch = Schema.decodeEffect(Schema.fromJsonString(DesktopSettingsPatch));
const encodeDesktopSettingsPatch = Schema.encodeEffect(Schema.fromJsonString(DesktopSettingsPatch));

function makeEnvironmentLayer(baseDir: string, appVersion = "0.0.17") {
  return DesktopEnvironment.layer({
    dirname: "/repo/apps/desktop/src",
    homeDirectory: baseDir,
    platform: "darwin",
    processArch: "x64",
    appVersion,
    appPath: "/repo",
    isPackaged: true,
    resourcesPath: "/missing/resources",
    runningUnderArm64Translation: false,
    buildTimestamp: "20260508-1430",
  }).pipe(
    Layer.provide(
      Layer.mergeAll(NodeServices.layer, DesktopConfig.layerTest({ T3CODE_HOME: baseDir })),
    ),
  );
}

const withSettings = <A, E, R>(
  effect: Effect.Effect<
    A,
    E,
    R | DesktopAppSettings.DesktopAppSettings | DesktopEnvironment.DesktopEnvironment
  >,
  options?: { readonly appVersion?: string },
) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const baseDir = yield* fileSystem.makeTempDirectoryScoped({
      prefix: "t3-desktop-settings-test-",
    });
    return yield* effect.pipe(
      Effect.provide(
        DesktopAppSettings.layer.pipe(
          Layer.provideMerge(makeEnvironmentLayer(baseDir, options?.appVersion)),
          Layer.provideMerge(NodeServices.layer),
        ),
      ),
    );
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped);

function writeSettingsPatch(patch: typeof DesktopSettingsPatch.Type) {
  return Effect.gen(function* () {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    const fileSystem = yield* FileSystem.FileSystem;
    const encoded = yield* encodeDesktopSettingsPatch(patch);
    yield* fileSystem.makeDirectory(environment.stateDir, { recursive: true });
    yield* fileSystem.writeFileString(environment.desktopSettingsPath, `${encoded}\n`);
  });
}

describe("DesktopSettings", () => {
  it.effect("loads defaults when no settings file exists", () =>
    withSettings(
      Effect.gen(function* () {
        const settings = yield* DesktopAppSettings.DesktopAppSettings;
        assert.deepEqual(yield* settings.load, DEFAULT_DESKTOP_SETTINGS);
        assert.deepEqual(yield* settings.get, DEFAULT_DESKTOP_SETTINGS);
      }),
    ),
  );

  it.effect("loads persisted settings and applies semantic updates", () =>
    withSettings(
      Effect.gen(function* () {
        const settings = yield* DesktopAppSettings.DesktopAppSettings;
        yield* writeSettingsPatch({
          serverExposureMode: "network-accessible",
          tailscaleServeEnabled: true,
          tailscaleServePort: 8443,
        });

        assert.deepEqual(yield* settings.load, {
          serverExposureMode: "network-accessible",
          tailscaleServeEnabled: true,
          tailscaleServePort: 8443,
        } satisfies DesktopSettingsValue);

        const exposure = yield* settings.setServerExposureMode("local-only");
        assert.isTrue(exposure.changed);
        assert.equal(exposure.settings.serverExposureMode, "local-only");

        const tailscale = yield* settings.setTailscaleServe({
          enabled: true,
          port: Option.some(9443),
        });
        assert.isTrue(tailscale.changed);
        assert.equal(tailscale.settings.tailscaleServePort, 9443);
      }),
    ),
  );

  it.effect("does not persist no-op semantic updates", () =>
    withSettings(
      Effect.gen(function* () {
        const settings = yield* DesktopAppSettings.DesktopAppSettings;

        const exposure = yield* settings.setServerExposureMode("local-only");
        assert.isFalse(exposure.changed);

        const tailscale = yield* settings.setTailscaleServe({
          enabled: false,
          port: Option.none(),
        });
        assert.isFalse(tailscale.changed);
      }),
    ),
  );

  it.effect("falls back to defaults when the settings file is malformed", () =>
    withSettings(
      Effect.gen(function* () {
        const environment = yield* DesktopEnvironment.DesktopEnvironment;
        const fileSystem = yield* FileSystem.FileSystem;
        const settings = yield* DesktopAppSettings.DesktopAppSettings;
        yield* fileSystem.makeDirectory(environment.stateDir, { recursive: true });
        yield* fileSystem.writeFileString(environment.desktopSettingsPath, "{not-json");

        assert.deepEqual(yield* settings.load, DEFAULT_DESKTOP_SETTINGS);
      }),
    ),
  );

  it.effect("loads lenient persisted desktop settings JSON", () =>
    withSettings(
      Effect.gen(function* () {
        const environment = yield* DesktopEnvironment.DesktopEnvironment;
        const fileSystem = yield* FileSystem.FileSystem;
        const settings = yield* DesktopAppSettings.DesktopAppSettings;
        yield* fileSystem.makeDirectory(environment.stateDir, { recursive: true });
        yield* fileSystem.writeFileString(
          environment.desktopSettingsPath,
          `{
            // JSONC-style comments and trailing commas match server settings parsing.
            "serverExposureMode": "network-accessible",
            "tailscaleServeEnabled": true,
            "tailscaleServePort": 8443,
          }\n`,
        );

        assert.deepEqual(yield* settings.load, {
          serverExposureMode: "network-accessible",
          tailscaleServeEnabled: true,
          tailscaleServePort: 8443,
        } satisfies DesktopSettingsValue);
      }),
    ),
  );

  it.effect("persists sparse desktop settings documents", () =>
    withSettings(
      Effect.gen(function* () {
        const environment = yield* DesktopEnvironment.DesktopEnvironment;
        const fileSystem = yield* FileSystem.FileSystem;
        const settings = yield* DesktopAppSettings.DesktopAppSettings;

        yield* settings.setServerExposureMode("network-accessible");

        const persisted = yield* decodeDesktopSettingsPatch(
          yield* fileSystem.readFileString(environment.desktopSettingsPath),
        );
        assert.deepEqual(persisted, {
          serverExposureMode: "network-accessible",
        } satisfies typeof DesktopSettingsPatch.Type);
      }),
    ),
  );

  it.effect("normalizes invalid persisted Tailscale Serve ports", () =>
    withSettings(
      Effect.gen(function* () {
        const settings = yield* DesktopAppSettings.DesktopAppSettings;
        yield* writeSettingsPatch({
          tailscaleServeEnabled: true,
          tailscaleServePort: 0,
        });

        assert.deepEqual(yield* settings.load, {
          serverExposureMode: "local-only",
          tailscaleServeEnabled: true,
          tailscaleServePort: 443,
        } satisfies DesktopSettingsValue);
      }),
    ),
  );
});
