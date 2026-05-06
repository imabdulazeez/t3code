declare namespace Electron {
  interface Session {
    setPermissionRequestHandler(
      handler:
        | ((
            webContents: WebContents,
            permission: "local-fonts" | "clipboard-sanitized-write" | "clipboard-read",
            callback: (permissionGranted: boolean) => void,
            details: PermissionRequest,
          ) => void)
        | null,
    ): void;
  }
}
