import {
  GistSyncedClientSettings,
  GistSyncedServerSettings,
  selectGistSyncedClientSettings,
  selectGistSyncedServerSettings,
  type SettingsGistSyncResult,
} from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useAtomValue } from "@effect/atom-react";
import * as Equal from "effect/Equal";
import * as Schema from "effect/Schema";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { usePrimaryEnvironmentId } from "../state/environments";
import { primaryServerSettingsAtom, serverEnvironment } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";
import { useLocalStorage } from "./useLocalStorage";
import {
  getClientSettings,
  useClientSettings,
  useClientSettingsHydrated,
  useUpdateClientSettings,
  useUpdatePrimarySettings,
} from "./useSettings";

const SETTINGS_GIST_SYNC_DEBOUNCE_MS = 1_000;
const SETTINGS_GIST_SYNC_BASELINES_KEY = "t3code:settings-gist-sync-baselines";

const SettingsGistSyncBaseline = Schema.Struct({
  revision: Schema.String,
  settings: GistSyncedClientSettings,
  serverSettings: GistSyncedServerSettings,
});

const SettingsGistSyncBaselines = Schema.Record(Schema.String, SettingsGistSyncBaseline);
type SettingsGistSyncBaselines = typeof SettingsGistSyncBaselines.Type;

const EMPTY_SETTINGS_GIST_SYNC_BASELINES: SettingsGistSyncBaselines = {};

type ConflictPolicy = "automatic" | "local" | "remote" | "prompt";

/**
 * The portable settings of one device, split by backing store: client keys
 * live in local persistence, server keys in the environment's settings.json.
 * Both halves travel in the same Gist document and merge independently.
 */
type PortableSettings = {
  readonly client: GistSyncedClientSettings;
  readonly server: GistSyncedServerSettings;
};

export type SettingsGistSyncOutcome =
  | {
      readonly status: "synced";
      readonly gistId: string;
      readonly conflicts: ReadonlyArray<string>;
      readonly changedLocal: boolean;
      readonly changedRemote: boolean;
    }
  | {
      readonly status: "conflict";
      readonly gistId: string;
      readonly conflicts: ReadonlyArray<string>;
      readonly firstSync: boolean;
    }
  | {
      readonly status: "failure";
      readonly failure: unknown;
    };

function reconcileStore<T extends object>(
  baseline: T | null,
  local: T,
  remote: T,
  policy: ConflictPolicy,
) {
  const localValues = local as Record<string, unknown>;
  const remoteValues = remote as Record<string, unknown>;
  const baselineValues = baseline as Record<string, unknown> | null;
  const merged: Record<string, unknown> = { ...remoteValues };
  const conflicts: Array<string> = [];
  const useLocalForConflict = policy === "local" || (policy === "automatic" && baseline !== null);

  for (const key of Object.keys(remoteValues)) {
    const localValue = localValues[key];
    const remoteValue = remoteValues[key];
    if (baselineValues === null) {
      if (!Equal.equals(localValue, remoteValue)) {
        if (policy !== "automatic") conflicts.push(key);
        if (useLocalForConflict) merged[key] = localValue;
      }
      continue;
    }
    const baselineValue = baselineValues[key];
    const localChanged = !Equal.equals(localValue, baselineValue);
    const remoteChanged = !Equal.equals(remoteValue, baselineValue);
    if (localChanged && !remoteChanged) {
      merged[key] = localValue;
      continue;
    }
    if (localChanged && remoteChanged && !Equal.equals(localValue, remoteValue)) {
      conflicts.push(key);
      if (useLocalForConflict) merged[key] = localValue;
    }
  }

  return { settings: merged as T, conflicts };
}

function reconcileSettings(
  baseline: PortableSettings | null,
  local: PortableSettings,
  remote: PortableSettings,
  policy: ConflictPolicy,
) {
  const client = reconcileStore(baseline?.client ?? null, local.client, remote.client, policy);
  const server = reconcileStore(baseline?.server ?? null, local.server, remote.server, policy);
  return {
    settings: { client: client.settings, server: server.settings },
    conflicts: [...client.conflicts, ...server.conflicts],
  };
}

export function useSettingsGistSyncActions() {
  const environmentId = usePrimaryEnvironmentId();
  const updateClientSettings = useUpdateClientSettings();
  const updatePrimarySettings = useUpdatePrimarySettings();
  const serverSettings = useAtomValue(primaryServerSettingsAtom);
  const serverSettingsRef = useRef(serverSettings);
  serverSettingsRef.current = serverSettings;
  const [baselines, setBaselines] = useLocalStorage(
    SETTINGS_GIST_SYNC_BASELINES_KEY,
    EMPTY_SETTINGS_GIST_SYNC_BASELINES,
    SettingsGistSyncBaselines,
  );
  const pullCommand = useAtomCommand(serverEnvironment.pullSettingsGist, {
    reportFailure: false,
  });
  const pushCommand = useAtomCommand(serverEnvironment.pushSettingsGist, {
    reportFailure: false,
  });

  const readPortableSettings = useCallback(
    (): PortableSettings => ({
      client: selectGistSyncedClientSettings(getClientSettings()),
      server: selectGistSyncedServerSettings(serverSettingsRef.current),
    }),
    [],
  );

  const recordSuccess = useCallback(
    (
      result: { readonly gistId: string; readonly lastSyncedAt: string },
      applyServerSettings?: GistSyncedServerSettings,
    ) => {
      updatePrimarySettings({
        ...applyServerSettings,
        gistSettingsSync: {
          gistId: result.gistId,
          lastSyncedAt: result.lastSyncedAt,
        },
      });
    },
    [updatePrimarySettings],
  );

  const recordBaseline = useCallback(
    (result: SettingsGistSyncResult, settings: PortableSettings) => {
      setBaselines((current) => ({
        ...current,
        [result.gistId]: {
          revision: result.revision,
          settings: settings.client,
          serverSettings: settings.server,
        },
      }));
    },
    [setBaselines],
  );

  const pullRemote = useCallback(
    async (gistId: string) => {
      if (!environmentId || !gistId.trim()) return null;
      return pullCommand({ environmentId, input: { gistId: gistId.trim() } });
    },
    [environmentId, pullCommand],
  );

  const pushRemote = useCallback(
    async (gistId: string, settings: PortableSettings) => {
      if (!environmentId) return null;
      return pushCommand({
        environmentId,
        input: {
          gistId: gistId.trim(),
          settings: settings.client,
          serverSettings: settings.server,
        },
      });
    },
    [environmentId, pushCommand],
  );

  const create = useCallback(async (): Promise<SettingsGistSyncOutcome | null> => {
    const settings = readPortableSettings();
    const result = await pushRemote("", settings);
    if (!result) return null;
    if (result._tag !== "Success") return { status: "failure", failure: result };
    recordBaseline(result.value, settings);
    recordSuccess(result.value);
    return {
      status: "synced",
      gistId: result.value.gistId,
      conflicts: [],
      changedLocal: false,
      changedRemote: true,
    };
  }, [pushRemote, readPortableSettings, recordBaseline, recordSuccess]);

  const reconcile = useCallback(
    async (gistId: string, policy: ConflictPolicy): Promise<SettingsGistSyncOutcome | null> => {
      const normalizedGistId = gistId.trim();
      const pulled = await pullRemote(normalizedGistId);
      if (!pulled) return null;
      if (pulled._tag !== "Success") return { status: "failure", failure: pulled };

      const local = readPortableSettings();
      const remote: PortableSettings = {
        client: pulled.value.settings,
        server: pulled.value.serverSettings,
      };
      const storedBaseline = baselines[normalizedGistId];
      const baseline = storedBaseline
        ? { client: storedBaseline.settings, server: storedBaseline.serverSettings }
        : null;
      const merged = reconcileSettings(baseline, local, remote, policy);
      if (policy === "prompt" && merged.conflicts.length > 0) {
        return {
          status: "conflict",
          gistId: normalizedGistId,
          conflicts: merged.conflicts,
          firstSync: baseline === null,
        };
      }

      const changedClient = !Equal.equals(local.client, merged.settings.client);
      const changedServer = !Equal.equals(local.server, merged.settings.server);
      const changedLocal = changedClient || changedServer;
      const changedRemote = !Equal.equals(remote, merged.settings);
      if (changedClient) updateClientSettings(merged.settings.client);
      const applyServerSettings = changedServer ? merged.settings.server : undefined;
      if (changedRemote) {
        const pushed = await pushRemote(normalizedGistId, merged.settings);
        if (!pushed) return null;
        if (pushed._tag !== "Success") return { status: "failure", failure: pushed };
        recordBaseline(pushed.value, merged.settings);
        recordSuccess(pushed.value, applyServerSettings);
      } else {
        recordBaseline(pulled.value, merged.settings);
        recordSuccess(pulled.value, applyServerSettings);
      }
      return {
        status: "synced",
        gistId: normalizedGistId,
        conflicts: merged.conflicts,
        changedLocal,
        changedRemote,
      };
    },
    [
      baselines,
      pullRemote,
      pushRemote,
      readPortableSettings,
      recordBaseline,
      recordSuccess,
      updateClientSettings,
    ],
  );

  return { create, reconcile };
}

export function SettingsGistSyncController(props: {
  readonly enabled: boolean;
  readonly gistId: string;
}) {
  const hydrated = useClientSettingsHydrated();
  const clientSettings = useClientSettings();
  const serverSettings = useAtomValue(primaryServerSettingsAtom);
  const environmentId = usePrimaryEnvironmentId();
  const { reconcile } = useSettingsGistSyncActions();
  const portableSettings = useMemo<PortableSettings>(
    () => ({
      client: selectGistSyncedClientSettings(clientSettings),
      server: selectGistSyncedServerSettings(serverSettings),
    }),
    [clientSettings, serverSettings],
  );
  const observedRef = useRef<{
    readonly key: string;
    readonly settings: PortableSettings;
  } | null>(null);

  useEffect(() => {
    const key = `${environmentId ?? ""}:${props.enabled}:${props.gistId}`;
    const observed = observedRef.current;
    if (!hydrated || !environmentId || !props.enabled || !props.gistId.trim()) {
      observedRef.current = null;
      return;
    }
    const initialSync = !observed || observed.key !== key;
    if (!initialSync && Equal.equals(observed.settings, portableSettings)) return;
    observedRef.current = { key, settings: portableSettings };
    const timeout = window.setTimeout(
      () => {
        void reconcile(props.gistId, "automatic").then((result) => {
          if (!result || (result.status === "synced" && result.conflicts.length === 0)) return;
          if (result.status === "failure") {
            const error = squashAtomCommandFailure(result.failure as never);
            toastManager.add(
              stackedThreadToast({
                type: "error",
                title: "Settings sync failed",
                description: error instanceof Error ? error.message : "Could not update the Gist.",
              }),
            );
            return;
          }
          if (result.status === "synced") {
            toastManager.add(
              stackedThreadToast({
                type: "warning",
                title: "Settings conflicts resolved",
                description: result.changedRemote
                  ? `${result.conflicts.length} conflicting ${result.conflicts.length === 1 ? "setting was" : "settings were"} kept from this device.`
                  : `${result.conflicts.length} conflicting ${result.conflicts.length === 1 ? "setting was" : "settings were"} applied from the Gist.`,
              }),
            );
          }
        });
      },
      initialSync ? 0 : SETTINGS_GIST_SYNC_DEBOUNCE_MS,
    );
    return () => window.clearTimeout(timeout);
  }, [environmentId, hydrated, portableSettings, props.enabled, props.gistId, reconcile]);

  return null;
}
