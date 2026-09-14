import { useState } from "react";

import {
  hasDesktopNotifications,
  hasNotificationSound,
  NOTIFICATION_MODE_LABELS,
  playNotificationSound,
  unlockNotificationAudio,
} from "../../threadNotifications";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { toastManager } from "../ui/toast";
import { SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

export function NotificationSettings() {
  const mode = useScopedSettings((settings) => settings.notificationMode);
  const updateSettings = useUpdateScopedSettings();
  const [permissionMessage, setPermissionMessage] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);

  return (
    <SettingsRow
      {...searchableSetting("thread-notifications")}
      description={
        permissionMessage ??
        "System alerts when a thread finishes, fails, or needs input or approval. Applies to this device while T3 Code is open."
      }
      control={
        <Select
          value={mode}
          disabled={requesting}
          onValueChange={async (value) => {
            if (
              value !== "off" &&
              value !== "notifications" &&
              value !== "sound" &&
              value !== "notifications-and-sound"
            )
              return;
            setPermissionMessage(null);
            if (hasNotificationSound(value)) unlockNotificationAudio();
            if (hasDesktopNotifications(value)) {
              if (typeof Notification === "undefined" || !window.isSecureContext) {
                setPermissionMessage(
                  "Notifications need a supported browser over HTTPS, or the desktop app. Sound only is still available.",
                );
                return;
              }
              setRequesting(true);
              try {
                const permission = await Notification.requestPermission();
                if (permission !== "granted") {
                  setPermissionMessage(
                    "Allow notifications in your browser or system settings, then choose this option again. Sound only is still available.",
                  );
                  return;
                }
              } catch {
                setPermissionMessage(
                  "Notifications are unavailable in this browser. Sound only is still available.",
                );
                return;
              } finally {
                setRequesting(false);
              }
            }
            updateSettings({ notificationMode: value });
          }}
        >
          <SelectTrigger size="sm" className="w-full sm:w-56" aria-label="Thread notifications">
            <SelectValue>{NOTIFICATION_MODE_LABELS[mode]}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {Object.entries(NOTIFICATION_MODE_LABELS).map(([value, label]) => (
              <SelectItem key={value} hideIndicator value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  );
}

export function NotificationTestSettings() {
  const mode = useScopedSettings((settings) => settings.notificationMode);
  const inAppEnabled = useScopedSettings((settings) => settings.inAppNotificationsEnabled);
  const [message, setMessage] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  return (
    <SettingsRow
      {...searchableSetting("test-notifications")}
      description={
        message ??
        "Sends a sample alert using the current settings, and asks for system permission if it has not been granted yet."
      }
      control={
        <Button
          size="sm"
          variant="outline"
          disabled={sending}
          onClick={async () => {
            setMessage(null);
            if (mode === "off" && !inAppEnabled) {
              setMessage(
                "Notifications are off. Choose a notification mode or enable in-app notifications first.",
              );
              return;
            }
            setSending(true);
            try {
              if (hasNotificationSound(mode)) {
                await unlockNotificationAudio();
                void playNotificationSound("completion", () => true);
              }
              if (inAppEnabled) {
                toastManager.add({
                  type: "success",
                  title: "Test notification",
                  description: "In-app notifications are working.",
                  data: { hideCopyButton: true },
                });
              }
              if (!hasDesktopNotifications(mode)) return;
              if (typeof Notification === "undefined" || !window.isSecureContext) {
                setMessage(
                  "System notifications need a supported browser over HTTPS, or the desktop app.",
                );
                return;
              }
              const permission = await Notification.requestPermission();
              if (permission !== "granted") {
                setMessage(
                  "System notifications are blocked. Allow them in your browser or system settings, then try again.",
                );
                return;
              }
              const notification = new Notification("Test notification", {
                body: "System notifications are working.",
                tag: "t3code:test-notification",
                silent: true,
              });
              notification.addEventListener("click", () => {
                notification.close();
                window.focus();
              });
              setMessage(
                "Test notification sent. If nothing appeared, check this app's entry in your system notification settings.",
              );
            } catch {
              setMessage("System notifications are unavailable here.");
            } finally {
              setSending(false);
            }
          }}
        >
          Send test
        </Button>
      }
    />
  );
}
