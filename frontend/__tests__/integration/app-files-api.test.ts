import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import { createTestContext, getTestDb, type TestContext } from "../helpers/test-db";
import { seedApp, seedUser } from "../helpers/seed";
import type Database from "better-sqlite3";

let ctx: TestContext;
let db: Database.Database;

beforeEach(async () => {
  vi.resetModules();
  ctx = createTestContext("app-files-api-");
  db = await getTestDb(ctx);
});

afterEach(() => {
  ctx.cleanup();
});

async function createAuthToken() {
  const user = seedUser(db, { name: "File Tester", role: "admin" });
  const { createToken } = await import("@/lib/server/auth");
  return createToken(user.id, "File Tester", "admin");
}

function makeRequest(url: string, options: { token: string; formData?: FormData; body?: object } = { token: "" }) {
  const target = new URL(url);
  return {
    json: async () => options.body || {},
    formData: async () => {
      if (!options.formData) throw new Error("Missing form data");
      return options.formData;
    },
    cookies: {
      get: (name: string) => {
        if (name === "session_token" && options.token) return { value: options.token };
        return undefined;
      },
    },
    headers: { get: (_name: string) => null },
    nextUrl: target,
    url: target.toString(),
  } as any;
}

describe("app file API", () => {
  it("uploads, lists, downloads, and deletes app-scoped files", async () => {
    const token = await createAuthToken();
    const app = seedApp(db, { directory: path.join(ctx.tmpDir, "app") });
    fs.mkdirSync(path.join(ctx.tmpDir, "app"), { recursive: true });

    const formData = new FormData();
    formData.append("file", new File(["# Notes\n"], "notes.md", { type: "text/markdown" }));

    const filesRoute = await import("@/app/api/apps/[appId]/files/route");
    const fileRoute = await import("@/app/api/apps/[appId]/files/[fileId]/route");
    const downloadRoute = await import("@/app/api/apps/[appId]/files/[fileId]/download/route");

    const uploadResponse = await filesRoute.POST(
      makeRequest(`http://test.local/api/apps/${app.id}/files`, { token, formData }),
      { params: Promise.resolve({ appId: String(app.id) }) },
    );
    expect(uploadResponse.status).toBe(201);
    const uploaded = await uploadResponse.json();
    expect(uploaded.file.original_name).toBe("notes.md");
    expect(uploaded.file.content_type).toBe("text/markdown");

    const stored = db.prepare("SELECT * FROM app_files WHERE id = ?").get(uploaded.file.id) as any;
    expect(stored.storage_path).toContain(path.join("uploads", "apps", String(app.id), String(uploaded.file.id)));
    expect(path.basename(stored.storage_path)).toBe(`file-${uploaded.file.id}`);
    expect(stored.storage_path).not.toContain("notes.md");
    expect(stored.status).toBe("available");
    expect(fs.readFileSync(stored.storage_path, "utf8")).toBe("# Notes\n");

    const listResponse = await filesRoute.GET(
      makeRequest(`http://test.local/api/apps/${app.id}/files`, { token }),
      { params: Promise.resolve({ appId: String(app.id) }) },
    );
    expect(listResponse.status).toBe(200);
    const listed = await listResponse.json();
    expect(listed.files).toHaveLength(1);
    expect(listed.files[0].id).toBe(uploaded.file.id);

    const downloadResponse = await downloadRoute.GET(
      makeRequest(`http://test.local/api/apps/${app.id}/files/${uploaded.file.id}/download`, { token }),
      { params: Promise.resolve({ appId: String(app.id), fileId: String(uploaded.file.id) }) },
    );
    expect(downloadResponse.status).toBe(200);
    expect(downloadResponse.headers.get("Content-Type")).toContain("text/markdown");
    expect(await downloadResponse.text()).toBe("# Notes\n");

    const deleteResponse = await fileRoute.DELETE(
      makeRequest(`http://test.local/api/apps/${app.id}/files/${uploaded.file.id}`, { token }),
      { params: Promise.resolve({ appId: String(app.id), fileId: String(uploaded.file.id) }) },
    );
    expect(deleteResponse.status).toBe(200);
    const deleted = await deleteResponse.json();
    expect(deleted.file.status).toBe("deleted");
    expect(fs.existsSync(stored.storage_path)).toBe(false);

    const afterDeleteResponse = await filesRoute.GET(
      makeRequest(`http://test.local/api/apps/${app.id}/files`, { token }),
      { params: Promise.resolve({ appId: String(app.id) }) },
    );
    expect((await afterDeleteResponse.json()).files).toHaveLength(0);
  });

  it("removes app upload storage when the app is deleted", async () => {
    const token = await createAuthToken();
    const appDir = path.join(ctx.tmpDir, "app");
    fs.mkdirSync(appDir, { recursive: true });
    const app = seedApp(db, { directory: appDir });
    const formData = new FormData();
    formData.append("file", new File(["delete me"], "delete-me.txt", { type: "text/plain" }));

    const filesRoute = await import("@/app/api/apps/[appId]/files/route");
    const appRoute = await import("@/app/api/apps/[appId]/route");
    const uploadResponse = await filesRoute.POST(
      makeRequest(`http://test.local/api/apps/${app.id}/files`, { token, formData }),
      { params: Promise.resolve({ appId: String(app.id) }) },
    );
    const uploaded = await uploadResponse.json();
    const stored = db.prepare("SELECT * FROM app_files WHERE id = ?").get(uploaded.file.id) as any;
    expect(fs.existsSync(stored.storage_path)).toBe(true);

    const deleteResponse = await appRoute.DELETE(
      makeRequest(`http://test.local/api/apps/${app.id}`, { token }),
      { params: Promise.resolve({ appId: String(app.id) }) },
    );

    expect(deleteResponse.status).toBe(200);
    expect(fs.existsSync(stored.storage_path)).toBe(false);
    expect(fs.existsSync(path.dirname(stored.storage_path))).toBe(false);
  });

  it("rejects blocked archive uploads", async () => {
    const token = await createAuthToken();
    const app = seedApp(db);
    const formData = new FormData();
    formData.append("file", new File(["zip-ish"], "assets.zip", { type: "application/zip" }));

    const filesRoute = await import("@/app/api/apps/[appId]/files/route");
    const response = await filesRoute.POST(
      makeRequest(`http://test.local/api/apps/${app.id}/files`, { token, formData }),
      { params: Promise.resolve({ appId: String(app.id) }) },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ detail: "File type is not allowed" });
  });

  it("rejects script, secret, and spoofed binary text uploads", async () => {
    const token = await createAuthToken();
    const app = seedApp(db);
    const filesRoute = await import("@/app/api/apps/[appId]/files/route");

    for (const file of [
      new File(["echo bad"], "run.sh", { type: "text/plain" }),
      new File(["SECRET=value"], ".env", { type: "text/plain" }),
      new File(["<?php echo 'bad';"], "payload.php", { type: "text/plain" }),
      new File([new Uint8Array([0, 1, 2, 3, 4])], "note.txt", { type: "text/plain" }),
    ]) {
      const formData = new FormData();
      formData.append("file", file);
      const response = await filesRoute.POST(
        makeRequest(`http://test.local/api/apps/${app.id}/files`, { token, formData }),
        { params: Promise.resolve({ appId: String(app.id) }) },
      );
      expect(response.status).toBe(400);
    }
  });

  it("serves dangerous text types as inert downloads", async () => {
    const token = await createAuthToken();
    const app = seedApp(db);
    const formData = new FormData();
    formData.append("file", new File(["<script>window.pwned=true</script>"], "preview.html", { type: "text/html" }));

    const filesRoute = await import("@/app/api/apps/[appId]/files/route");
    const downloadRoute = await import("@/app/api/apps/[appId]/files/[fileId]/download/route");
    const uploadResponse = await filesRoute.POST(
      makeRequest(`http://test.local/api/apps/${app.id}/files`, { token, formData }),
      { params: Promise.resolve({ appId: String(app.id) }) },
    );
    const uploaded = await uploadResponse.json();

    const downloadResponse = await downloadRoute.GET(
      makeRequest(`http://test.local/api/apps/${app.id}/files/${uploaded.file.id}/download`, { token }),
      { params: Promise.resolve({ appId: String(app.id), fileId: String(uploaded.file.id) }) },
    );

    expect(downloadResponse.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(downloadResponse.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(downloadResponse.headers.get("Content-Security-Policy")).toBe("sandbox");
  });

  it("returns 400 for invalid multipart upload bodies", async () => {
    const token = await createAuthToken();
    const app = seedApp(db);
    const filesRoute = await import("@/app/api/apps/[appId]/files/route");
    const response = await filesRoute.POST(
      makeRequest(`http://test.local/api/apps/${app.id}/files`, { token }),
      { params: Promise.resolve({ appId: String(app.id) }) },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ detail: "Request must be multipart/form-data" });
  });

  it("does not expose files across apps", async () => {
    const token = await createAuthToken();
    const firstApp = seedApp(db, { name: "First" });
    const secondApp = seedApp(db, { name: "Second" });
    const formData = new FormData();
    formData.append("file", new File(["private"], "private.txt", { type: "text/plain" }));

    const filesRoute = await import("@/app/api/apps/[appId]/files/route");
    const downloadRoute = await import("@/app/api/apps/[appId]/files/[fileId]/download/route");

    const uploadResponse = await filesRoute.POST(
      makeRequest(`http://test.local/api/apps/${firstApp.id}/files`, { token, formData }),
      { params: Promise.resolve({ appId: String(firstApp.id) }) },
    );
    const uploaded = await uploadResponse.json();

    const crossAppResponse = await downloadRoute.GET(
      makeRequest(`http://test.local/api/apps/${secondApp.id}/files/${uploaded.file.id}/download`, { token }),
      { params: Promise.resolve({ appId: String(secondApp.id), fileId: String(uploaded.file.id) }) },
    );

    expect(crossAppResponse.status).toBe(404);
  });

  it("persists conversation message attachments and allows file-only messages", async () => {
    const token = await createAuthToken();
    const app = seedApp(db);
    const conversation = db.prepare("INSERT INTO conversations (app_id, kind, title) VALUES (?, 'task', 'Task')").run(app.id);
    const dal = await import("@/lib/server/dal");
    const file = dal.createAppFile({
      app_id: app.id,
      original_name: "requirements.pdf",
      stored_name: "requirements.pdf",
      content_type: "application/pdf",
      size_bytes: 42,
      sha256: "pdfhash",
      storage_path: "/tmp/requirements.pdf",
    });
    const messagesRoute = await import("@/app/api/apps/[appId]/conversations/[conversationId]/messages/route");

    const response = await messagesRoute.POST(
      makeRequest(`http://test.local/api/apps/${app.id}/conversations/${conversation.lastInsertRowid}/messages`, {
        token,
        body: { content: "", file_ids: [file.id] },
      }),
      { params: Promise.resolve({ appId: String(app.id), conversationId: String(conversation.lastInsertRowid) }) },
    );

    expect(response.status).toBe(200);
    const message = await response.json();
    expect(message.body_md).toBe("");
    expect(message.attachments).toHaveLength(1);
    expect(message.attachments[0].original_name).toBe("requirements.pdf");

    const getResponse = await messagesRoute.GET(
      makeRequest(`http://test.local/api/apps/${app.id}/conversations/${conversation.lastInsertRowid}/messages`, { token }),
      { params: Promise.resolve({ appId: String(app.id), conversationId: String(conversation.lastInsertRowid) }) },
    );
    const listed = await getResponse.json();
    expect(listed.messages[0].attachments[0].id).toBe(file.id);
  });

  it("persists room message attachments without requiring text", async () => {
    vi.doMock("@/lib/server/room-agents", () => ({
      createRoomAgentReply: vi.fn(async () => undefined),
    }));
    const token = await createAuthToken();
    const app = seedApp(db);
    const dal = await import("@/lib/server/dal");
    const room = dal.createRoom({ app_id: app.id, title: "Planning", purpose: "Plan" });
    const file = dal.createAppFile({
      app_id: app.id,
      original_name: "wireframe.png",
      stored_name: "wireframe.png",
      content_type: "image/png",
      size_bytes: 18,
      sha256: "imghash",
      storage_path: "/tmp/wireframe.png",
    });
    const messagesRoute = await import("@/app/api/apps/[appId]/rooms/[roomId]/messages/route");

    const response = await messagesRoute.POST(
      makeRequest(`http://test.local/api/apps/${app.id}/rooms/${room.id}/messages`, {
        token,
        body: { file_ids: [file.id] },
      }),
      { params: Promise.resolve({ appId: String(app.id), roomId: String(room.id) }) },
    );

    expect(response.status).toBe(201);
    const message = await response.json();
    expect(message.body_md).toBe("");
    expect(message.attachments[0].original_name).toBe("wireframe.png");
  });
});
