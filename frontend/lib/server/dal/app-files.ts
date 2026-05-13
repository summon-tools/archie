import { getDb } from "../db";
import type { AppFileLinkRow, AppFileLinkType, AppFileRow } from "../types";

export type AppFileWithLink = AppFileRow & {
  link_id: number | null;
  link_type: AppFileLinkType | null;
};

export function createAppFile(data: {
  app_id: number;
  uploaded_by_user_id?: number | null;
  original_name: string;
  stored_name: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  storage_path: string;
  status?: AppFileRow["status"];
  metadata_json?: string | null;
}): AppFileRow {
  const db = getDb();
  const result = db.prepare(
    `INSERT INTO app_files (
       app_id, uploaded_by_user_id, original_name, stored_name, content_type,
       size_bytes, sha256, storage_path, status, metadata_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    data.app_id,
    data.uploaded_by_user_id ?? null,
    data.original_name,
    data.stored_name,
    data.content_type,
    data.size_bytes,
    data.sha256,
    data.storage_path,
    data.status ?? "available",
    data.metadata_json ?? null,
  );
  return db.prepare("SELECT * FROM app_files WHERE id = ?").get(result.lastInsertRowid) as AppFileRow;
}

export function updateAppFileStoragePath(appId: number, fileId: number, data: {
  stored_name: string;
  storage_path: string;
}): AppFileRow {
  const result = getDb().prepare(
    "UPDATE app_files SET stored_name = ?, storage_path = ?, status = 'available' WHERE app_id = ? AND id = ?"
  ).run(data.stored_name, data.storage_path, appId, fileId);
  if (result.changes === 0) throw new Error(`app_files row not found: ${fileId}`);
  return getAppFile(appId, fileId)!;
}

export function getAppFile(appId: number, fileId: number): AppFileRow | undefined {
  return getDb().prepare(
    "SELECT * FROM app_files WHERE app_id = ? AND id = ?"
  ).get(appId, fileId) as AppFileRow | undefined;
}

export function listAppFiles(appId: number, includeDeleted = false): AppFileRow[] {
  const where = includeDeleted ? "app_id = ? AND status != 'uploading'" : "app_id = ? AND status = 'available'";
  return getDb().prepare(
    `SELECT * FROM app_files WHERE ${where} ORDER BY created_at DESC, id DESC`
  ).all(appId) as AppFileRow[];
}

export function markAppFileDeleted(appId: number, fileId: number): AppFileRow {
  const result = getDb().prepare(
    `UPDATE app_files
     SET status = 'deleted', deleted_at = datetime('now')
     WHERE app_id = ? AND id = ? AND status != 'deleted'`
  ).run(appId, fileId);
  if (result.changes === 0) {
    const existing = getAppFile(appId, fileId);
    if (!existing) throw new Error(`app_files row not found: ${fileId}`);
    return existing;
  }
  return getAppFile(appId, fileId)!;
}

export function createAppFileLink(data: {
  app_id: number;
  app_file_id: number;
  room_id?: number | null;
  room_message_id?: number | null;
  conversation_id?: number | null;
  message_id?: number | null;
  work_item_id?: number | null;
  plan_step_id?: number | null;
  link_type?: AppFileLinkType;
}): AppFileLinkRow {
  const db = getDb();
  const existing = db.prepare(
    `SELECT * FROM app_file_links
     WHERE app_id = ?
       AND app_file_id = ?
       AND COALESCE(room_id, -1) = ?
       AND COALESCE(room_message_id, -1) = ?
       AND COALESCE(conversation_id, -1) = ?
       AND COALESCE(message_id, -1) = ?
       AND COALESCE(work_item_id, -1) = ?
       AND COALESCE(plan_step_id, -1) = ?
       AND link_type = ?
     LIMIT 1`
  ).get(
    data.app_id,
    data.app_file_id,
    data.room_id ?? -1,
    data.room_message_id ?? -1,
    data.conversation_id ?? -1,
    data.message_id ?? -1,
    data.work_item_id ?? -1,
    data.plan_step_id ?? -1,
    data.link_type ?? "attachment",
  ) as AppFileLinkRow | undefined;
  if (existing) return existing;

  const result = db.prepare(
    `INSERT INTO app_file_links (
       app_id, app_file_id, room_id, room_message_id, conversation_id,
       message_id, work_item_id, plan_step_id, link_type
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    data.app_id,
    data.app_file_id,
    data.room_id ?? null,
    data.room_message_id ?? null,
    data.conversation_id ?? null,
    data.message_id ?? null,
    data.work_item_id ?? null,
    data.plan_step_id ?? null,
    data.link_type ?? "attachment",
  );
  return db.prepare("SELECT * FROM app_file_links WHERE id = ?").get(result.lastInsertRowid) as AppFileLinkRow;
}

export function linkAppFiles(data: {
  app_id: number;
  file_ids: number[];
  room_id?: number | null;
  room_message_id?: number | null;
  conversation_id?: number | null;
  message_id?: number | null;
  work_item_id?: number | null;
  plan_step_id?: number | null;
  link_type?: AppFileLinkType;
}): AppFileLinkRow[] {
  const db = getDb();
  const uniqueIds = Array.from(new Set(data.file_ids));
  if (uniqueIds.length === 0) return [];
  return db.transaction(() => uniqueIds.map((fileId) => {
    const file = getAppFile(data.app_id, fileId);
    if (!file || file.status !== "available") {
      throw new Error(`File not found: ${fileId}`);
    }
    return createAppFileLink({
      app_id: data.app_id,
      app_file_id: fileId,
      room_id: data.room_id,
      room_message_id: data.room_message_id,
      conversation_id: data.conversation_id,
      message_id: data.message_id,
      work_item_id: data.work_item_id,
      plan_step_id: data.plan_step_id,
      link_type: data.link_type,
    });
  }))();
}

function linkedFilesQuery(where: string): string {
  return `
    SELECT f.*, l.id as link_id, l.link_type as link_type
    FROM app_file_links l
    JOIN app_files f ON f.id = l.app_file_id
    WHERE ${where}
    ORDER BY l.id ASC
  `;
}

export function getFilesForMessage(appId: number, messageId: number): AppFileWithLink[] {
  return getDb().prepare(linkedFilesQuery("l.app_id = ? AND l.message_id = ?"))
    .all(appId, messageId) as AppFileWithLink[];
}

export function getFilesForRoomMessage(appId: number, roomMessageId: number): AppFileWithLink[] {
  return getDb().prepare(linkedFilesQuery("l.app_id = ? AND l.room_message_id = ?"))
    .all(appId, roomMessageId) as AppFileWithLink[];
}

export function getFilesForConversation(appId: number, conversationId: number): AppFileWithLink[] {
  return getDb().prepare(linkedFilesQuery("l.app_id = ? AND l.conversation_id = ?"))
    .all(appId, conversationId) as AppFileWithLink[];
}

export function getFilesForRoom(appId: number, roomId: number): AppFileWithLink[] {
  return getDb().prepare(linkedFilesQuery("l.app_id = ? AND l.room_id = ?"))
    .all(appId, roomId) as AppFileWithLink[];
}

export function getFilesForWorkItem(appId: number, workItemId: number): AppFileWithLink[] {
  return getDb().prepare(linkedFilesQuery("l.app_id = ? AND l.work_item_id = ?"))
    .all(appId, workItemId) as AppFileWithLink[];
}

export function linkRoomFilesToWorkItem(data: {
  app_id: number;
  room_id: number;
  work_item_id: number;
  conversation_id: number;
}): AppFileLinkRow[] {
  const files = getFilesForRoom(data.app_id, data.room_id).filter((file) => file.status === "available");
  return linkAppFiles({
    app_id: data.app_id,
    file_ids: files.map((file) => file.id),
    work_item_id: data.work_item_id,
    conversation_id: data.conversation_id,
    link_type: "context",
  });
}
