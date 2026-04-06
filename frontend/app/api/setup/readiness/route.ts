import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import { checkSystemReadiness } from "@/lib/server/readiness";
import {
  getSetupAccess,
  getSetupAccessErrorMessage,
} from "@/lib/server/setup";

export async function GET(request: NextRequest) {
  const access = getSetupAccess();
  if (access.type === "needs_setup_blocked") {
    return NextResponse.json({ detail: getSetupAccessErrorMessage() }, { status: 403 });
  }
  if (access.type === "requires_auth") {
    try {
      await getAuthUser(request);
    } catch (e) {
      if (e instanceof AuthError) {
        return NextResponse.json({ detail: e.message }, { status: 401 });
      }
      throw e;
    }
  }

  try {
    const readiness = await checkSystemReadiness();
    return NextResponse.json(readiness);
  } catch (e: any) {
    return NextResponse.json(
      { detail: e.message || "Failed to check readiness" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    await getAuthUser(request);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ detail: e.message }, { status: 401 });
    }
    throw e;
  }

  try {
    const body = await request.json();
    const tool = body.tool;
    if (!tool) {
      return NextResponse.json({ detail: "tool is required" }, { status: 400 });
    }

    // Return installation guidance based on the tool
    const guidance = getInstallGuidance(tool);
    return NextResponse.json({ tool, guidance });
  } catch (e: any) {
    return NextResponse.json(
      { detail: e.message || "Failed to generate guidance" },
      { status: 500 }
    );
  }
}

function getInstallGuidance(tool: string): string {
  const guides: Record<string, string> = {
    git: "Install git:\n  sudo apt install git\n\nOn macOS:\n  xcode-select --install",
    node: "Install Node.js via nvm:\n  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash\n  source ~/.bashrc\n  nvm install --lts",
    ruby: "Install Ruby via rbenv:\n  curl -fsSL https://github.com/rbenv/rbenv-installer/raw/HEAD/bin/rbenv-installer | bash\n  export PATH=\"$HOME/.rbenv/bin:$PATH\"\n  eval \"$(rbenv init -)\"\n  rbenv install 3.3.0\n  rbenv global 3.3.0",
    python: "Install Python 3:\n  sudo apt install python3 python3-venv python3-pip",
    ffmpeg: "Install ffmpeg:\n  sudo apt install ffmpeg\n\nOn macOS:\n  brew install ffmpeg",
    playwright: "Install Playwright browsers:\n  npx playwright install chromium",
    claude: "Install Claude Code CLI:\n  npm install -g @anthropic-ai/claude-code\n\nThen authenticate:\n  claude auth login",
  };
  return guides[tool] || `Install ${tool} using your system's package manager.`;
}
