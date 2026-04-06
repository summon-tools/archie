import { getDb } from "../db";
import type { ArtifactRow } from "../types";

export function getArtifacts(workItemId: number, kind?: string): ArtifactRow[] {
  if (kind) {
    return getDb().prepare(
      "SELECT * FROM artifacts WHERE work_item_id = ? AND kind = ? ORDER BY created_at DESC"
    ).all(workItemId, kind) as ArtifactRow[];
  }
  return getDb().prepare(
    "SELECT * FROM artifacts WHERE work_item_id = ? ORDER BY created_at DESC"
  ).all(workItemId) as ArtifactRow[];
}

export function getArtifact(artifactId: number): ArtifactRow | undefined {
  return getDb().prepare("SELECT * FROM artifacts WHERE id = ?").get(artifactId) as ArtifactRow | undefined;
}

export function getArtifactByKind(workItemId: number, kind: string): ArtifactRow | undefined {
  return getDb().prepare(
    "SELECT * FROM artifacts WHERE work_item_id = ? AND kind = ? ORDER BY created_at DESC, id DESC LIMIT 1"
  ).get(workItemId, kind) as ArtifactRow | undefined;
}

export function createArtifact(data: {
  app_id: number;
  work_item_id?: number | null;
  run_id?: number | null;
  kind: string;
  name?: string | null;
  storage_type?: "inline" | "file";
  file_path?: string | null;
  inline_text?: string | null;
  metadata_json?: string | null;
}): ArtifactRow {
  const db = getDb();
  const result = db.prepare(
    `INSERT INTO artifacts (app_id, work_item_id, run_id, kind, name, storage_type, file_path, inline_text, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    data.app_id,
    data.work_item_id ?? null,
    data.run_id ?? null,
    data.kind,
    data.name ?? null,
    data.storage_type || "inline",
    data.file_path ?? null,
    data.inline_text ?? null,
    data.metadata_json ?? null
  );
  return db.prepare("SELECT * FROM artifacts WHERE id = ?").get(result.lastInsertRowid) as ArtifactRow;
}

export function deleteArtifact(artifactId: number): void {
  getDb().prepare("DELETE FROM artifacts WHERE id = ?").run(artifactId);
}

export function deleteArtifactsByKind(workItemId: number, kind: string): void {
  getDb().prepare("DELETE FROM artifacts WHERE work_item_id = ? AND kind = ?").run(workItemId, kind);
}

// ── App-level artifact queries (work_item_id IS NULL) ─────────────

export function getAppArtifacts(appId: number, kind: string): ArtifactRow[] {
  return getDb().prepare(
    "SELECT * FROM artifacts WHERE app_id = ? AND kind = ? AND work_item_id IS NULL ORDER BY created_at DESC"
  ).all(appId, kind) as ArtifactRow[];
}

export function getAppArtifactByTopic(appId: number, topic: string): ArtifactRow | undefined {
  return getDb().prepare(
    `SELECT * FROM artifacts WHERE app_id = ? AND kind = 'app_knowledge' AND work_item_id IS NULL
     AND json_extract(metadata_json, '$.topic') = ? ORDER BY created_at DESC LIMIT 1`
  ).get(appId, topic) as ArtifactRow | undefined;
}

export function deleteAppArtifactsByTopic(appId: number, topic: string): void {
  getDb().prepare(
    `DELETE FROM artifacts WHERE app_id = ? AND kind = 'app_knowledge' AND work_item_id IS NULL
     AND json_extract(metadata_json, '$.topic') = ?`
  ).run(appId, topic);
}

export function getArtifactsByAppAndKind(appId: number, kind: string, limit = 20): ArtifactRow[] {
  return getDb().prepare(
    "SELECT * FROM artifacts WHERE app_id = ? AND kind = ? ORDER BY created_at DESC LIMIT ?"
  ).all(appId, kind, limit) as ArtifactRow[];
}

export function getLatestAppArtifact(appId: number, kind: string): ArtifactRow | undefined {
  return getDb().prepare(
    "SELECT * FROM artifacts WHERE app_id = ? AND kind = ? ORDER BY created_at DESC, id DESC LIMIT 1"
  ).get(appId, kind) as ArtifactRow | undefined;
}
