import { defineConfig } from "playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const skipWebServer = process.env.PLAYWRIGHT_SKIP_WEB_SERVER === "1";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30000,
  retries: 0,
  use: {
    baseURL,
    headless: true,
  },
  webServer: skipWebServer
    ? undefined
    : {
        // Source nvm so the correct Node version (>=20) is used even if the
        // default shell Node is too old.  Falls back to bare npx when nvm
        // isn't installed (e.g. CI with a system-wide Node 20+).
        command:
          'bash -c \'export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" 2>/dev/null; npx next dev --port 3000\'',
        port: 3000,
        reuseExistingServer: true,
        timeout: 60000,
      },
});
