import { defineConfig } from "vitest/config";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "node",
    globals: true,
    testTimeout: 15000,
    include: [
      "__tests__/unit/**/*.test.ts",
      "__tests__/integration/**/*.test.ts",
    ],
  },
});
