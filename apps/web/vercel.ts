import { routes, type VercelConfig } from "@vercel/config/v1";

export const config: VercelConfig = {
  buildCommand: "turbo build --filter @t3tools/web && bun ../../scripts/apply-web-brand-assets.ts",
  git: {
    deploymentEnabled: false,
  },
  installCommand:
    "bun add -g turbo && bun install --filter '@t3tools/contracts' --filter '@t3tools/client-runtime' --filter '@t3tools/scripts' --filter '@t3tools/web'",
  rewrites: [routes.rewrite("/(.*)", "/index.html")],
};
