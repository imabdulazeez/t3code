declare namespace Electron {
  interface Session {
    setPermissionRequestHandler(
      handler:
        | ((
            webContents: WebContents,
            permission: "local-fonts",
            callback: (permissionGranted: boolean) => void,
            details: PermissionRequest,
          ) => void)
        | null,
    ): void;
  }
}
