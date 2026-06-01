import Database from "better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";
import { execSync } from "child_process";
import { DB_PATH } from "./config";

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  // Ensure data directory exists
  const dir = path.dirname(DB_PATH);
  fs.mkdirSync(dir, { recursive: true });

  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");

  initDb(_db);
  return _db;
}

function initDb(db: Database.Database): void {
  // ── Check for legacy schema and reset if needed ───────────────
  resetIfLegacySchema(db);

  // ── Core tables ───────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS apps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      port INTEGER NOT NULL,
      description TEXT DEFAULT '',
      directory TEXT DEFAULT '',
      github_repo TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'member',
      email TEXT DEFAULT NULL,
      color TEXT DEFAULT NULL,
      deleted_at TEXT DEFAULT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS invitations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      invited_by INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      accepted_at TEXT DEFAULT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (invited_by) REFERENCES users(id)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);
  `);

  // ── Conversation tables ───────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      app_id INTEGER NOT NULL,
      kind TEXT NOT NULL DEFAULT 'task' CHECK(kind IN ('task', 'chat', 'conversation')),
      title TEXT NOT NULL DEFAULT 'New conversation',
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'closed', 'archived')),
      created_by INTEGER DEFAULT NULL,
      last_message_at TEXT DEFAULT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_conversations_app_id ON conversations(app_id);
    CREATE INDEX IF NOT EXISTS idx_conversations_kind ON conversations(kind);

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL,
      seq INTEGER NOT NULL DEFAULT 0,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
      kind TEXT NOT NULL DEFAULT 'text',
      author_user_id INTEGER DEFAULT NULL,
      body_md TEXT NOT NULL DEFAULT '',
      payload_json TEXT DEFAULT NULL,
      model_id TEXT DEFAULT NULL,
      provider_id TEXT DEFAULT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_messages_conversation_seq ON messages(conversation_id, seq);

    CREATE TABLE IF NOT EXISTS work_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      app_id INTEGER NOT NULL,
      primary_conversation_id INTEGER DEFAULT NULL,
      title TEXT NOT NULL,
      summary TEXT DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'task' CHECK(kind IN ('task', 'setup')),
      status TEXT NOT NULL DEFAULT 'in_progress' CHECK(status IN ('proposed', 'in_progress', 'done')),
      position INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER DEFAULT NULL,
      assigned_to INTEGER DEFAULT NULL,
      legacy_task_id INTEGER DEFAULT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE,
      FOREIGN KEY (primary_conversation_id) REFERENCES conversations(id)
    );
    CREATE INDEX IF NOT EXISTS idx_work_items_app_id ON work_items(app_id);
    CREATE INDEX IF NOT EXISTS idx_work_items_status ON work_items(status);

    CREATE TABLE IF NOT EXISTS work_item_env (
      work_item_id INTEGER PRIMARY KEY,
      branch_name TEXT DEFAULT NULL,
      worktree_dir TEXT DEFAULT NULL,
      worktree_status TEXT DEFAULT NULL,
      branch_source TEXT NOT NULL DEFAULT 'generated',
      delete_branch_on_remove INTEGER NOT NULL DEFAULT 1,
      preview_port INTEGER DEFAULT NULL,
      preview_pid INTEGER DEFAULT NULL,
      FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS github_user_connections (
      user_id INTEGER PRIMARY KEY,
      github_user_id INTEGER NOT NULL,
      github_login TEXT NOT NULL,
      github_name TEXT DEFAULT NULL,
      github_email TEXT DEFAULT NULL,
      access_token_ciphertext TEXT NOT NULL,
      refresh_token_ciphertext TEXT DEFAULT NULL,
      access_token_expires_at TEXT DEFAULT NULL,
      refresh_token_expires_at TEXT DEFAULT NULL,
      connected_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      revoked_at TEXT DEFAULT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_github_user_connections_login ON github_user_connections(github_login);

    CREATE TABLE IF NOT EXISTS agent_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL,
      provider_id TEXT NOT NULL DEFAULT 'claude',
      external_session_id TEXT DEFAULT NULL,
      status TEXT DEFAULT NULL,
      last_model_id TEXT DEFAULT NULL,
      metadata_json TEXT DEFAULT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_agent_sessions_conversation_id ON agent_sessions(conversation_id);

    CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      app_id INTEGER NOT NULL,
      conversation_id INTEGER DEFAULT NULL,
      work_item_id INTEGER DEFAULT NULL,
      session_id INTEGER DEFAULT NULL,
      workflow_key TEXT DEFAULT NULL,
      status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running', 'completed', 'failed', 'stopped')),
      provider_id TEXT DEFAULT 'claude',
      model_id TEXT DEFAULT NULL,
      input_json TEXT DEFAULT NULL,
      state_json TEXT DEFAULT NULL,
      result_json TEXT DEFAULT NULL,
      error_text TEXT DEFAULT NULL,
      budget_json TEXT DEFAULT NULL,
      failure_category TEXT DEFAULT NULL,
      heartbeat_at TEXT DEFAULT NULL,
      progress_text TEXT DEFAULT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id),
      FOREIGN KEY (work_item_id) REFERENCES work_items(id),
      FOREIGN KEY (session_id) REFERENCES agent_sessions(id)
    );
    CREATE INDEX IF NOT EXISTS idx_runs_app_id ON runs(app_id);
    CREATE INDEX IF NOT EXISTS idx_runs_conversation_id ON runs(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
    CREATE INDEX IF NOT EXISTS idx_runs_workflow_key ON runs(workflow_key);

    CREATE TABLE IF NOT EXISTS artifacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      app_id INTEGER NOT NULL,
      work_item_id INTEGER DEFAULT NULL,
      run_id INTEGER DEFAULT NULL,
      kind TEXT NOT NULL,
      name TEXT DEFAULT NULL,
      storage_type TEXT NOT NULL DEFAULT 'inline' CHECK(storage_type IN ('inline', 'file')),
      file_path TEXT DEFAULT NULL,
      inline_text TEXT DEFAULT NULL,
      metadata_json TEXT DEFAULT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE,
      FOREIGN KEY (work_item_id) REFERENCES work_items(id),
      FOREIGN KEY (run_id) REFERENCES runs(id)
    );
    CREATE INDEX IF NOT EXISTS idx_artifacts_work_item_id ON artifacts(work_item_id);
    CREATE INDEX IF NOT EXISTS idx_artifacts_kind ON artifacts(kind);
    CREATE INDEX IF NOT EXISTS idx_artifacts_app_kind ON artifacts(app_id, kind) WHERE work_item_id IS NULL;

    CREATE TABLE IF NOT EXISTS github_pr_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      app_id INTEGER NOT NULL,
      work_item_id INTEGER NOT NULL,
      owner TEXT NOT NULL,
      repo TEXT NOT NULL,
      pr_number INTEGER NOT NULL,
      pr_url TEXT NOT NULL,
      title TEXT DEFAULT '',
      state TEXT NOT NULL DEFAULT 'UNKNOWN',
      author_login TEXT DEFAULT NULL,
      head_ref TEXT DEFAULT NULL,
      base_ref TEXT DEFAULT NULL,
      merged_at TEXT DEFAULT NULL,
      closed_at TEXT DEFAULT NULL,
      github_created_at TEXT DEFAULT NULL,
      github_updated_at TEXT DEFAULT NULL,
      additions INTEGER DEFAULT NULL,
      deletions INTEGER DEFAULT NULL,
      changed_files INTEGER DEFAULT NULL,
      commits_count INTEGER DEFAULT NULL,
      issue_comments_count INTEGER DEFAULT NULL,
      review_comments_count INTEGER DEFAULT NULL,
      reviews_count INTEGER DEFAULT NULL,
      raw_json TEXT DEFAULT NULL,
      synced_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(owner, repo, pr_number),
      FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE,
      FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_github_pr_snapshots_work_item_id ON github_pr_snapshots(work_item_id);
    CREATE INDEX IF NOT EXISTS idx_github_pr_snapshots_synced_at ON github_pr_snapshots(synced_at);

    CREATE TABLE IF NOT EXISTS github_pr_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pr_snapshot_id INTEGER NOT NULL,
      app_id INTEGER NOT NULL,
      work_item_id INTEGER NOT NULL,
      github_id INTEGER NOT NULL,
      comment_type TEXT NOT NULL CHECK(comment_type IN ('issue', 'review')),
      author_login TEXT DEFAULT NULL,
      body TEXT NOT NULL DEFAULT '',
      path TEXT DEFAULT NULL,
      commit_id TEXT DEFAULT NULL,
      github_created_at TEXT DEFAULT NULL,
      github_updated_at TEXT DEFAULT NULL,
      raw_json TEXT DEFAULT NULL,
      synced_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(comment_type, github_id),
      FOREIGN KEY (pr_snapshot_id) REFERENCES github_pr_snapshots(id) ON DELETE CASCADE,
      FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE,
      FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_github_pr_comments_snapshot_id ON github_pr_comments(pr_snapshot_id);
    CREATE INDEX IF NOT EXISTS idx_github_pr_comments_work_item_id ON github_pr_comments(work_item_id);

    CREATE TABLE IF NOT EXISTS github_pr_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pr_snapshot_id INTEGER NOT NULL,
      app_id INTEGER NOT NULL,
      work_item_id INTEGER NOT NULL,
      github_id INTEGER NOT NULL,
      author_login TEXT DEFAULT NULL,
      state TEXT DEFAULT NULL,
      body TEXT NOT NULL DEFAULT '',
      submitted_at TEXT DEFAULT NULL,
      raw_json TEXT DEFAULT NULL,
      synced_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(github_id),
      FOREIGN KEY (pr_snapshot_id) REFERENCES github_pr_snapshots(id) ON DELETE CASCADE,
      FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE,
      FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_github_pr_reviews_snapshot_id ON github_pr_reviews(pr_snapshot_id);
    CREATE INDEX IF NOT EXISTS idx_github_pr_reviews_work_item_id ON github_pr_reviews(work_item_id);

    CREATE TABLE IF NOT EXISTS github_pr_commits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pr_snapshot_id INTEGER NOT NULL,
      app_id INTEGER NOT NULL,
      work_item_id INTEGER NOT NULL,
      sha TEXT NOT NULL,
      author_login TEXT DEFAULT NULL,
      author_name TEXT DEFAULT NULL,
      author_email TEXT DEFAULT NULL,
      committer_login TEXT DEFAULT NULL,
      message TEXT NOT NULL DEFAULT '',
      authored_at TEXT DEFAULT NULL,
      committed_at TEXT DEFAULT NULL,
      raw_json TEXT DEFAULT NULL,
      synced_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(pr_snapshot_id, sha),
      FOREIGN KEY (pr_snapshot_id) REFERENCES github_pr_snapshots(id) ON DELETE CASCADE,
      FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE,
      FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_github_pr_commits_snapshot_id ON github_pr_commits(pr_snapshot_id);
    CREATE INDEX IF NOT EXISTS idx_github_pr_commits_work_item_id ON github_pr_commits(work_item_id);

    CREATE TABLE IF NOT EXISTS github_outcome_sync_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      requested_by_user_id INTEGER DEFAULT NULL,
      mode TEXT NOT NULL DEFAULT 'manual' CHECK(mode IN ('manual', 'scheduled')),
      status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running', 'completed', 'failed')),
      range_start TEXT DEFAULT NULL,
      range_end TEXT DEFAULT NULL,
      scanned_count INTEGER NOT NULL DEFAULT 0,
      synced_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      warnings_json TEXT DEFAULT NULL,
      error_text TEXT DEFAULT NULL,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT DEFAULT NULL,
      FOREIGN KEY (requested_by_user_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_github_outcome_sync_runs_started_at ON github_outcome_sync_runs(started_at);

    CREATE TABLE IF NOT EXISTS llm_outcome_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      app_id INTEGER NOT NULL,
      work_item_id INTEGER NOT NULL,
      conversation_id INTEGER DEFAULT NULL,
      session_id INTEGER DEFAULT NULL,
      pr_snapshot_id INTEGER DEFAULT NULL,
      pr_author_login TEXT DEFAULT NULL,
      pr_author_classification TEXT NOT NULL DEFAULT 'unknown' CHECK(pr_author_classification IN ('agent', 'known_user', 'human', 'unknown')),
      pr_author_confidence TEXT NOT NULL DEFAULT 'unknown' CHECK(pr_author_confidence IN ('unknown', 'low', 'medium', 'high')),
      attribution_confidence TEXT NOT NULL DEFAULT 'unknown' CHECK(attribution_confidence IN ('unknown', 'low', 'medium', 'high')),
      outcome_state TEXT NOT NULL CHECK(outcome_state IN ('no_pr', 'pending_pr', 'merged', 'closed_unmerged', 'unknown')),
      quality_band TEXT NOT NULL CHECK(quality_band IN ('pending', 'strong', 'useful', 'costly_reworked', 'abandoned', 'unknown')),
      confidence TEXT NOT NULL CHECK(confidence IN ('low', 'medium', 'high')),
      known_cost_usd REAL DEFAULT NULL,
      unknown_cost_runs INTEGER NOT NULL DEFAULT 0,
      issue_comment_count INTEGER NOT NULL DEFAULT 0,
      review_comment_count INTEGER NOT NULL DEFAULT 0,
      review_count INTEGER NOT NULL DEFAULT 0,
      commit_count INTEGER NOT NULL DEFAULT 0,
      human_commit_count INTEGER NOT NULL DEFAULT 0,
      agent_commit_count INTEGER NOT NULL DEFAULT 0,
      coauthored_commit_count INTEGER NOT NULL DEFAULT 0,
      unknown_commit_count INTEGER NOT NULL DEFAULT 0,
      human_after_agent_commit_count INTEGER NOT NULL DEFAULT 0,
      correction_burden_score INTEGER NOT NULL DEFAULT 0,
      evidence_json TEXT DEFAULT NULL,
      computed_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(work_item_id),
      FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE,
      FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE CASCADE,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id),
      FOREIGN KEY (session_id) REFERENCES agent_sessions(id),
      FOREIGN KEY (pr_snapshot_id) REFERENCES github_pr_snapshots(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_llm_outcome_snapshots_app_id ON llm_outcome_snapshots(app_id);
    CREATE INDEX IF NOT EXISTS idx_llm_outcome_snapshots_quality_band ON llm_outcome_snapshots(quality_band);
    CREATE INDEX IF NOT EXISTS idx_llm_outcome_snapshots_computed_at ON llm_outcome_snapshots(computed_at);

    CREATE TABLE IF NOT EXISTS app_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      app_id INTEGER NOT NULL,
      uploaded_by_user_id INTEGER DEFAULT NULL,
      original_name TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
      size_bytes INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      storage_path TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('uploading', 'available', 'deleted')),
      metadata_json TEXT DEFAULT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      deleted_at TEXT DEFAULT NULL,
      FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE,
      FOREIGN KEY (uploaded_by_user_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_app_files_app_id ON app_files(app_id);
    CREATE INDEX IF NOT EXISTS idx_app_files_status ON app_files(status);
    CREATE INDEX IF NOT EXISTS idx_app_files_sha256 ON app_files(app_id, sha256);

    CREATE TABLE IF NOT EXISTS app_file_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      app_id INTEGER NOT NULL,
      app_file_id INTEGER NOT NULL,
      room_id INTEGER DEFAULT NULL,
      room_message_id INTEGER DEFAULT NULL,
      conversation_id INTEGER DEFAULT NULL,
      message_id INTEGER DEFAULT NULL,
      work_item_id INTEGER DEFAULT NULL,
      plan_step_id INTEGER DEFAULT NULL,
      link_type TEXT NOT NULL DEFAULT 'attachment' CHECK(link_type IN ('attachment', 'context')),
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE,
      FOREIGN KEY (app_file_id) REFERENCES app_files(id) ON DELETE CASCADE,
      FOREIGN KEY (room_id) REFERENCES home_rooms(id) ON DELETE CASCADE,
      FOREIGN KEY (room_message_id) REFERENCES room_messages(id) ON DELETE CASCADE,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
      FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE CASCADE,
      FOREIGN KEY (plan_step_id) REFERENCES plan_steps(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_app_file_links_file_id ON app_file_links(app_file_id);
    CREATE INDEX IF NOT EXISTS idx_app_file_links_room ON app_file_links(room_id);
    CREATE INDEX IF NOT EXISTS idx_app_file_links_room_message ON app_file_links(room_message_id);
    CREATE INDEX IF NOT EXISTS idx_app_file_links_conversation ON app_file_links(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_app_file_links_message ON app_file_links(message_id);
    CREATE INDEX IF NOT EXISTS idx_app_file_links_work_item ON app_file_links(work_item_id);

    CREATE TABLE IF NOT EXISTS app_tool_configs (
      app_id INTEGER NOT NULL,
      tool_key TEXT NOT NULL,
      config_json TEXT NOT NULL DEFAULT '{}',
      PRIMARY KEY (app_id, tool_key),
      FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS home_agent_configs (
      agent_key TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT '',
      prompt TEXT NOT NULL DEFAULT '',
      provider_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (agent_key)
    );

    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL DEFAULT '{}'
    );

    -- Terminal & process console tables
    CREATE TABLE IF NOT EXISTS terminal_sessions (
      id TEXT PRIMARY KEY,
      app_id INTEGER DEFAULT NULL,
      work_item_id INTEGER DEFAULT NULL,
      label TEXT NOT NULL DEFAULT 'Terminal',
      cwd TEXT NOT NULL,
      shell TEXT NOT NULL,
      cols INTEGER NOT NULL DEFAULT 80,
      rows INTEGER NOT NULL DEFAULT 24,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','closed')),
      created_by INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      closed_at TEXT DEFAULT NULL,
      FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE SET NULL,
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS managed_processes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      app_id INTEGER NOT NULL,
      work_item_id INTEGER DEFAULT NULL,
      kind TEXT NOT NULL DEFAULT 'app' CHECK(kind IN ('app','preview','install','custom')),
      pid INTEGER DEFAULT NULL,
      port INTEGER DEFAULT NULL,
      log_path TEXT DEFAULT NULL,
      status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running','stopped','crashed')),
      started_at TEXT DEFAULT (datetime('now')),
      stopped_at TEXT DEFAULT NULL,
      FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE
    );
  `);

  // ── Automation & notification tables (RFC 23) ──────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      app_id INTEGER NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'unread' CHECK(status IN ('unread', 'read')),
      title TEXT NOT NULL,
      summary_md TEXT DEFAULT '',
      recipient_user_id INTEGER DEFAULT NULL,
      subject_user_id INTEGER DEFAULT NULL,
      related_conversation_id INTEGER DEFAULT NULL,
      related_work_item_id INTEGER DEFAULT NULL,
      automation_key TEXT DEFAULT NULL,
      automation_run_id INTEGER DEFAULT NULL,
      metadata_json TEXT DEFAULT NULL,
      read_at TEXT DEFAULT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_app_id ON notifications(app_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient_user_id, status);
    CREATE INDEX IF NOT EXISTS idx_notifications_automation ON notifications(automation_key, automation_run_id);

    CREATE TABLE IF NOT EXISTS automation_configs (
      app_id INTEGER NOT NULL,
      automation_key TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      cron_expression TEXT DEFAULT NULL,
      config_json TEXT NOT NULL DEFAULT '{}',
      last_run_at TEXT DEFAULT NULL,
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (app_id, automation_key),
      FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS automation_leases (
      app_id INTEGER NOT NULL,
      automation_key TEXT NOT NULL,
      window_key TEXT NOT NULL,
      run_id INTEGER NOT NULL,
      acquired_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (app_id, automation_key, window_key),
      FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE
    );
  `);

  // ── Home rooms and structured plans ───────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS home_rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      app_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      purpose TEXT DEFAULT '',
      planning_context_md TEXT NOT NULL DEFAULT '',
      planning_context_updated_at TEXT DEFAULT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'archived')),
      created_by INTEGER DEFAULT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_home_rooms_app_id ON home_rooms(app_id);
    CREATE INDEX IF NOT EXISTS idx_home_rooms_status ON home_rooms(status);

    CREATE TABLE IF NOT EXISTS room_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id INTEGER NOT NULL,
      author_user_id INTEGER DEFAULT NULL,
      agent_key TEXT DEFAULT NULL,
      role TEXT NOT NULL CHECK(role IN ('user', 'agent', 'system')),
      kind TEXT NOT NULL DEFAULT 'message' CHECK(kind IN ('message', 'decision', 'plan_update', 'execution_event', 'error')),
      body_md TEXT NOT NULL DEFAULT '',
      payload_json TEXT DEFAULT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (room_id) REFERENCES home_rooms(id) ON DELETE CASCADE,
      FOREIGN KEY (author_user_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_room_messages_room_id ON room_messages(room_id);

    CREATE TABLE IF NOT EXISTS room_agent_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id INTEGER NOT NULL,
      agent_key TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      model_id TEXT DEFAULT NULL,
      phase TEXT NOT NULL CHECK(phase IN ('planning', 'critique', 'coordination', 'review', 'security', 'qa')),
      tool_policy_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running', 'completed', 'failed', 'stopped')),
      input_json TEXT DEFAULT NULL,
      result_json TEXT DEFAULT NULL,
      error_text TEXT DEFAULT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (room_id) REFERENCES home_rooms(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_room_agent_runs_room_id ON room_agent_runs(room_id);
    CREATE INDEX IF NOT EXISTS idx_room_agent_runs_status ON room_agent_runs(status);

    CREATE TABLE IF NOT EXISTS plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      summary_md TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'ready', 'executing', 'completed', 'blocked', 'cancelled')),
      execution_state TEXT NOT NULL DEFAULT 'idle' CHECK(execution_state IN ('idle', 'running', 'paused', 'completed')),
      execution_started_at TEXT DEFAULT NULL,
      execution_paused_at TEXT DEFAULT NULL,
      execution_paused_ms INTEGER NOT NULL DEFAULT 0,
      current_version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (room_id) REFERENCES home_rooms(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_plans_room_id ON plans(room_id);
    CREATE INDEX IF NOT EXISTS idx_plans_status ON plans(status);

    CREATE TABLE IF NOT EXISTS plan_steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_id INTEGER NOT NULL,
      position INTEGER NOT NULL,
      title TEXT NOT NULL,
      objective_md TEXT NOT NULL DEFAULT '',
      implementation_prompt_md TEXT NOT NULL DEFAULT '',
      acceptance_criteria_md TEXT NOT NULL DEFAULT '',
      risk_level TEXT NOT NULL DEFAULT 'medium' CHECK(risk_level IN ('low', 'medium', 'high')),
      requires_architecture_review INTEGER NOT NULL DEFAULT 0,
      requires_security_review INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'implementing', 'reviewing', 'fixing', 'validating', 'committing', 'completed', 'blocked', 'failed', 'skipped')),
      linked_work_item_id INTEGER DEFAULT NULL,
      linked_conversation_id INTEGER DEFAULT NULL,
      fix_attempts INTEGER NOT NULL DEFAULT 0,
      base_commit_sha TEXT DEFAULT NULL,
      commit_sha TEXT DEFAULT NULL,
      result_summary_md TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE CASCADE,
      FOREIGN KEY (linked_work_item_id) REFERENCES work_items(id),
      FOREIGN KEY (linked_conversation_id) REFERENCES conversations(id)
    );
    CREATE INDEX IF NOT EXISTS idx_plan_steps_plan_id ON plan_steps(plan_id);
    CREATE INDEX IF NOT EXISTS idx_plan_steps_status ON plan_steps(status);
    CREATE INDEX IF NOT EXISTS idx_plan_steps_linked_conversation_id ON plan_steps(linked_conversation_id);

    CREATE TABLE IF NOT EXISTS plan_step_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_step_id INTEGER NOT NULL,
      phase TEXT NOT NULL CHECK(phase IN ('implementation', 'architecture_review', 'code_review', 'security_review', 'qa_validation', 'commit')),
      agent_key TEXT DEFAULT NULL,
      status TEXT NOT NULL CHECK(status IN ('started', 'pending', 'running', 'completed', 'failed', 'skipped')),
      summary_md TEXT DEFAULT '',
      payload_json TEXT DEFAULT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (plan_step_id) REFERENCES plan_steps(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_plan_step_events_step_id ON plan_step_events(plan_step_id);
  `);

  // ── Schema evolution (RFC 23) — add columns to existing tables ─
  addColumnIfMissing(db, "apps", "project_owner_user_id", "INTEGER DEFAULT NULL");

  addColumnIfMissing(db, "work_items", "completed_at", "TEXT DEFAULT NULL");
  addColumnIfMissing(db, "work_items", "completed_by_user_id", "INTEGER DEFAULT NULL");
  addColumnIfMissing(db, "work_items", "origin_type", "TEXT NOT NULL DEFAULT 'user'");
  addColumnIfMissing(db, "work_items", "origin_automation_key", "TEXT DEFAULT NULL");
  addColumnIfMissing(db, "work_items", "origin_run_id", "INTEGER DEFAULT NULL");

  addColumnIfMissing(db, "work_item_env", "branch_source", "TEXT NOT NULL DEFAULT 'generated'");
  addColumnIfMissing(db, "work_item_env", "delete_branch_on_remove", "INTEGER NOT NULL DEFAULT 1");

  addColumnIfMissing(db, "llm_outcome_snapshots", "pr_author_login", "TEXT DEFAULT NULL");
  addColumnIfMissing(db, "llm_outcome_snapshots", "pr_author_classification", "TEXT NOT NULL DEFAULT 'unknown'");
  addColumnIfMissing(db, "llm_outcome_snapshots", "pr_author_confidence", "TEXT NOT NULL DEFAULT 'unknown'");
  addColumnIfMissing(db, "llm_outcome_snapshots", "attribution_confidence", "TEXT NOT NULL DEFAULT 'unknown'");

  addColumnIfMissing(db, "conversations", "origin_type", "TEXT NOT NULL DEFAULT 'user'");
  addColumnIfMissing(db, "conversations", "origin_automation_key", "TEXT DEFAULT NULL");
  addColumnIfMissing(db, "conversations", "origin_run_id", "INTEGER DEFAULT NULL");

  addColumnIfMissing(db, "home_rooms", "planning_context_md", "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(db, "home_rooms", "planning_context_updated_at", "TEXT DEFAULT NULL");

  addColumnIfMissing(db, "plans", "execution_state", "TEXT NOT NULL DEFAULT 'idle'");
  addColumnIfMissing(db, "plans", "execution_started_at", "TEXT DEFAULT NULL");
  addColumnIfMissing(db, "plans", "execution_paused_at", "TEXT DEFAULT NULL");
  addColumnIfMissing(db, "plans", "execution_paused_ms", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "plan_steps", "fix_attempts", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "plan_steps", "base_commit_sha", "TEXT DEFAULT NULL");
  addColumnIfMissing(db, "plan_step_events", "updated_at", "TEXT DEFAULT NULL");
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_plan_steps_linked_conversation_id ON plan_steps(linked_conversation_id);

    UPDATE plan_step_events
    SET updated_at = COALESCE(created_at, datetime('now'))
    WHERE updated_at IS NULL;

    UPDATE plan_step_events
    SET phase = 'code_review'
    WHERE phase NOT IN ('implementation', 'architecture_review', 'code_review', 'security_review', 'qa_validation', 'commit');

    UPDATE plan_step_events
    SET status = CASE
      WHEN status IN ('passed', 'done') THEN 'completed'
      WHEN status IN ('error', 'blocked') THEN 'failed'
      ELSE 'pending'
    END
    WHERE status NOT IN ('started', 'pending', 'running', 'completed', 'failed', 'skipped');

    UPDATE plans
    SET execution_state = 'idle'
    WHERE execution_state NOT IN ('idle', 'running', 'paused', 'completed');

    UPDATE plans
    SET execution_state = 'running',
        execution_started_at = COALESCE(execution_started_at, updated_at, created_at)
    WHERE status = 'executing' AND execution_state = 'idle';

    UPDATE plans
    SET execution_state = 'completed',
        execution_paused_at = NULL
    WHERE status = 'completed' AND execution_state != 'completed';

    UPDATE plan_step_events
    SET status = 'pending',
        updated_at = datetime('now')
    WHERE status = 'running'
      AND datetime(COALESCE(updated_at, created_at)) < datetime('now', '-30 minutes');
  `);

  // ── Migrate app file status constraints ───────────────────────
  ensureAppFilesUploadingStatus(db);

  // ── Clean stale agent sessions ────────────────────────────────
  db.exec("UPDATE agent_sessions SET status = 'idle' WHERE status = 'running'");

  // ── Backfill user colors ──────────────────────────────────────
  backfillUserColors(db);

  // ── Ensure automation system user exists (RFC 23) ─────────────
  ensureAutomationUser(db);
}

/**
 * Detect legacy schema (old "threads" table or other legacy tables) and
 * reset the database. Early users are okay with a full data reset.
 */
function resetIfLegacySchema(db: Database.Database): void {
  const hasLegacyThreads = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='threads'"
  ).get();
  const hasLegacyTasks = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='tasks'"
  ).get();

  if (hasLegacyThreads || hasLegacyTasks) {
    // Drop all tables and let initDb recreate with clean schema
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name != 'sqlite_sequence'"
    ).all() as { name: string }[];
    db.pragma("foreign_keys = OFF");
    for (const { name } of tables) {
      db.exec(`DROP TABLE IF EXISTS "${name}"`);
    }
    db.pragma("foreign_keys = ON");
  }
}

/**
 * Add a column to a table if it doesn't already exist.
 * SQLite lacks ALTER TABLE ... ADD COLUMN IF NOT EXISTS, so we check PRAGMA table_info.
 */
function addColumnIfMissing(db: Database.Database, table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[];
  if (!columns.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE "${table}" ADD COLUMN ${column} ${definition}`);
  }
}

function ensureAppFilesUploadingStatus(db: Database.Database): void {
  const row = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'app_files'"
  ).get() as { sql: string } | undefined;
  if (!row || row.sql.includes("'uploading'")) return;

  db.pragma("foreign_keys = OFF");
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS app_files_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        app_id INTEGER NOT NULL,
        uploaded_by_user_id INTEGER DEFAULT NULL,
        original_name TEXT NOT NULL,
        stored_name TEXT NOT NULL,
        content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
        size_bytes INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        storage_path TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('uploading', 'available', 'deleted')),
        metadata_json TEXT DEFAULT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        deleted_at TEXT DEFAULT NULL,
        FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE,
        FOREIGN KEY (uploaded_by_user_id) REFERENCES users(id)
      );
      INSERT INTO app_files_new (
        id, app_id, uploaded_by_user_id, original_name, stored_name,
        content_type, size_bytes, sha256, storage_path, status,
        metadata_json, created_at, deleted_at
      )
      SELECT
        id, app_id, uploaded_by_user_id, original_name, stored_name,
        content_type, size_bytes, sha256, storage_path,
        CASE WHEN status IN ('available', 'deleted') THEN status ELSE 'available' END,
        metadata_json, created_at, deleted_at
      FROM app_files;
      DROP TABLE app_files;
      ALTER TABLE app_files_new RENAME TO app_files;
    `);
  } finally {
    db.pragma("foreign_keys = ON");
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_app_files_app_id ON app_files(app_id);
    CREATE INDEX IF NOT EXISTS idx_app_files_status ON app_files(status);
    CREATE INDEX IF NOT EXISTS idx_app_files_sha256 ON app_files(app_id, sha256);
  `);
}

/**
 * Ensure the synthetic Archie Automation user exists for automation-created work.
 */
function ensureAutomationUser(db: Database.Database): void {
  const existing = db.prepare(
    "SELECT id FROM users WHERE username = '__archie_automation__'"
  ).get();
  if (!existing) {
    db.prepare(
      `INSERT INTO users (username, name, role, color, password_hash)
       VALUES ('__archie_automation__', 'Archie Automation', 'member', '#6366F1', '')`
    ).run();
  }
}

function backfillUserColors(db: Database.Database): void {
  const AVATAR_COLORS = [
    "#E53E3E", "#DD6B20", "#D69E2E", "#38A169", "#319795",
    "#3182CE", "#5A67D8", "#805AD5", "#D53F8C", "#E53E3E",
  ];
  const usersWithoutColor = db.prepare(
    "SELECT id FROM users WHERE color IS NULL"
  ).all() as { id: number }[];
  for (const u of usersWithoutColor) {
    const color = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
    db.prepare("UPDATE users SET color = ? WHERE id = ?").run(color, u.id);
  }
}
