import { execSync, execFileSync } from "child_process";
import os from "os";

// --- Platform Detection ---

export type Platform = "darwin" | "linux";

export function getPlatform(): Platform {
  const p = os.platform();
  if (p === "darwin") return "darwin";
  return "linux"; // default to linux for all non-darwin Unix
}

// --- Cross-Platform Port Checking ---

/**
 * Check if a port is currently bound (listening) on localhost.
 * Uses lsof on macOS, ss on Linux.
 */
export function checkPortSync(port: number): boolean {
  try {
    if (getPlatform() === "darwin") {
      const result = execFileSync("lsof", ["-i", `:${port}`, "-sTCP:LISTEN", "-t"], {
        encoding: "utf-8",
        timeout: 3000,
        stdio: ["pipe", "pipe", "pipe"],
      });
      return result.trim().length > 0;
    } else {
      const result = execFileSync("ss", ["-tlnH", `sport = :${port}`], {
        encoding: "utf-8",
        timeout: 3000,
        stdio: ["pipe", "pipe", "pipe"],
      });
      return result.trim().length > 0;
    }
  } catch {
    return false;
  }
}

// --- Cross-Platform Install Hints ---

const INSTALL_HINTS: Record<string, { darwin: string; linux: string }> = {
  git: { darwin: "Install via: brew install git", linux: "Install via: sudo apt install git" },
  python3: { darwin: "Install via: brew install python3", linux: "Install via: sudo apt install python3 python3-venv" },
  pip3: { darwin: "Install via: brew install python3 (pip3 included)", linux: "Install via: sudo apt install python3-pip" },
  ffmpeg: { darwin: "Install via: brew install ffmpeg", linux: "Install via: sudo apt install ffmpeg" },
  node: { darwin: "Install via: nvm install --lts", linux: "Install via: nvm install --lts" },
  ruby: { darwin: "Install via: rbenv install <version>", linux: "Install via: rbenv install <version>" },
  bundler: { darwin: "Install via: gem install bundler", linux: "Install via: gem install bundler" },
  playwright: { darwin: "Install via: npx playwright install chromium", linux: "Install via: npx playwright install chromium" },
  gh: { darwin: "Install via: brew install gh", linux: "Install via: sudo apt install gh" },
  claude: { darwin: "Install via: npm install -g @anthropic-ai/claude-code", linux: "Install via: npm install -g @anthropic-ai/claude-code" },
};

/**
 * Returns platform-appropriate install hint for a tool.
 * Falls back to a generic message if the tool is not in the lookup table.
 */
export function getInstallHint(tool: string): string {
  const hints = INSTALL_HINTS[tool];
  if (!hints) return `Install ${tool} for your platform`;
  return hints[getPlatform()];
}
