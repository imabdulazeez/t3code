import { useAtomValue } from "@effect/atom-react";
import { useNavigate, useParams } from "@tanstack/react-router";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  MessageCircleQuestionIcon,
  ShieldQuestionIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef } from "react";

import { getClientSettings, useClientSettings } from "../hooks/useSettings";
import { useEnvironments } from "../state/environments";
import { environmentShell } from "../state/shell";
import {
  hasDesktopNotifications,
  hasNotificationSound,
  playNotificationSound,
  setNotificationBadge,
  unlockNotificationAudio,
} from "../threadNotifications";
import { loadCompletionMessagePreview } from "../threadNotificationPreview";
import { resolveSidebarThreadStatus } from "./Sidebar.logic";
import { toastManager } from "./ui/toast";

export function ThreadNotificationCoordinator() {
  const { environments } = useEnvironments();
  const mode = useClientSettings((settings) => settings.notificationMode);
  const inAppNotificationsEnabled = useClientSettings(
    (settings) => settings.inAppNotificationsEnabled,
  );
  const pending = useRef(
    new Map<string, { environmentId: EnvironmentId; notification: Notification }>(),
  );
  const onNotification = useCallback((environmentId: EnvironmentId, notification: Notification) => {
    pending.current.get(notification.tag)?.notification.close();
    pending.current.set(notification.tag, { environmentId, notification });
    setNotificationBadge(pending.current.size);
  }, []);

  useEffect(() => {
    const activeIds = new Set(environments.map(({ environmentId }) => environmentId));
    const count = pending.current.size;
    for (const [tag, { environmentId, notification }] of pending.current) {
      if (activeIds.has(environmentId)) continue;
      notification.close();
      pending.current.delete(tag);
    }
    if (count !== pending.current.size) setNotificationBadge(pending.current.size);
  }, [environments]);

  useEffect(() => {
    const clear = () => {
      for (const { notification } of pending.current.values()) notification.close();
      pending.current.clear();
      setNotificationBadge(0);
    };
    clear();
    if (!hasDesktopNotifications(mode)) return;
    const unsubscribe = window.desktopBridge?.onNotificationBadgeClear?.(clear);
    window.addEventListener("focus", clear);
    return () => {
      unsubscribe?.();
      window.removeEventListener("focus", clear);
      clear();
    };
  }, [mode]);

  useEffect(() => {
    if (!hasNotificationSound(mode)) return;
    document.addEventListener("pointerdown", unlockNotificationAudio);
    document.addEventListener("keydown", unlockNotificationAudio);
    return () => {
      document.removeEventListener("pointerdown", unlockNotificationAudio);
      document.removeEventListener("keydown", unlockNotificationAudio);
    };
  }, [mode]);

  if (mode === "off" && !inAppNotificationsEnabled) return null;

  return environments.map((environment) => (
    <EnvironmentNotifications
      key={environment.environmentId}
      environmentId={environment.environmentId}
      onNotification={onNotification}
    />
  ));
}

function EnvironmentNotifications({
  environmentId,
  onNotification,
}: {
  environmentId: EnvironmentId;
  onNotification: (environmentId: EnvironmentId, notification: Notification) => void;
}) {
  const shell = useAtomValue(environmentShell.stateValueAtom(environmentId));
  const mode = useClientSettings((settings) => settings.notificationMode);
  const inAppNotificationsEnabled = useClientSettings(
    (settings) => settings.inAppNotificationsEnabled,
  );
  const navigate = useNavigate();
  const { environmentId: activeEnvironmentId, threadId: activeThreadId } = useParams({
    strict: false,
  });
  const current = useRef({
    shell,
    mode,
    inAppNotificationsEnabled,
    activeEnvironmentId,
    activeThreadId,
  });
  useEffect(() => {
    current.current = {
      shell,
      mode,
      inAppNotificationsEnabled,
      activeEnvironmentId,
      activeThreadId,
    };
  }, [shell, mode, inAppNotificationsEnabled, activeEnvironmentId, activeThreadId]);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const previous = useRef(
    new Map<ThreadId, { attention: string | null; completion: number | null }>(),
  );

  useEffect(() => {
    if (shell.status !== "live" || Option.isNone(shell.snapshot)) {
      previous.current.clear();
      return;
    }
    const next = new Map<ThreadId, { attention: string | null; completion: number | null }>();
    for (const thread of shell.snapshot.value.threads) {
      let status = resolveSidebarThreadStatus(thread);
      if (status === "ready" && thread.latestTurn?.state === "error") status = "failed";
      const prior = previous.current.get(thread.id);
      const attention =
        status === "input" || status === "approval" || status === "failed"
          ? `${thread.latestTurn?.turnId ?? ""}:${status}`
          : null;
      const completedAt = Date.parse(thread.latestTurn?.completedAt ?? "");
      const completion =
        status === "ready" &&
        thread.latestTurn?.state === "completed" &&
        Number.isFinite(completedAt)
          ? completedAt
          : (prior?.completion ?? null);
      next.set(thread.id, { attention, completion });
      if (!prior || thread.archivedAt !== null) continue;
      const kind =
        attention && attention !== prior.attention
          ? "input"
          : completion !== null && (prior.completion === null || completion > prior.completion)
            ? "completion"
            : null;
      if (!kind) continue;
      const title =
        kind === "completion"
          ? thread.title
          : status === "approval"
            ? "Approval needed"
            : status === "failed"
              ? "Thread failed"
              : "Input needed";
      if (hasNotificationSound(mode)) {
        void playNotificationSound(kind, () =>
          hasNotificationSound(getClientSettings().notificationMode),
        );
      }
      const showNotification = async () => {
        const canShowToast =
          inAppNotificationsEnabled &&
          document.visibilityState === "visible" &&
          document.hasFocus() &&
          (activeEnvironmentId !== environmentId || activeThreadId !== thread.id);
        const canShowSystem =
          hasDesktopNotifications(mode) &&
          !(document.visibilityState === "visible" && document.hasFocus()) &&
          typeof Notification !== "undefined" &&
          Notification.permission === "granted";
        if (!canShowToast && !canShowSystem) return;
        const body =
          kind === "completion"
            ? await loadCompletionMessagePreview(
                environmentId,
                thread.id,
                thread.latestTurn?.turnId ?? null,
              )
            : thread.title;
        if (
          !mounted.current ||
          (kind === "completion" && previous.current.get(thread.id)?.completion !== completion)
        )
          return;
        const latest = current.current;
        if (kind === "completion") {
          const latestThread = Option.isSome(latest.shell.snapshot)
            ? latest.shell.snapshot.value.threads.find((candidate) => candidate.id === thread.id)
            : undefined;
          if (
            latest.shell.status !== "live" ||
            !latestThread ||
            latestThread.archivedAt !== null ||
            latestThread.latestTurn?.turnId !== thread.latestTurn?.turnId ||
            latestThread.latestTurn?.state !== "completed"
          )
            return;
        }
        if (
          latest.inAppNotificationsEnabled &&
          document.visibilityState === "visible" &&
          document.hasFocus() &&
          (latest.activeEnvironmentId !== environmentId || latest.activeThreadId !== thread.id)
        ) {
          const toastId = toastManager.add({
            type: kind === "completion" ? "success" : status === "failed" ? "error" : "warning",
            title,
            description: body,
            data: {
              hideCopyButton: true,
              clampDescription: true,
              actionLayout: "stacked-end",
              leadingIcon:
                kind === "completion" ? (
                  <CircleCheckIcon aria-hidden className="size-4 text-success-foreground" />
                ) : status === "approval" ? (
                  <ShieldQuestionIcon aria-hidden className="size-4 text-warning-foreground" />
                ) : status === "failed" ? (
                  <CircleAlertIcon aria-hidden className="size-4 text-destructive-foreground" />
                ) : (
                  <MessageCircleQuestionIcon aria-hidden className="size-4 text-info-foreground" />
                ),
            },
            actionProps: {
              children: "Open thread",
              onClick: () => {
                toastManager.close(toastId);
                void navigate({
                  to: "/$environmentId/$threadId",
                  params: { environmentId, threadId: thread.id },
                });
              },
            },
          });
          return;
        }
        if (
          !hasDesktopNotifications(latest.mode) ||
          (document.visibilityState === "visible" && document.hasFocus()) ||
          typeof Notification === "undefined" ||
          Notification.permission !== "granted"
        )
          return;
        try {
          const notification = new Notification(title, {
            body,
            tag: `${environmentId}:${thread.id}`,
            silent: true,
          });
          onNotification(environmentId, notification);
          notification.addEventListener("click", () => {
            notification.close();
            window.focus();
            void navigate({
              to: "/$environmentId/$threadId",
              params: { environmentId, threadId: thread.id },
            });
          });
        } catch {
          // Some browsers expose Notification but reject desktop presentation.
        }
      };
      void showNotification();
    }
    previous.current = next;
  }, [
    activeEnvironmentId,
    activeThreadId,
    environmentId,
    inAppNotificationsEnabled,
    mode,
    navigate,
    onNotification,
    shell,
  ]);

  return null;
}
