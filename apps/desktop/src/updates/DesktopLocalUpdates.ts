import type { DesktopLocalUpdateBuild, DesktopLocalUpdateState } from "@t3tools/contracts";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopAppSettings from "../settings/DesktopAppSettings.ts";
import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import * as IpcChannels from "../ipc/channels.ts";

const STARTUP_DELAY = "15 seconds";
const POLL_INTERVAL = "4 minutes";
const BUILD_FILE_PATTERN = /^T3-Code-(.+)-(arm64|x64|universal)-(\d{8}-\d{4})\.zip$/;

interface LocalBuildCandidate extends DesktopLocalUpdateBuild {
  readonly path: string;
  readonly arch: "arm64" | "x64" | "universal";
}

export class DesktopLocalUpdateOperationError extends Schema.TaggedErrorClass<DesktopLocalUpdateOperationError>()(
  "DesktopLocalUpdateOperationError",
  {
    operation: Schema.Literals(["scan", "prepare", "launch", "persist"]),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Local desktop update ${this.operation} failed.`;
  }
}

function supportsArch(candidate: LocalBuildCandidate, hostArch: string): boolean {
  return candidate.arch === "universal" || candidate.arch === hostArch;
}

export class DesktopLocalUpdates extends Context.Service<
  DesktopLocalUpdates,
  {
    readonly getState: Effect.Effect<DesktopLocalUpdateState>;
    readonly configure: Effect.Effect<void, never, Scope.Scope>;
    readonly setFolder: (folderPath: string | null) => Effect.Effect<DesktopLocalUpdateState>;
    readonly check: Effect.Effect<DesktopLocalUpdateState>;
    readonly install: Effect.Effect<DesktopLocalUpdateState>;
  }
>()("@t3tools/desktop/updates/DesktopLocalUpdates") {}

export const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const appSettings = yield* DesktopAppSettings.DesktopAppSettings;
  const electronApp = yield* ElectronApp.ElectronApp;
  const electronWindow = yield* ElectronWindow.ElectronWindow;
  const fileSystem = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const supported = environment.platform === "darwin" && environment.isPackaged;
  const stateRef = yield* Ref.make<DesktopLocalUpdateState>({
    supported,
    folderPath: null,
    currentVersion: environment.appVersion,
    currentBuildTimestamp: environment.buildTimestamp,
    status: supported ? "idle" : "disabled",
    availableBuild: null,
    checkedAt: null,
    message: supported ? null : "Local desktop updates require a packaged macOS build.",
  });
  const candidateRef = yield* Ref.make<LocalBuildCandidate | null>(null);
  const checkingRef = yield* Ref.make(false);

  const setState = (state: DesktopLocalUpdateState) =>
    Ref.set(stateRef, state).pipe(
      Effect.andThen(electronWindow.sendAll(IpcChannels.LOCAL_UPDATE_STATE_CHANNEL, state)),
      Effect.as(state),
    );

  const runFile = Effect.fn("desktop.localUpdates.runFile")(function* (
    command: string,
    args: readonly string[],
  ) {
    return yield* spawner
      .string(ChildProcess.make(command, args, { stdin: "ignore", stderr: "pipe" }))
      .pipe(
        Effect.map((output) => output.trim()),
        Effect.mapError(
          (cause) => new DesktopLocalUpdateOperationError({ operation: "prepare", cause }),
        ),
      );
  });

  const prepareUpdate = Effect.fn("desktop.localUpdates.prepare")(function* (
    archivePath: string,
    currentBundlePath: string,
  ) {
    const parentPath = environment.path.dirname(currentBundlePath);
    const temporaryRoot = yield* fileSystem
      .makeTempDirectory({ directory: parentPath, prefix: ".t3-code-update-" })
      .pipe(
        Effect.mapError(
          (cause) => new DesktopLocalUpdateOperationError({ operation: "prepare", cause }),
        ),
      );
    return yield* Effect.gen(function* () {
      yield* runFile("/usr/bin/ditto", ["-x", "-k", archivePath, temporaryRoot]);
      const entries = yield* fileSystem
        .readDirectory(temporaryRoot)
        .pipe(
          Effect.mapError(
            (cause) => new DesktopLocalUpdateOperationError({ operation: "prepare", cause }),
          ),
        );
      const appName = entries.find((entry) => entry.endsWith(".app"));
      if (!appName) {
        return yield* new DesktopLocalUpdateOperationError({
          operation: "prepare",
          cause: "The update archive does not contain a macOS app bundle.",
        });
      }
      const stagedBundlePath = environment.path.join(temporaryRoot, appName);
      const currentIdentifier = yield* runFile("/usr/bin/defaults", [
        "read",
        environment.path.join(currentBundlePath, "Contents", "Info"),
        "CFBundleIdentifier",
      ]);
      const stagedIdentifier = yield* runFile("/usr/bin/defaults", [
        "read",
        environment.path.join(stagedBundlePath, "Contents", "Info"),
        "CFBundleIdentifier",
      ]);
      if (currentIdentifier.length === 0 || stagedIdentifier !== currentIdentifier) {
        return yield* new DesktopLocalUpdateOperationError({
          operation: "prepare",
          cause: "The update build does not match this application.",
        });
      }
      return { stagedBundlePath, temporaryRoot };
    }).pipe(
      Effect.catch((error) =>
        fileSystem
          .remove(temporaryRoot, { recursive: true, force: true })
          .pipe(Effect.ignore, Effect.andThen(Effect.fail(error))),
      ),
    );
  });

  const launchInstaller = Effect.fn("desktop.localUpdates.launchInstaller")(function* (input: {
    readonly stagedBundlePath: string;
    readonly temporaryRoot: string;
    readonly currentBundlePath: string;
  }) {
    const backupPath = `${input.currentBundlePath}.previous-${process.pid}`;
    const script = [
      'while kill -0 "$1" 2>/dev/null; do sleep 0.2; done',
      'if mv "$3" "$4" && mv "$2" "$3"; then',
      '  /usr/bin/open "$3"',
      '  /bin/rm -rf "$4" "$5"',
      "else",
      '  if [ ! -e "$3" ] && [ -e "$4" ]; then mv "$4" "$3"; fi',
      '  /usr/bin/open "$3"',
      "fi",
    ].join("\n");
    return yield* spawner
      .spawn(
        ChildProcess.make(
          "/bin/sh",
          [
            "-c",
            script,
            "t3-code-local-updater",
            String(process.pid),
            input.stagedBundlePath,
            input.currentBundlePath,
            backupPath,
            input.temporaryRoot,
          ],
          { detached: true, stdin: "ignore", stdout: "ignore", stderr: "ignore" },
        ),
      )
      .pipe(
        Effect.flatMap((handle) => handle.unref),
        Effect.scoped,
        Effect.mapError(
          (cause) => new DesktopLocalUpdateOperationError({ operation: "launch", cause }),
        ),
      );
  });

  const check = Effect.gen(function* () {
    if (yield* Ref.get(checkingRef)) return yield* Ref.get(stateRef);
    const settings = yield* appSettings.get;
    const folderPath = settings.localUpdateFolderPath ?? null;
    const current = yield* Ref.get(stateRef);
    if (!supported || folderPath === null) {
      yield* Ref.set(candidateRef, null);
      return yield* setState({
        ...current,
        folderPath,
        status: supported ? "idle" : "disabled",
        availableBuild: null,
        message: supported ? null : current.message,
      });
    }
    yield* Ref.set(checkingRef, true);
    yield* setState({ ...current, folderPath, status: "checking", message: null });
    return yield* fileSystem.readDirectory(folderPath).pipe(
      Effect.map((entries) => {
        const candidates = entries.flatMap((fileName): readonly LocalBuildCandidate[] => {
          const match = BUILD_FILE_PATTERN.exec(fileName);
          if (!match?.[1] || !match[2] || !match[3]) return [];
          const candidate: LocalBuildCandidate = {
            path: environment.path.join(folderPath, fileName),
            fileName,
            version: match[1],
            arch: match[2] as LocalBuildCandidate["arch"],
            buildTimestamp: match[3],
          };
          return supportsArch(candidate, environment.runtimeInfo.hostArch) ? [candidate] : [];
        });
        return (
          candidates
            .filter((candidate) => candidate.buildTimestamp > environment.buildTimestamp)
            .sort((left, right) => right.buildTimestamp.localeCompare(left.buildTimestamp))[0] ??
          null
        );
      }),
      Effect.mapError(
        (cause) => new DesktopLocalUpdateOperationError({ operation: "scan", cause }),
      ),
      Effect.flatMap((candidate) =>
        Effect.gen(function* () {
          const checkedAt = yield* DateTime.now.pipe(Effect.map(DateTime.formatIso));
          yield* Ref.set(candidateRef, candidate);
          return yield* setState({
            ...current,
            folderPath,
            status: candidate ? "available" : "idle",
            availableBuild: candidate,
            checkedAt,
            message: candidate ? null : "No newer compatible build was found.",
          });
        }),
      ),
      Effect.catch((error) =>
        DateTime.now.pipe(
          Effect.map(DateTime.formatIso),
          Effect.flatMap((checkedAt) =>
            setState({
              ...current,
              folderPath,
              status: "error",
              availableBuild: null,
              checkedAt,
              message: error.message,
            }),
          ),
        ),
      ),
      Effect.ensuring(Ref.set(checkingRef, false)),
    );
  }).pipe(Effect.withSpan("desktop.localUpdates.check"));

  return DesktopLocalUpdates.of({
    getState: Ref.get(stateRef),
    configure: Effect.gen(function* () {
      const settings = yield* appSettings.get;
      yield* setState({
        ...(yield* Ref.get(stateRef)),
        folderPath: settings.localUpdateFolderPath ?? null,
      });
      yield* Effect.sleep(STARTUP_DELAY);
      yield* check;
      return yield* Effect.sleep(POLL_INTERVAL).pipe(Effect.andThen(check), Effect.forever);
    }).pipe(Effect.forkScoped, Effect.asVoid),
    setFolder: (folderPath) => {
      const persist = appSettings.setLocalUpdateFolderPath;
      if (!persist) {
        return Ref.get(stateRef).pipe(
          Effect.flatMap((current) =>
            setState({
              ...current,
              status: "error",
              message: "Local update settings are unavailable.",
            }),
          ),
        );
      }
      return persist(folderPath).pipe(
        Effect.mapError(
          (cause) => new DesktopLocalUpdateOperationError({ operation: "persist", cause }),
        ),
        Effect.andThen(check),
        Effect.catch((error) =>
          Ref.get(stateRef).pipe(
            Effect.flatMap((current) =>
              setState({ ...current, status: "error", message: error.message }),
            ),
          ),
        ),
      );
    },
    check,
    install: Effect.gen(function* () {
      const candidate = yield* Ref.get(candidateRef);
      const current = yield* Ref.get(stateRef);
      if (!supported || candidate === null || current.status !== "available") return current;
      const currentBundlePath = environment.path.resolve(environment.appPath, "../../..");
      return yield* prepareUpdate(candidate.path, currentBundlePath).pipe(
        Effect.flatMap((prepared) =>
          launchInstaller({ ...prepared, currentBundlePath }).pipe(
            Effect.andThen(
              setState({ ...current, status: "installing", message: "Installing update…" }),
            ),
            Effect.tap(() => electronApp.quit),
          ),
        ),
        Effect.catch((error) => setState({ ...current, status: "error", message: error.message })),
      );
    }).pipe(Effect.withSpan("desktop.localUpdates.install")),
  });
});

export const layer = Layer.effect(DesktopLocalUpdates, make);
