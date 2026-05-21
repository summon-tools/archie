import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { detectTechStack } from "@/lib/server/techstack";
import { generateManifest } from "@/lib/server/manifest";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "archie-techstack-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeFile(relPath: string, content: string) {
  const filePath = path.join(tmpDir, relPath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

describe("detectTechStack", () => {
  it("detects FastAPI projects and PostgreSQL database URLs", () => {
    writeFile("requirements.txt", "fastapi\nuvicorn\nsqlalchemy\nasyncpg\n");
    writeFile("app/main.py", "from fastapi import FastAPI\napp = FastAPI()\n");
    writeFile(".env", "DATABASE_URL=postgresql+asyncpg://archie:secret@localhost:5432/archie_dev\n");

    const stack = detectTechStack(tmpDir);

    expect(stack.framework).toBe("fastapi");
    expect(stack.bundleManager).toBe("pip");
    expect(stack.database).toBe("postgresql");
    expect(stack.databaseName).toBe("archie_dev");
  });

  it("detects FastAPI projects from pyproject.toml and common uvicorn targets", () => {
    writeFile("pyproject.toml", `
[project]
dependencies = ["fastapi", "uvicorn"]
`);
    writeFile("app/main.py", "from fastapi import FastAPI\napp = FastAPI()\n");
    writeFile("alembic.ini", "[alembic]\nscript_location = alembic\n");

    const stack = detectTechStack(tmpDir);
    const manifest = generateManifest(stack, 8123, tmpDir);

    expect(stack.framework).toBe("fastapi");
    expect(manifest.install.command).toBe("pip install -e .");
    expect(manifest.dev.command).toBe("uvicorn app.main:app --host 0.0.0.0 --port $PORT");
    expect(manifest.worktree?.prepare_command).toBe("alembic upgrade head");
  });

  it("detects SQLite database URLs used by FastAPI projects", () => {
    writeFile("requirements.txt", "fastapi\nuvicorn\naiosqlite\n");
    writeFile("main.py", "from fastapi import FastAPI\napp = FastAPI()\n");
    writeFile(".env", "SQLALCHEMY_DATABASE_URL=sqlite:///./app.sqlite3\n");

    const stack = detectTechStack(tmpDir);

    expect(stack.framework).toBe("fastapi");
    expect(stack.database).toBe("sqlite");
    expect(stack.databaseName).toBe("app.sqlite3");
  });
});
