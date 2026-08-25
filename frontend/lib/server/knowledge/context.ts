/**
 * Context assembler — single function that all tools call
 * with a declarative needs object. Replaces ad-hoc context gathering.
 */

import { execSync } from "child_process";
import { getAllKnowledge, getKnowledge, isKnowledgeStale } from "./store";
import { getWorkItemBrief, getRecentBriefs } from "./brief";
import { refreshIfStale } from "./indexer";
import * as dal from "../dal";

export interface ContextNeeds {
  project_dependencies?: boolean;
  all_knowledge?: boolean;
  knowledge_topics?: string[];
  git_diff?: { base?: string; nameOnly?: boolean };
  work_item_brief?: boolean;
  recent_briefs?: { limit: number };
  conversation_messages?: { conversationId: number; limit: number };
  schema_files?: boolean;
  personas?: boolean;
  route_index?: boolean;
  auth_index?: boolean;
  change_summary?: boolean;
  live_snapshot?: string;
}

export interface ContextRequest {
  appId: number;
  directory: string;
  workItemId?: number;
  needs: ContextNeeds;
  budget?: number;
}

export interface ContextSection {
  label: string;
  content: string;
  chars: number;
}

export interface ContextResult {
  sections: ContextSection[];
  totalChars: number;
  formatted: string;
  staleKnowledge: string[];
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "\n... (truncated)";
}

/**
 * Assemble context for any tool/workflow.
 * Fills sections in priority order, each truncated if it would exceed remaining budget.
 */
export async function assembleContext(req: ContextRequest): Promise<ContextResult> {
  const budget = req.budget || 24000;
  const sections: ContextSection[] = [];
  const staleKnowledge: string[] = [];
  let totalChars = 0;

  const addSection = (label: string, content: string) => {
    if (!content || !content.trim()) return;
    const remaining = budget - totalChars;
    if (remaining <= 100) return;
    const truncated = truncate(content.trim(), remaining);
    const chars = truncated.length;
    sections.push({ label, content: truncated, chars });
    totalChars += chars;
  };

  // ── Project dependencies ───────────────────────────────────────
  if (req.needs.project_dependencies) {
    const dependencies = dal.listAppDependencies(req.appId);
    if (dependencies.length > 0) {
      const lines = [
        "The current task is implemented in the primary project. The projects below are declared dependencies. Their own repository configuration is the source of truth; use their local project directories to read relevant source, API contracts, shared types, and documentation. Keep implementation changes in the current project unless the user explicitly asks to modify a dependency.",
        ...dependencies.map((dependency) => [
          `- ${dependency.dependency_name} — Role: ${dependency.role}`,
          `  Relationship purpose: ${dependency.purpose}`,
          dependency.dependency_description ? `  Project description: ${dependency.dependency_description}` : "",
          dependency.dependency_directory ? `  Dependency project directory: ${dependency.dependency_directory}` : "  Dependency project directory: not configured",
          dependency.dependency_github_repo ? `  Dependency repository: ${dependency.dependency_github_repo}` : "",
        ].filter(Boolean).join("\n")),
      ];
      addSection("Project Dependencies", lines.join("\n"));
    }
  }

  // ── Knowledge topics (highest priority) ──────────────────────────
  if (req.needs.all_knowledge) {
    const allKnowledge = getAllKnowledge(req.appId);
    // Brief first, then alphabetically
    const sorted = allKnowledge.sort((a, b) => {
      if (a.topic === "brief") return -1;
      if (b.topic === "brief") return 1;
      return a.topic.localeCompare(b.topic);
    });
    for (const k of sorted) {
      addSection(`Codebase Index: ${k.label}`, k.content);
    }
    if (isKnowledgeStale(req.appId)) {
      staleKnowledge.push("all");
    }
  } else if (req.needs.knowledge_topics?.length) {
    for (const topic of req.needs.knowledge_topics) {
      const content = getKnowledge(req.appId, topic);
      if (content) {
        addSection(`Codebase Index: ${topic}`, content);
      }
    }
  }

  // ── Work item brief ──────────────────────────────────────────────
  if (req.needs.work_item_brief && req.workItemId) {
    const brief = getWorkItemBrief(req.workItemId);
    if (brief) {
      const lines = [
        `Goal: ${brief.goal}`,
        brief.decisions.length ? `Decisions:\n${brief.decisions.map((d) => `- ${d.what}: ${d.why}`).join("\n")}` : "",
        brief.files_changed.length ? `Files changed: ${brief.files_changed.join(", ")}` : "",
        brief.routes_affected.length ? `Routes affected: ${brief.routes_affected.join(", ")}` : "",
        brief.models_affected.length ? `Models affected: ${brief.models_affected.join(", ")}` : "",
        brief.follow_up_concerns.length ? `Follow-up: ${brief.follow_up_concerns.join(", ")}` : "",
      ].filter(Boolean);
      addSection("Previous Work on This Item", lines.join("\n"));
    }
  }

  // ── Git diff ─────────────────────────────────────────────────────
  if (req.needs.git_diff) {
    const base = req.needs.git_diff.base || "main";
    const flag = req.needs.git_diff.nameOnly ? "--name-only" : "--stat";
    try {
      const diff = execSync(`git diff ${base} ${flag} --no-color`, {
        cwd: req.directory, encoding: "utf-8", timeout: 5000,
      }).trim();
      if (diff) addSection("Git Diff", diff);
    } catch {}
  }

  // ── Recent briefs ────────────────────────────────────────────────
  if (req.needs.recent_briefs) {
    const briefs = getRecentBriefs(req.appId, req.needs.recent_briefs.limit);
    if (briefs.length > 0) {
      const formatted = briefs.map((b) => {
        return `- ${b.brief.goal}${b.brief.files_changed.length ? ` (files: ${b.brief.files_changed.slice(0, 5).join(", ")})` : ""}`;
      }).join("\n");
      addSection("Recent Task Summaries", formatted);
    }
  }

  // ── Conversation messages ───────────────────────────────────────
  if (req.needs.conversation_messages) {
    const messages = dal.getConversationMessages(req.needs.conversation_messages.conversationId, req.needs.conversation_messages.limit);
    if (messages.length > 0) {
      const formatted = messages
        .map((m) => `[${m.role}]: ${m.body_md.slice(0, 300)}`)
        .join("\n\n");
      addSection("Conversation Context", formatted);
    }
  }

  // ── Schema files (for seed) ──────────────────────────────────────
  if (req.needs.schema_files) {
    // Import dynamically to avoid circular dependency
    try {
      const { getSchemaFiles } = await import("../demo");
      const { detectTechStack } = await import("../techstack");
      const techStack = detectTechStack(req.directory);
      if (techStack) {
        const schemas = getSchemaFiles(req.directory, techStack);
        if (schemas) addSection("Schema Files", schemas);
      }
    } catch {}
  }

  // ── Personas ───────────────────────────────────────────────────
  if (req.needs.personas) {
    try {
      const { getLatestAppArtifact } = await import("../dal/artifacts");
      const artifact = getLatestAppArtifact(req.appId, "demo_personas");
      if (artifact?.inline_text) {
        try {
          const personas = JSON.parse(artifact.inline_text);
          if (Array.isArray(personas) && personas.length > 0) {
            const formatted = personas.map((p: any) =>
              `- ${p.name || p.username || "User"}: email=${p.email || "?"}, password=${p.password || "?"}`
            ).join("\n");
            addSection("Demo Personas", formatted);
          }
        } catch {
          addSection("Demo Personas", artifact.inline_text.slice(0, 2000));
        }
      }
    } catch {}
  }

  // ── Route index ────────────────────────────────────────────────
  if (req.needs.route_index && !req.needs.all_knowledge) {
    const routes = getKnowledge(req.appId, "routes");
    if (routes) addSection("Route Index", routes);
  }

  // ── Auth index ─────────────────────────────────────────────────
  if (req.needs.auth_index && !req.needs.all_knowledge) {
    const auth = getKnowledge(req.appId, "auth");
    if (auth) addSection("Auth Setup", auth);
  }

  // ── Change summary ─────────────────────────────────────────────
  if (req.needs.change_summary && req.workItemId) {
    const brief = getWorkItemBrief(req.workItemId);
    if (brief) {
      const lines = [
        `Goal: ${brief.goal}`,
        brief.files_changed.length ? `Files changed: ${brief.files_changed.join(", ")}` : "",
        brief.routes_affected.length ? `Routes affected: ${brief.routes_affected.join(", ")}` : "",
        brief.models_affected.length ? `Models affected: ${brief.models_affected.join(", ")}` : "",
      ].filter(Boolean);
      addSection("Change Summary", lines.join("\n"));
    }
  }

  // ── Live snapshot (passthrough) ────────────────────────────────
  if (req.needs.live_snapshot) {
    addSection("Live DOM Snapshot", req.needs.live_snapshot);
  }

  // ── Background refresh if stale ──────────────────────────────────
  if (staleKnowledge.length > 0) {
    refreshIfStale(req.appId, req.directory).catch(() => {});
  }

  // Format all sections into a single string
  const formatted = sections
    .map((s) => `═══ ${s.label.toUpperCase()} ═══\n${s.content}`)
    .join("\n\n");

  return { sections, totalChars, formatted, staleKnowledge };
}
