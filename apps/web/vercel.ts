import { routes, type VercelConfig } from "@vercel/config/v1";

export const config: VercelConfig = {
  buildCommand:
    "vp run --filter @t3tools/web build && node ../../scripts/apply-web-brand-assets.ts",
  git: {
    deploymentEnabled: false,
  },
  installCommand:
    "npm install -g vite-plus && vp install --filter '@t3tools/contracts' --filter '@t3tools/client-runtime' --filter '@t3tools/scripts' --filter '@t3tools/web'",
  rewrites: [routes.rewrite("/(.*)", "/index.html")],
};
