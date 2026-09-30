import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getStatus } from "@/lib/server/git";
import { createTempGitRepo, type TempGitRepo } from "../helpers/temp-git";

let repo: TempGitRepo | undefined;
afterEach(() => { repo?.cleanup(); repo = undefined; });

describe("asynchronous Git status", () => {
  it("keeps the event loop responsive while fetching a slow remote", async () => {
    repo = createTempGitRepo();
    const remote = path.join(repo.dir, "remote.git");
    execFileSync("git", ["init", "--bare", remote], { stdio: "ignore" });
    execFileSync("git", ["remote", "add", "origin", remote], { cwd: repo.dir });
    execFileSync("git", ["push", "origin", "main"], { cwd: repo.dir, stdio: "ignore" });
    const uploadPack = path.join(repo.dir, "slow-upload-pack.sh");
    fs.writeFileSync(uploadPack, '#!/bin/sh\nsleep 0.5\nexec git-upload-pack "$@"\n', { mode: 0o700 });
    execFileSync("git", ["config", "remote.origin.uploadpack", uploadPack], { cwd: repo.dir });
    const status = Promise.resolve(getStatus(repo.dir));
    const first = await Promise.race([
      status.then(() => "status"),
      new Promise<string>(resolve => setTimeout(() => resolve("timer"), 50)),
    ]);
    expect(first).toBe("timer");
    const result = await status;
    expect(result).toMatchObject({ initialized: true, has_remote: true, branch: "main", unpushed_count: 0, behind_count: 0, last_commit_message: "initial commit" });
  });

  it("preserves the uninitialized response for a missing repository", async () => {
    expect(await getStatus("/missing-archie-test-repository")).toMatchObject({ initialized: false, has_remote: false });
  });
});
