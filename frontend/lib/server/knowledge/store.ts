/**
 * Knowledge store — reads/writes app-level knowledge artifacts.
 * All knowledge uses kind = "app_knowledge" differentiated by topic in metadata_json.
 */

import { execSync } from "child_process";
import * as dal from "../dal";
import type { KnowledgeSection, KnowledgeMeta } from "./types";

export function getKnowledge(appId: number, topic: string): string | null {
  const artifact = dal.getAppArtifactByTopic(appId, topic);
  return artifact?.inline_text ?? null;
}

export interface KnowledgeEntry {
  topic: string;
  label: string;
  content: string;
}

export function getAllKnowledge(appId: number): KnowledgeEntry[] {
  const artifacts = dal.getAppArtifacts(appId, "app_knowledge");
  return artifacts
    .map((a) => {
      let meta: KnowledgeMeta | null = null;
      try { meta = a.metadata_json ? JSON.parse(a.metadata_json) : null; } catch {}
      if (!meta?.topic) return null;
      return {
        topic: meta.topic,
        label: meta.topic.charAt(0).toUpperCase() + meta.topic.slice(1),
        content: a.inline_text || "",
      };
    })
    .filter((e): e is KnowledgeEntry => e !== null);
}

export function setKnowledge(appId: number, section: KnowledgeSection, directory?: string): void {
  // Delete old artifact for this topic
  dal.deleteAppArtifactsByTopic(appId, section.topic);

  // Get current git sha
  let gitSha: string | null = null;
  if (directory) {
    try {
      gitSha = execSync("git rev-parse HEAD", { cwd: directory, encoding: "utf-8", timeout: 3000 }).trim();
    } catch {}
  }

  const meta: KnowledgeMeta = {
    topic: section.topic,
    generated_at: new Date().toISOString(),
    git_sha: gitSha,
  };

  dal.createArtifact({
    app_id: appId,
    kind: "app_knowledge",
    name: section.label,
    storage_type: "inline",
    inline_text: section.content,
    metadata_json: JSON.stringify(meta),
  });
}

export function isKnowledgeStale(appId: number, maxAgeSeconds = 3600): boolean {
  const artifacts = dal.getAppArtifacts(appId, "app_knowledge");
  if (artifacts.length === 0) return true;

  const now = Date.now();
  for (const a of artifacts) {
    let meta: KnowledgeMeta | null = null;
    try { meta = a.metadata_json ? JSON.parse(a.metadata_json) : null; } catch {}
    if (!meta?.generated_at) return true;
    const age = (now - new Date(meta.generated_at).getTime()) / 1000;
    if (age > maxAgeSeconds) return true;
  }
  return false;
}
