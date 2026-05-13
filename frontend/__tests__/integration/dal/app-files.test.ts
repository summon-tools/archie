import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import { createTestContext, getTestDb, type TestContext } from "../../helpers/test-db";
import { seedApp, seedConversation, seedMessage } from "../../helpers/seed";
import type Database from "better-sqlite3";

let ctx: TestContext;
let db: Database.Database;

beforeEach(async () => {
  vi.resetModules();
  ctx = createTestContext("dal-app-files-");
  db = await getTestDb(ctx);
});

afterEach(() => {
  ctx.cleanup();
});

describe("app files DAL", () => {
  it("links files to messages, rooms, conversations, and work items", async () => {
    const dal = await import("@/lib/server/dal");
    const app = seedApp(db);
    const conversation = seedConversation(db, app.id, { kind: "task" });
    const message = seedMessage(db, conversation.id);
    const room = dal.createRoom({ app_id: app.id, title: "Planning", purpose: "Plan" });
    const roomMessage = dal.createRoomMessage({
      room_id: room.id,
      role: "user",
      kind: "message",
      body_md: "See attached",
    });
    const workItem = dal.createWorkItem({
      app_id: app.id,
      primary_conversation_id: conversation.id,
      title: "Task",
    });

    const file = dal.createAppFile({
      app_id: app.id,
      original_name: "design.png",
      stored_name: "design.png",
      content_type: "image/png",
      size_bytes: 12,
      sha256: "abc",
      storage_path: "/tmp/design.png",
    });

    dal.linkAppFiles({
      app_id: app.id,
      file_ids: [file.id],
      room_id: room.id,
      room_message_id: roomMessage.id,
      conversation_id: conversation.id,
      message_id: message.id,
      work_item_id: workItem.id,
      link_type: "attachment",
    });

    expect(dal.getFilesForRoom(app.id, room.id).map((f) => f.id)).toEqual([file.id]);
    expect(dal.getFilesForRoomMessage(app.id, roomMessage.id).map((f) => f.id)).toEqual([file.id]);
    expect(dal.getFilesForConversation(app.id, conversation.id).map((f) => f.id)).toEqual([file.id]);
    expect(dal.getFilesForMessage(app.id, message.id).map((f) => f.id)).toEqual([file.id]);
    expect(dal.getFilesForWorkItem(app.id, workItem.id).map((f) => f.id)).toEqual([file.id]);
  });

  it("carries room files into a work item execution context", async () => {
    const dal = await import("@/lib/server/dal");
    const app = seedApp(db);
    const conversation = seedConversation(db, app.id, { kind: "task" });
    const room = dal.createRoom({ app_id: app.id, title: "Planning", purpose: "Plan" });
    const workItem = dal.createWorkItem({
      app_id: app.id,
      primary_conversation_id: conversation.id,
      title: "Implementation",
    });
    const file = dal.createAppFile({
      app_id: app.id,
      original_name: "brief.pdf",
      stored_name: "brief.pdf",
      content_type: "application/pdf",
      size_bytes: 1024,
      sha256: "def",
      storage_path: "/tmp/brief.pdf",
    });
    dal.linkAppFiles({
      app_id: app.id,
      file_ids: [file.id],
      room_id: room.id,
      link_type: "attachment",
    });

    dal.linkRoomFilesToWorkItem({
      app_id: app.id,
      room_id: room.id,
      work_item_id: workItem.id,
      conversation_id: conversation.id,
    });

    expect(dal.getFilesForWorkItem(app.id, workItem.id).map((f) => f.id)).toEqual([file.id]);
    expect(dal.getFilesForConversation(app.id, conversation.id).map((f) => f.id)).toEqual([file.id]);
  });

  it("keeps uploading files hidden and scopes storage activation by app", async () => {
    const dal = await import("@/lib/server/dal");
    const firstApp = seedApp(db, { name: "First" });
    const secondApp = seedApp(db, { name: "Second" });
    const pending = dal.createAppFile({
      app_id: firstApp.id,
      original_name: "brief.md",
      stored_name: "__pending__",
      content_type: "text/markdown",
      size_bytes: 12,
      sha256: "pendinghash",
      storage_path: "__pending__",
      status: "uploading",
    });

    expect(dal.listAppFiles(firstApp.id)).toEqual([]);
    expect(dal.listAppFiles(firstApp.id, true)).toEqual([]);
    expect(() => dal.updateAppFileStoragePath(secondApp.id, pending.id, {
      stored_name: `file-${pending.id}`,
      storage_path: "/tmp/brief.md",
    })).toThrow(`app_files row not found: ${pending.id}`);

    const activated = dal.updateAppFileStoragePath(firstApp.id, pending.id, {
      stored_name: `file-${pending.id}`,
      storage_path: "/tmp/brief.md",
    });
    expect(activated.status).toBe("available");
    expect(dal.listAppFiles(firstApp.id).map((file) => file.id)).toEqual([pending.id]);
  });

  it("materializes files with opaque paths, caps total bytes, and cleans up copies", async () => {
    const dal = await import("@/lib/server/dal");
    const {
      cleanupMaterializedFilesForContext,
      materializeFilesForContext,
      MAX_CONTEXT_MATERIALIZED_BYTES,
    } = await import("@/lib/server/file-storage");
    const appDir = path.join(ctx.tmpDir, "app");
    fs.mkdirSync(appDir, { recursive: true });
    const app = seedApp(db, { directory: appDir });
    const sourcePath = path.join(ctx.tmpDir, "source.md");
    fs.writeFileSync(sourcePath, "# Brief\n");

    const smallFile = dal.createAppFile({
      app_id: app.id,
      original_name: "customer brief.md",
      stored_name: "file-small",
      content_type: "text/markdown",
      size_bytes: 8,
      sha256: "smallhash",
      storage_path: sourcePath,
    });
    const tooLarge = dal.createAppFile({
      app_id: app.id,
      original_name: "large.pdf",
      stored_name: "file-large",
      content_type: "application/pdf",
      size_bytes: MAX_CONTEXT_MATERIALIZED_BYTES + 1,
      sha256: "largehash",
      storage_path: sourcePath,
    });

    const materialized = materializeFilesForContext({
      appId: app.id,
      targetDirectory: appDir,
      files: [smallFile, tooLarge],
    });

    expect(materialized[0].contextPath).toBe(path.join(appDir, ".archie", "context-files", `app-${app.id}`, `file-${smallFile.id}`));
    expect(materialized[0].contextPath).not.toContain("customer brief.md");
    expect(materialized[1].contextPath).toBeNull();
    expect(fs.readFileSync(materialized[0].contextPath!, "utf8")).toBe("# Brief\n");

    cleanupMaterializedFilesForContext({ appId: app.id, targetDirectory: appDir });
    expect(fs.existsSync(path.join(appDir, ".archie", "context-files", `app-${app.id}`))).toBe(false);
  });
});
