import type { DesktopAppBranding } from "@t3tools/contracts";

function readInjectedDesktopAppBranding(): DesktopAppBranding | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.desktopBridge?.getAppBranding?.() ?? null;
}

const injectedDesktopAppBranding = readInjectedDesktopAppBranding();

export const APP_BASE_NAME = injectedDesktopAppBranding?.baseName ?? "T3 Code";
export const APP_STAGE_LABEL =
  injectedDesktopAppBranding?.stageLabel ?? (import.meta.env.DEV ? "Dev" : "A3");
export const APP_DISPLAY_NAME =
  injectedDesktopAppBranding?.displayName ?? `${APP_BASE_NAME} (${APP_STAGE_LABEL})`;
export const APP_VERSION =
  injectedDesktopAppBranding?.displayVersion ?? import.meta.env.APP_VERSION ?? "0.0.0";
export const APP_PKG_VERSION =
  injectedDesktopAppBranding?.appVersion ?? import.meta.env.APP_VERSION ?? "0.0.0";
