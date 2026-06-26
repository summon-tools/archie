"use client";

import { useState, useEffect, useCallback } from "react";
import { SpinnerGap, Lightning } from "@phosphor-icons/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { fetchSkills, fetchSkill, type SkillEntry, type SkillDetail } from "@/lib/api";

import { PROSE_CLASSES } from "@/lib/prose";

function parseContent(content: string): { name: string; description: string; body: string } {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!fmMatch) return { name: "", description: "", body: content };

  let name = "";
  let description = "";
  const fmLines = fmMatch[1].split("\n");
  let i = 0;
  while (i < fmLines.length) {
    const kv = fmLines[i].match(/^(\w[\w_]*)\s*:\s*(.*)$/);
    if (kv) {
      const key = kv[1];
      const value = kv[2].trim();
      if (value === "|" || value === ">") {
        const blockLines: string[] = [];
        i++;
        while (i < fmLines.length && /^\s{2}/.test(fmLines[i])) {
          blockLines.push(fmLines[i].replace(/^\s{2}/, ""));
          i++;
        }
        if (key === "name") name = blockLines.join("\n");
        else if (key === "description") description = blockLines.join("\n");
        continue;
      }
      if (key === "name") name = value;
      else if (key === "description") description = value;
    }
    i++;
  }
  return { name, description, body: fmMatch[2] };
}

interface SkillsPanelProps {
  appId: number;
  onStartConversation?: (message: string) => void;
}

export default function SkillsPanel({ appId, onStartConversation }: SkillsPanelProps) {
  const [entries, setEntries] = useState<SkillEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFilename, setSelectedFilename] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<SkillDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editBody, setEditBody] = useState("");

  const loadSkills = useCallback(async () => {
    try {
      const data = await fetchSkills(appId);
      setEntries(data.entries);
    } catch {
    } finally {
      setLoading(false);
    }
  }, [appId]);

  useEffect(() => {
    loadSkills();
  }, [loadSkills]);

  const handleSelectSkill = async (filename: string) => {
    setSelectedFilename(filename);
    setDetailLoading(true);
    try {
      const detail = await fetchSkill(appId, filename);
      setSelectedDetail(detail);
      const parsed = parseContent(detail.content);
      setEditName(parsed.name);
      setEditDescription(parsed.description);
      setEditBody(parsed.body);
    } catch {
      setSelectedDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex items-center gap-3 text-th-muted">
          <SpinnerGap size={20} className="animate-spin" />
          <span className="text-sm">Loading skills...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex min-h-0">
      {/* Left: skill list */}
      <div className="w-64 flex-shrink-0 border-r border-th flex flex-col">
        <div className="h-10 px-4 border-b border-th flex items-center">
          <div className="flex items-center gap-2">
            <Lightning size={18} weight="bold" className="text-th-muted" />
            <span className="text-sm font-semibold text-th-primary">Team Skills</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {entries.length === 0 ? (
            <div className="p-6 text-center">
              <Lightning size={32} className="mx-auto mb-3 text-th-muted opacity-40" />
              <p className="text-sm text-th-muted mb-1">No skills defined yet</p>
              <p className="text-xs text-th-dimmed">
                Start a conversation to create team skills that guide the agent.
              </p>
            </div>
          ) : (
            <div className="py-1">
              {entries.map((entry) => (
                <button
                  key={entry.filename}
                  onClick={() => handleSelectSkill(entry.filename)}
                  className={`w-full text-left px-4 py-2.5 transition-colors ${
                    selectedFilename === entry.filename
                      ? "bg-th-muted border-l-2 border-l-th-strong"
                      : "border-l-2 border-l-transparent hover:bg-th-subtle"
                  }`}
                >
                  <p className="text-sm font-medium text-th-primary truncate">{entry.name}</p>
                  <p className="text-xs text-th-dimmed truncate mt-0.5">{entry.description}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right: read-only viewer */}
      <div className="flex-1 flex flex-col min-h-0">
        {selectedFilename ? (
          <>
            {/* Header */}
            <div className="px-4 py-2 border-b border-th bg-th-sidebar">
              <p className="text-sm font-semibold text-th-primary truncate">{editName || "Untitled"}</p>
              <p className="text-xs text-th-muted truncate">{editDescription}</p>
            </div>

            {/* Content */}
            {detailLoading ? (
              <div className="flex-1 flex items-center justify-center">
                <SpinnerGap size={16} className="animate-spin text-th-muted" />
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto p-6">
                <div className={PROSE_CLASSES}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{editBody}</ReactMarkdown>
                </div>
              </div>
            )}
          </>
        ) : (
          /* Welcome / guide page */
          <div className="flex-1 flex items-center justify-center overflow-y-auto">
            <div className="max-w-lg px-8 py-10 text-center">
              <div className="w-14 h-14 mx-auto mb-5 rounded-xl bg-overlay-medium flex items-center justify-center">
                <Lightning size={28} className="text-th-dimmed" />
              </div>
              <p className="text-base text-th-primary mb-1.5 font-semibold">Team Skills</p>
              <p className="text-sm text-th-secondary mb-8 leading-relaxed">
                Skills capture your team's conventions, gotchas, and best practices. The agent follows them when working on tasks. To add or update skills, start a conversation.
              </p>

              <div className="text-left border border-th rounded-lg p-4 bg-overlay-light space-y-4">
                <div>
                  <p className="text-xs font-semibold text-th-secondary uppercase tracking-wider mb-2.5">Examples</p>
                  <ul className="space-y-2 text-sm text-th-secondary leading-relaxed">
                    <li><span className="text-th-primary font-medium">Auth gotchas</span> — how authentication works, common pitfalls, session handling.</li>
                    <li><span className="text-th-primary font-medium">Testing expectations</span> — what to test, coverage targets, test file conventions.</li>
                    <li><span className="text-th-primary font-medium">Architecture conventions</span> — folder structure, naming, patterns to follow.</li>
                    <li><span className="text-th-primary font-medium">Review checklists</span> — what to check before shipping code.</li>
                  </ul>
                </div>
                <div className="border-t border-th pt-3">
                  <p className="text-xs font-semibold text-th-secondary uppercase tracking-wider mb-2.5">Conversation shortcut</p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => onStartConversation?.("Update the team skills: ")}
                      className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded bg-overlay-medium text-th-secondary font-mono hover:bg-overlay-heavy hover:text-th-primary transition-colors cursor-pointer"
                    >
                      /update-skills
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
