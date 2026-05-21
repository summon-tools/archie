import { describe, expect, it } from "vitest";
import { buildSetupToolPrompt } from "@/lib/server/tool-loader";
import type { AppManifest } from "@/lib/server/manifest";
import type { TechStack } from "@/lib/server/techstack";

const fastApiManifest: AppManifest = {
  app: { framework: "fastapi" },
  install: { command: "pip install -r requirements.txt" },
  dev: {
    command: "uvicorn app.main:app --host 0.0.0.0 --port $PORT",
    port_env: "PORT",
    strict_port: true,
    health_path: "/",
  },
};

function fastApiStack(overrides: Partial<TechStack> = {}): TechStack {
  return {
    framework: "fastapi",
    packageManager: null,
    bundleManager: "pip",
    database: "postgresql",
    databaseName: null,
    hasProcfile: false,
    processes: [],
    ...overrides,
  };
}

describe("buildSetupToolPrompt", () => {
  it("warns FastAPI setup when PostgreSQL is detected without a concrete DB URL", () => {
    const prompt = buildSetupToolPrompt({
      appName: "Wallet",
      directory: "/tmp/wallet",
      port: 4123,
      stack: fastApiStack(),
      manifest: fastApiManifest,
    });

    expect(prompt).toContain("Worktree database setup warning");
    expect(prompt).toContain("could not find a concrete database URL or database name");
    expect(prompt).toContain("Do not hardcode the database URL");
    expect(prompt).toContain("Future task worktrees need the DB URL in env configuration");
  });

  it("does not warn FastAPI setup when the DB name is already detectable", () => {
    const prompt = buildSetupToolPrompt({
      appName: "Wallet",
      directory: "/tmp/wallet",
      port: 4123,
      stack: fastApiStack({ databaseName: "wallet_development" }),
      manifest: fastApiManifest,
    });

    expect(prompt).not.toContain("Worktree database setup warning");
  });
});
