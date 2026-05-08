import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Electron from "electron";

import * as ElectronApp from "./ElectronApp.ts";

const ALLOWED_PERMISSIONS = new Set<string>([
  "clipboard-sanitized-write",
  "clipboard-read",
  "local-fonts",
]);

const install = Effect.acquireRelease(
  Effect.sync(() => {
    Electron.session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
      callback(ALLOWED_PERMISSIONS.has(permission));
    });
  }),
  () =>
    Effect.sync(() => {
      Electron.session.defaultSession.setPermissionRequestHandler(null);
    }),
);

export const layer = Layer.scopedDiscard(
  Effect.gen(function* () {
    const app = yield* ElectronApp.ElectronApp;
    yield* app.whenReady;
    yield* install;
  }),
);
