/**
 * Predefined context needs per tool/workflow.
 * Knowledge is dynamic — "all_knowledge" injects every topic the indexer produced.
 * Tools can also request specific topics if they only need a subset.
 */

import type { ContextNeeds } from "./context";

export const TASK_CONTEXT: ContextNeeds = {
  knowledge_topics: ["brief"],
  work_item_brief: true,
  recent_briefs: { limit: 3 },
};

export const SEED_CONTEXT: ContextNeeds = {
  all_knowledge: true,
  personas: true,
  schema_files: true,
  spec: { toolType: "seed" },
};

export const DEMO_CONTEXT: ContextNeeds = {
  all_knowledge: true,
  personas: true,
  route_index: true,
  spec: { toolType: "video" },
  git_diff: { base: "main" },
};

export const WALKTHROUGH_CONTEXT: ContextNeeds = {
  knowledge_topics: ["brief", "routes", "auth"],
  personas: true,
  spec: { toolType: "walkthrough" },
};

export const SPEC_GENERATE_CONTEXT: ContextNeeds = {
  all_knowledge: true,
};

export const CODE_WALKTHROUGH_CONTEXT: ContextNeeds = {
  work_item_brief: true,
  change_summary: true,
  git_diff: { base: "main" },
  all_knowledge: true,
};
