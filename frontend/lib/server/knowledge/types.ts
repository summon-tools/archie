/**
 * Knowledge layer types.
 * Knowledge is dynamic — the indexer decides what topics matter
 * based on what it finds in the codebase.
 */

/** A single knowledge section produced by the indexer */
export interface KnowledgeSection {
  topic: string;       // e.g. "brief", "routes", "models", "auth", "jobs", "components"
  label: string;       // human-readable, e.g. "Route Map", "Data Models"
  content: string;     // markdown or structured text
}

/** Metadata stored in artifact's metadata_json */
export interface KnowledgeMeta {
  topic: string;
  generated_at: string;
  git_sha: string | null;
}

export interface KnowledgeJob {
  status: "running" | "completed" | "failed";
  progress: string;
  error: string | null;
  started_at: number;
}
