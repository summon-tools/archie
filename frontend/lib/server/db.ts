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

    CREATE TABLE IF NOT EXISTS app_dependencies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      app_id INTEGER NOT NULL,
      dependency_app_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      purpose TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE,
      FOREIGN KEY (dependency_app_id) REFERENCES apps(id) ON DELETE CASCADE,
      CHECK (app_id != dependency_app_id),
      UNIQUE (app_id, dependency_app_id)
    );
    CREATE INDEX IF NOT EXISTS idx_app_dependencies_app_id ON app_dependencies(app_id);
    CREATE INDEX IF NOT EXISTS idx_app_dependencies_dependency_app_id ON app_dependencies(dependency_app_id);

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

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      app_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo', 'in_progress', 'done')),
      priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low', 'medium', 'high', 'urgent')),
      position INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER DEFAULT NULL,
      assigned_to INTEGER DEFAULT NULL,
      origin_type TEXT NOT NULL DEFAULT 'user',
      completed_at TEXT DEFAULT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES users(id),
      FOREIGN KEY (assigned_to) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_app_id ON tasks(app_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(app_id, status);

    CREATE TABLE IF NOT EXISTS task_work_items (
      task_id INTEGER NOT NULL,
      work_item_id INTEGER NOT NULL,
      relation_type TEXT NOT NULL DEFAULT 'implementation',
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (task_id, work_item_id),
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_task_work_items_work_item_id ON task_work_items(work_item_id);

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

    CREATE TABLE IF NOT EXISTS github_installations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      installation_id INTEGER NOT NULL UNIQUE,
      account_login TEXT NOT NULL,
      account_type TEXT DEFAULT NULL,
      repository_selection TEXT DEFAULT NULL,
      state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active', 'suspended', 'deleted')),
      raw_json TEXT DEFAULT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_github_installations_state ON github_installations(state);

    CREATE TABLE IF NOT EXISTS project_repositories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      app_id INTEGER NOT NULL,
      installation_id INTEGER NOT NULL,
      owner TEXT NOT NULL,
      repo TEXT NOT NULL,
      default_branch TEXT NOT NULL DEFAULT 'main',
      state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active', 'paused')),
      raw_json TEXT DEFAULT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(owner, repo),
      FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE,
      FOREIGN KEY (installation_id) REFERENCES github_installations(installation_id)
    );
    CREATE INDEX IF NOT EXISTS idx_project_repositories_app_id ON project_repositories(app_id);
    CREATE INDEX IF NOT EXISTS idx_project_repositories_installation_id ON project_repositories(installation_id);

    CREATE TABLE IF NOT EXISTS pull_request_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      app_id INTEGER NOT NULL,
      installation_id INTEGER NOT NULL,
      owner TEXT NOT NULL,
      repo TEXT NOT NULL,
      pr_number INTEGER NOT NULL,
      action TEXT NOT NULL,
      base_sha TEXT DEFAULT NULL,
      head_sha TEXT DEFAULT NULL,
      comparison_sha TEXT DEFAULT NULL,
      requested_reviewer_login TEXT DEFAULT NULL,
      status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued', 'running', 'completed', 'failed', 'not_supported')),
      execution_mode TEXT NOT NULL DEFAULT 'isolated_worktree' CHECK(execution_mode IN ('isolated_worktree', 'api_only')),
      workspace_path TEXT DEFAULT NULL,
      execution_json TEXT NOT NULL DEFAULT '{}',
      context_sources_json TEXT NOT NULL DEFAULT '[]',
      policy_revision TEXT DEFAULT NULL,
      model_usage_json TEXT DEFAULT NULL,
      trigger_delivery_id TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_pull_request_reviews_repo_pr ON pull_request_reviews(owner, repo, pr_number);
    CREATE INDEX IF NOT EXISTS idx_pull_request_reviews_status ON pull_request_reviews(status);

    CREATE TABLE IF NOT EXISTS github_webhook_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      delivery_id TEXT NOT NULL UNIQUE,
      event_name TEXT NOT NULL,
      action TEXT DEFAULT NULL,
      installation_id INTEGER DEFAULT NULL,
      owner TEXT DEFAULT NULL,
      repo TEXT DEFAULT NULL,
      status TEXT NOT NULL DEFAULT 'received' CHECK(status IN ('received', 'ignored', 'queued', 'failed')),
      review_id INTEGER DEFAULT NULL,
      error_text TEXT DEFAULT NULL,
      payload_json TEXT NOT NULL,
      received_at TEXT NOT NULL DEFAULT (datetime('now')),
      processed_at TEXT DEFAULT NULL,
      FOREIGN KEY (review_id) REFERENCES pull_request_reviews(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_github_webhook_events_status ON github_webhook_events(status);
    CREATE INDEX IF NOT EXISTS idx_github_webhook_events_received_at ON github_webhook_events(received_at);

    CREATE TABLE IF NOT EXISTS review_policies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      app_id INTEGER NOT NULL,
      owner TEXT DEFAULT NULL,
      repo TEXT DEFAULT NULL,
      revision TEXT NOT NULL,
      policy_json TEXT NOT NULL DEFAULT '{}',
      state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active', 'archived')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE,
      UNIQUE(app_id, owner, repo, revision)
    );
    CREATE INDEX IF NOT EXISTS idx_review_policies_lookup ON review_policies(app_id, owner, repo, state);

    CREATE TABLE IF NOT EXISTS project_dependencies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      consumer_app_id INTEGER NOT NULL,
      provider_app_id INTEGER NOT NULL,
      relationship_type TEXT NOT NULL DEFAULT 'consumes_api',
      authoritative_ref TEXT NOT NULL DEFAULT 'main',
      contract_type TEXT NOT NULL DEFAULT 'openapi',
      source_path TEXT NOT NULL,
      version_expectation TEXT DEFAULT NULL,
      state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active', 'paused')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (consumer_app_id) REFERENCES apps(id) ON DELETE CASCADE,
      FOREIGN KEY (provider_app_id) REFERENCES apps(id) ON DELETE CASCADE,
      CHECK(consumer_app_id != provider_app_id),
      UNIQUE(consumer_app_id, provider_app_id, source_path)
    );
    CREATE INDEX IF NOT EXISTS idx_project_dependencies_consumer ON project_dependencies(consumer_app_id, state);

    CREATE TABLE IF NOT EXISTS contract_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dependency_id INTEGER NOT NULL,
      source_revision TEXT NOT NULL,
      source_path TEXT NOT NULL,
      normalized_json TEXT DEFAULT NULL,
      status TEXT NOT NULL DEFAULT 'ready' CHECK(status IN ('ready', 'fetching', 'failed')),
      error_text TEXT DEFAULT NULL,
      fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (dependency_id) REFERENCES project_dependencies(id) ON DELETE CASCADE,
      UNIQUE(dependency_id, source_revision)
    );
    CREATE INDEX IF NOT EXISTS idx_contract_snapshots_dependency ON contract_snapshots(dependency_id, fetched_at DESC);

    CREATE TABLE IF NOT EXISTS review_findings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      review_id INTEGER NOT NULL,
      fingerprint TEXT NOT NULL,
      path TEXT NOT NULL,
      line INTEGER NOT NULL,
      end_line INTEGER DEFAULT NULL,
      side TEXT NOT NULL DEFAULT 'RIGHT' CHECK(side IN ('LEFT', 'RIGHT')),
      start_side TEXT DEFAULT NULL CHECK(start_side IS NULL OR start_side IN ('LEFT', 'RIGHT')),
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'advisory' CHECK(severity IN ('blocking', 'high', 'medium', 'low', 'advisory')),
      evidence_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed', 'published', 'accepted', 'fixed', 'dismissed', 'obsolete', 'unresolved')),
      github_comment_id INTEGER DEFAULT NULL,
      github_comment_url TEXT DEFAULT NULL,
      resolution_json TEXT DEFAULT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (review_id) REFERENCES pull_request_reviews(id) ON DELETE CASCADE,
      UNIQUE(review_id, fingerprint)
    );
    CREATE INDEX IF NOT EXISTS idx_review_findings_review ON review_findings(review_id, status);

    CREATE TABLE IF NOT EXISTS review_thread_interactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      review_id INTEGER NOT NULL,
      github_comment_id INTEGER NOT NULL UNIQUE,
      author_login TEXT DEFAULT NULL,
      mention_text TEXT NOT NULL,
      response_body TEXT DEFAULT NULL,
      disposition TEXT DEFAULT NULL,
      status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued', 'completed', 'failed', 'ignored')),
      raw_json TEXT DEFAULT NULL,
      model_usage_json TEXT DEFAULT NULL,
      processing_started_at TEXT DEFAULT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (review_id) REFERENCES pull_request_reviews(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_review_thread_interactions_review ON review_thread_interactions(review_id, status);

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
      assessment_id INTEGER DEFAULT NULL,
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

    CREATE TABLE IF NOT EXISTS llm_outcome_assessments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      app_id INTEGER NOT NULL,
      work_item_id INTEGER NOT NULL,
      snapshot_id INTEGER NOT NULL,
      pr_snapshot_id INTEGER DEFAULT NULL,
      provider_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      input_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('completed', 'failed')),
      assessment_json TEXT DEFAULT NULL,
      confidence TEXT NOT NULL DEFAULT 'unknown' CHECK(confidence IN ('unknown', 'low', 'medium', 'high')),
      error_text TEXT DEFAULT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE,
      FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE CASCADE,
      FOREIGN KEY (snapshot_id) REFERENCES llm_outcome_snapshots(id) ON DELETE CASCADE,
      FOREIGN KEY (pr_snapshot_id) REFERENCES github_pr_snapshots(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_llm_outcome_assessments_work_item_id ON llm_outcome_assessments(work_item_id);
    CREATE INDEX IF NOT EXISTS idx_llm_outcome_assessments_created_at ON llm_outcome_assessments(created_at);
    CREATE INDEX IF NOT EXISTS idx_llm_outcome_assessments_input_hash ON llm_outcome_assessments(input_hash);

    CREATE TABLE IF NOT EXISTS github_repo_pull_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner TEXT NOT NULL,
      repo TEXT NOT NULL,
      pr_number INTEGER NOT NULL,
      pr_url TEXT NOT NULL,
      title TEXT DEFAULT '',
      body TEXT DEFAULT '',
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
      raw_json TEXT DEFAULT NULL,
      synced_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(owner, repo, pr_number)
    );
    CREATE INDEX IF NOT EXISTS idx_github_repo_pr_repo ON github_repo_pull_requests(owner, repo);
    CREATE INDEX IF NOT EXISTS idx_github_repo_pr_updated_at ON github_repo_pull_requests(github_updated_at);

    CREATE TABLE IF NOT EXISTS github_repo_pull_request_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_pr_id INTEGER NOT NULL,
      owner TEXT NOT NULL,
      repo TEXT NOT NULL,
      pr_number INTEGER NOT NULL,
      filename TEXT NOT NULL,
      status TEXT DEFAULT NULL,
      additions INTEGER DEFAULT NULL,
      deletions INTEGER DEFAULT NULL,
      changes INTEGER DEFAULT NULL,
      raw_json TEXT DEFAULT NULL,
      synced_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(repo_pr_id, filename),
      FOREIGN KEY (repo_pr_id) REFERENCES github_repo_pull_requests(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_github_repo_pr_files_repo_pr_id ON github_repo_pull_request_files(repo_pr_id);
    CREATE INDEX IF NOT EXISTS idx_github_repo_pr_files_path ON github_repo_pull_request_files(filename);

    CREATE TABLE IF NOT EXISTS llm_outcome_followups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      app_id INTEGER NOT NULL,
      source_work_item_id INTEGER NOT NULL,
      source_snapshot_id INTEGER NOT NULL,
      source_pr_snapshot_id INTEGER NOT NULL,
      followup_repo_pr_id INTEGER NOT NULL,
      owner TEXT NOT NULL,
      repo TEXT NOT NULL,
      source_pr_number INTEGER NOT NULL,
      followup_pr_number INTEGER NOT NULL,
      relation_type TEXT NOT NULL DEFAULT 'unknown' CHECK(relation_type IN ('no_relation', 'expected_iteration', 'routine_followup', 'agent_correction', 'regression_fix', 'revert', 'unknown')),
      confidence TEXT NOT NULL DEFAULT 'unknown' CHECK(confidence IN ('unknown', 'low', 'medium', 'high')),
      deterministic_score INTEGER NOT NULL DEFAULT 0,
      deterministic_signals_json TEXT DEFAULT NULL,
      assessment_json TEXT DEFAULT NULL,
      evidence_json TEXT DEFAULT NULL,
      detected_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(source_snapshot_id, followup_repo_pr_id),
      FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE,
      FOREIGN KEY (source_work_item_id) REFERENCES work_items(id) ON DELETE CASCADE,
      FOREIGN KEY (source_snapshot_id) REFERENCES llm_outcome_snapshots(id) ON DELETE CASCADE,
      FOREIGN KEY (source_pr_snapshot_id) REFERENCES github_pr_snapshots(id) ON DELETE CASCADE,
      FOREIGN KEY (followup_repo_pr_id) REFERENCES github_repo_pull_requests(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_llm_outcome_followups_source_work_item_id ON llm_outcome_followups(source_work_item_id);
    CREATE INDEX IF NOT EXISTS idx_llm_outcome_followups_relation_type ON llm_outcome_followups(relation_type);
    CREATE INDEX IF NOT EXISTS idx_llm_outcome_followups_detected_at ON llm_outcome_followups(detected_at);

    CREATE TABLE IF NOT EXISTS llm_outcome_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL CHECK(kind IN ('outcome_refresh', 'github_sync', 'snapshot_recompute', 'evidence_assessment', 'followup_detection')),
      requested_by_user_id INTEGER DEFAULT NULL,
      status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued', 'running', 'completed', 'failed')),
      input_json TEXT DEFAULT NULL,
      result_json TEXT DEFAULT NULL,
      progress_text TEXT DEFAULT NULL,
      error_text TEXT DEFAULT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      started_at TEXT DEFAULT NULL,
      completed_at TEXT DEFAULT NULL,
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (requested_by_user_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_llm_outcome_jobs_kind ON llm_outcome_jobs(kind);
    CREATE INDEX IF NOT EXISTS idx_llm_outcome_jobs_status ON llm_outcome_jobs(status);
    CREATE INDEX IF NOT EXISTS idx_llm_outcome_jobs_created_at ON llm_outcome_jobs(created_at);

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
      conversation_id INTEGER DEFAULT NULL,
      message_id INTEGER DEFAULT NULL,
      work_item_id INTEGER DEFAULT NULL,
      link_type TEXT NOT NULL DEFAULT 'attachment' CHECK(link_type IN ('attachment', 'context')),
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE,
      FOREIGN KEY (app_file_id) REFERENCES app_files(id) ON DELETE CASCADE,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
      FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_app_file_links_file_id ON app_file_links(app_file_id);
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

    CREATE TABLE IF NOT EXISTS global_skills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      body_md TEXT NOT NULL DEFAULT '',
      parts_json TEXT NOT NULL DEFAULT '[]',
      trigger_phrases_json TEXT NOT NULL DEFAULT '[]',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_by INTEGER DEFAULT NULL,
      updated_by INTEGER DEFAULT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (created_by) REFERENCES users(id),
      FOREIGN KEY (updated_by) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_global_skills_enabled ON global_skills(enabled);

    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS mcp_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      token_prefix TEXT NOT NULL,
      created_by_user_id INTEGER DEFAULT NULL,
      scopes_json TEXT NOT NULL DEFAULT '[]',
      allowed_app_ids_json TEXT NOT NULL DEFAULT '[]',
      last_used_at TEXT DEFAULT NULL,
      expires_at TEXT DEFAULT NULL,
      revoked_at TEXT DEFAULT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (created_by_user_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_mcp_tokens_hash ON mcp_tokens(token_hash);
    CREATE INDEX IF NOT EXISTS idx_mcp_tokens_revoked ON mcp_tokens(revoked_at);

    CREATE TABLE IF NOT EXISTS mcp_audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_id INTEGER DEFAULT NULL,
      app_id INTEGER DEFAULT NULL,
      tool_name TEXT NOT NULL,
      input_summary_json TEXT DEFAULT NULL,
      result_summary_json TEXT DEFAULT NULL,
      status TEXT NOT NULL CHECK(status IN ('success', 'error')),
      error_text TEXT DEFAULT NULL,
      duration_ms INTEGER DEFAULT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (token_id) REFERENCES mcp_tokens(id),
      FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_mcp_audit_events_token ON mcp_audit_events(token_id);
    CREATE INDEX IF NOT EXISTS idx_mcp_audit_events_app ON mcp_audit_events(app_id);
    CREATE INDEX IF NOT EXISTS idx_mcp_audit_events_tool ON mcp_audit_events(tool_name);

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
  addColumnIfMissing(db, "llm_outcome_snapshots", "assessment_id", "INTEGER DEFAULT NULL");
  addColumnIfMissing(db, "llm_outcome_snapshots", "pr_author_classification", "TEXT NOT NULL DEFAULT 'unknown'");
  addColumnIfMissing(db, "llm_outcome_snapshots", "pr_author_confidence", "TEXT NOT NULL DEFAULT 'unknown'");
  addColumnIfMissing(db, "llm_outcome_snapshots", "attribution_confidence", "TEXT NOT NULL DEFAULT 'unknown'");

  addColumnIfMissing(db, "conversations", "origin_type", "TEXT NOT NULL DEFAULT 'user'");
  addColumnIfMissing(db, "conversations", "origin_automation_key", "TEXT DEFAULT NULL");
  addColumnIfMissing(db, "conversations", "origin_run_id", "INTEGER DEFAULT NULL");

  addColumnIfMissing(db, "global_skills", "parts_json", "TEXT NOT NULL DEFAULT '[]'");

  addColumnIfMissing(db, "pull_request_reviews", "execution_mode", "TEXT NOT NULL DEFAULT 'isolated_worktree'");
  addColumnIfMissing(db, "pull_request_reviews", "workspace_path", "TEXT DEFAULT NULL");
  addColumnIfMissing(db, "pull_request_reviews", "execution_json", "TEXT NOT NULL DEFAULT '{}'" );

  addColumnIfMissing(db, "pull_request_reviews", "pr_url", "TEXT DEFAULT NULL");
  addColumnIfMissing(db, "pull_request_reviews", "pr_title", "TEXT DEFAULT NULL");
  addColumnIfMissing(db, "pull_request_reviews", "pr_body", "TEXT DEFAULT NULL");
  addColumnIfMissing(db, "pull_request_reviews", "context_packet_json", "TEXT NOT NULL DEFAULT '{}'");
  addColumnIfMissing(db, "pull_request_reviews", "publication_json", "TEXT NOT NULL DEFAULT '{}'");
  addColumnIfMissing(db, "pull_request_reviews", "github_review_id", "INTEGER DEFAULT NULL");
  addColumnIfMissing(db, "pull_request_reviews", "provider_id", "TEXT DEFAULT NULL");
  addColumnIfMissing(db, "pull_request_reviews", "model_id", "TEXT DEFAULT NULL");
  addColumnIfMissing(db, "pull_request_reviews", "review_mode", "TEXT NOT NULL DEFAULT 'targeted'");
  addColumnIfMissing(db, "pull_request_reviews", "previous_review_id", "INTEGER DEFAULT NULL");
  addColumnIfMissing(db, "pull_request_reviews", "completed_at", "TEXT DEFAULT NULL");
  addColumnIfMissing(db, "pull_request_reviews", "error_text", "TEXT DEFAULT NULL");
  addColumnIfMissing(db, "github_webhook_events", "head_sha", "TEXT DEFAULT NULL");
  addColumnIfMissing(db, "review_thread_interactions", "processing_started_at", "TEXT DEFAULT NULL");
  addColumnIfMissing(db, "review_thread_interactions", "model_usage_json", "TEXT DEFAULT NULL");

  // A project can have historical mappings, but only one may remain active.
  db.exec(`
    UPDATE project_repositories
    SET state = 'paused', updated_at = datetime('now')
    WHERE state = 'active' AND id NOT IN (
      SELECT MAX(id) FROM project_repositories WHERE state = 'active' GROUP BY app_id
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_project_repositories_one_active_app
      ON project_repositories(app_id) WHERE state = 'active';
  `);

  // ── Migrate app file status constraints ───────────────────────
  ensureAppFilesUploadingStatus(db);

  // ── Migrate outcome job kind constraints ──────────────────────
  ensureOutcomeRefreshJobKind(db);

  // ── Clean stale agent sessions ────────────────────────────────
  db.exec("UPDATE agent_sessions SET status = 'idle' WHERE status = 'running'");

  // ── Backfill user colors ──────────────────────────────────────
  backfillUserColors(db);

  // ── Ensure automation system user exists (RFC 23) ─────────────
  ensureAutomationUser(db);

  // ── Migrate planning task statuses ────────────────────────────
  ensureTaskStatusSchema(db);

  // ── Backfill planning tasks for existing task conversations ────
  backfillTasksFromWorkItems(db);
}

function ensureTaskStatusSchema(db: Database.Database): void {
  const row = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'tasks'"
  ).get() as { sql: string } | undefined;
  if (!row || row.sql.includes("'todo'")) return;

  db.pragma("foreign_keys = OFF");
  try {
    db.exec("BEGIN");
    db.exec(`
      CREATE TABLE tasks_migrated (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        app_id INTEGER NOT NULL,
        parent_task_id INTEGER DEFAULT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo', 'in_progress', 'done')),
        priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low', 'medium', 'high', 'urgent')),
        position INTEGER NOT NULL DEFAULT 0,
        created_by INTEGER DEFAULT NULL,
        assigned_to INTEGER DEFAULT NULL,
        origin_type TEXT NOT NULL DEFAULT 'user',
        blocked_reason TEXT DEFAULT NULL,
        completed_at TEXT DEFAULT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE,
        FOREIGN KEY (parent_task_id) REFERENCES tasks_migrated(id) ON DELETE CASCADE,
        FOREIGN KEY (created_by) REFERENCES users(id),
        FOREIGN KEY (assigned_to) REFERENCES users(id)
      );
      INSERT INTO tasks_migrated (
        id, app_id, parent_task_id, title, description, status, priority, position,
        created_by, assigned_to, origin_type, blocked_reason, completed_at, created_at, updated_at
      )
      SELECT
        id, app_id, parent_task_id, title, description,
        CASE status
          WHEN 'backlog' THEN 'todo'
          WHEN 'ready' THEN 'todo'
          WHEN 'review' THEN 'in_progress'
          WHEN 'blocked' THEN 'todo'
          ELSE status
        END,
        priority, position, created_by, assigned_to, origin_type, blocked_reason,
        completed_at, created_at, updated_at
      FROM tasks;
      DROP TABLE tasks;
      ALTER TABLE tasks_migrated RENAME TO tasks;
      CREATE INDEX IF NOT EXISTS idx_tasks_app_id ON tasks(app_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(app_id, status);
    `);
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  } finally {
    db.pragma("foreign_keys = ON");
  }
}

/**
 * Detect legacy schema (old "threads" table or other legacy tables) and
 * reset the database. Early users are okay with a full data reset.
 */
function resetIfLegacySchema(db: Database.Database): void {
  const hasLegacyThreads = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='threads'"
  ).get();
  const taskTable = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='tasks'"
  ).get();
  const taskColumns = taskTable
    ? db.prepare("PRAGMA table_info(\"tasks\")").all() as { name: string }[]
    : [];
  // Before the current planning-task schema, `tasks` belonged to the legacy
  // conversation model. Preserve that reset behavior without treating the
  // current task table as legacy on every application boot.
  const hasCurrentTasks = Boolean(taskTable)
    && taskColumns.some((column) => column.name === "app_id")
    && taskColumns.some((column) => column.name === "description")
    && taskColumns.some((column) => column.name === "status");
  const hasLegacyTasks = Boolean(taskTable) && !hasCurrentTasks;

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

function backfillTasksFromWorkItems(db: Database.Database): void {
  const legacyItems = db.prepare(
    `SELECT wi.*
     FROM work_items wi
     LEFT JOIN task_work_items twi ON twi.work_item_id = wi.id
     WHERE wi.kind = 'task' AND twi.work_item_id IS NULL
     ORDER BY wi.created_at ASC, wi.id ASC`
  ).all() as {
    id: number;
    app_id: number;
    title: string;
    summary: string;
    status: "proposed" | "in_progress" | "done";
    position: number;
    created_by: number | null;
    completed_at: string | null;
    created_at: string;
    updated_at: string;
  }[];
  if (legacyItems.length === 0) return;

  const transaction = db.transaction(() => {
    const maxPosition = db.prepare(
      "SELECT COALESCE(MAX(position), -1) AS max_pos FROM tasks WHERE app_id = ? AND status = ?"
    );
    const insertTask = db.prepare(
      `INSERT INTO tasks (
        app_id, title, description, status, priority, position, created_by,
        origin_type, completed_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'medium', ?, ?, 'legacy_work_item', ?, ?, ?)`
    );
    const insertLink = db.prepare(
      "INSERT OR IGNORE INTO task_work_items (task_id, work_item_id, relation_type) VALUES (?, ?, 'implementation')"
    );
    for (const item of legacyItems) {
      const status = item.status === "done" ? "done" : item.status === "in_progress" ? "in_progress" : "todo";
      const nextPosition = (maxPosition.get(item.app_id, status) as { max_pos: number }).max_pos + 1;
      const result = insertTask.run(
        item.app_id,
        item.title,
        item.summary || "",
        status,
        nextPosition,
        item.created_by,
        item.completed_at,
        item.created_at,
        item.updated_at,
      );
      insertLink.run(result.lastInsertRowid, item.id);
    }
  });
  transaction();
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

function ensureOutcomeRefreshJobKind(db: Database.Database): void {
  const row = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'llm_outcome_jobs'"
  ).get() as { sql: string } | undefined;
  if (!row || row.sql.includes("'outcome_refresh'")) return;

  db.pragma("foreign_keys = OFF");
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS llm_outcome_jobs_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL CHECK(kind IN ('outcome_refresh', 'github_sync', 'snapshot_recompute', 'evidence_assessment', 'followup_detection')),
        requested_by_user_id INTEGER DEFAULT NULL,
        status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued', 'running', 'completed', 'failed')),
        input_json TEXT DEFAULT NULL,
        result_json TEXT DEFAULT NULL,
        progress_text TEXT DEFAULT NULL,
        error_text TEXT DEFAULT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        started_at TEXT DEFAULT NULL,
        completed_at TEXT DEFAULT NULL,
        updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (requested_by_user_id) REFERENCES users(id)
      );
      INSERT INTO llm_outcome_jobs_new (
        id, kind, requested_by_user_id, status, input_json, result_json,
        progress_text, error_text, created_at, started_at, completed_at, updated_at
      )
      SELECT
        id, kind, requested_by_user_id, status, input_json, result_json,
        progress_text, error_text, created_at, started_at, completed_at, updated_at
      FROM llm_outcome_jobs
      WHERE kind IN ('github_sync', 'snapshot_recompute', 'evidence_assessment', 'followup_detection');
      DROP TABLE llm_outcome_jobs;
      ALTER TABLE llm_outcome_jobs_new RENAME TO llm_outcome_jobs;
    `);
  } finally {
    db.pragma("foreign_keys = ON");
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_llm_outcome_jobs_kind ON llm_outcome_jobs(kind);
    CREATE INDEX IF NOT EXISTS idx_llm_outcome_jobs_status ON llm_outcome_jobs(status);
    CREATE INDEX IF NOT EXISTS idx_llm_outcome_jobs_created_at ON llm_outcome_jobs(created_at);
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
