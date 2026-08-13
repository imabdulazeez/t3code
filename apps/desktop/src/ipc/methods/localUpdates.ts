import { DesktopLocalUpdateStateSchema } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as DesktopLocalUpdates from "../../updates/DesktopLocalUpdates.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

export const getLocalUpdateState = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.LOCAL_UPDATE_GET_STATE_CHANNEL,
  payload: Schema.Void,
  result: DesktopLocalUpdateStateSchema,
  handler: Effect.fn("desktop.ipc.localUpdates.getState")(function* () {
    return yield* (yield* DesktopLocalUpdates.DesktopLocalUpdates).getState;
  }),
});

export const setLocalUpdateFolder = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.LOCAL_UPDATE_SET_FOLDER_CHANNEL,
  payload: Schema.NullOr(Schema.String),
  result: DesktopLocalUpdateStateSchema,
  handler: Effect.fn("desktop.ipc.localUpdates.setFolder")(function* (folderPath) {
    return yield* (yield* DesktopLocalUpdates.DesktopLocalUpdates).setFolder(folderPath);
  }),
});

export const checkForLocalUpdate = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.LOCAL_UPDATE_CHECK_CHANNEL,
  payload: Schema.Void,
  result: DesktopLocalUpdateStateSchema,
  handler: Effect.fn("desktop.ipc.localUpdates.check")(function* () {
    return yield* (yield* DesktopLocalUpdates.DesktopLocalUpdates).check;
  }),
});

export const installLocalUpdate = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.LOCAL_UPDATE_INSTALL_CHANNEL,
  payload: Schema.Void,
  result: DesktopLocalUpdateStateSchema,
  handler: Effect.fn("desktop.ipc.localUpdates.install")(function* () {
    return yield* (yield* DesktopLocalUpdates.DesktopLocalUpdates).install;
  }),
});
