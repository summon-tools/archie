"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { SpinnerGap, FileText, FolderSimple, FolderOpen, CaretRight, CaretDown, BookOpen, WarningCircle } from "@phosphor-icons/react";
import { getDriftResults } from "@/lib/api";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { PROSE_CLASSES } from "@/lib/prose";

interface SpecEntry {
  path: string;
  summary: string;
}

interface SpecEditorProps {
  appId: number;
  onTasksChanged?: () => void;
  onStartConversation?: (message: string) => void;
}

// ── Tree data structure ──────────────────────────────────────────────

interface TreeNode {
  name: string;
  path: string;
  isFolder: boolean;
  children: TreeNode[];
  summary?: string;
}

function buildTree(entries: SpecEntry[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", isFolder: true, children: [] };

  for (const entry of entries) {
    const parts = entry.path.split("/");
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;

      if (isLast) {
        current.children.push({
          name: part,
          path: entry.path,
          isFolder: false,
          children: [],
          summary: entry.summary,
        });
      } else {
        let folder = current.children.find((c) => c.isFolder && c.name === part);
        if (!folder) {
          folder = {
            name: part,
            path: parts.slice(0, i + 1).join("/"),
            isFolder: true,
            children: [],
          };
          current.children.push(folder);
        }
        current = folder;
      }
    }
  }

  const sortNodes = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const n of nodes) {
      if (n.isFolder) sortNodes(n.children);
    }
  };
  sortNodes(root.children);

  return root.children;
}

// ── Drift badge ──────────────────────────────────────────────────────

function DriftBadge({ status }: { status?: string }) {
  if (!status) return null;
  if (status === "ok") return <span className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" title="In sync" />;
  if (status === "drifted") return <span className="w-1.5 h-1.5 rounded-full bg-yellow-500 flex-shrink-0" title="Drifted from code" />;
  if (status === "missing") return <span className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" title="Missing from codebase" />;
  return null;
}

// ── Folder/file node ─────────────────────────────────────────────────

function FolderNode({
  node,
  depth,
  selectedPath,
  expandedFolders,
  onToggleFolder,
  onSelectFile,
  driftResults,
}: {
  node: TreeNode;
  depth: number;
  selectedPath: string | null;
  expandedFolders: Set<string>;
  onToggleFolder: (path: string) => void;
  onSelectFile: (path: string) => void;
  driftResults?: Record<string, { status: string; detail: string }>;
}) {
  const isExpanded = expandedFolders.has(node.path);
  const paddingLeft = 8 + depth * 16;

  if (node.isFolder) {
    return (
      <>
        <button
          onClick={() => onToggleFolder(node.path)}
          className="w-full text-left flex items-center gap-1.5 py-1 pr-2 hover:bg-overlay-medium transition-colors text-th-secondary"
          style={{ paddingLeft }}
        >
          {isExpanded ? (
            <CaretDown size={10} weight="bold" className="text-th-dimmed flex-shrink-0" />
          ) : (
            <CaretRight size={10} weight="bold" className="text-th-dimmed flex-shrink-0" />
          )}
          {isExpanded ? (
            <FolderOpen size={14} weight="fill" className="text-st-amber flex-shrink-0" />
          ) : (
            <FolderSimple size={14} weight="fill" className="text-st-amber flex-shrink-0" />
          )}
          <span className="text-xs truncate">{node.name}</span>
        </button>
        {isExpanded &&
          node.children.map((child) => (
            <FolderNode
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              expandedFolders={expandedFolders}
              onToggleFolder={onToggleFolder}
              onSelectFile={onSelectFile}
              driftResults={driftResults}
            />
          ))}
      </>
    );
  }

  const isSelected = selectedPath === node.path;
  const drift = driftResults?.[node.path];

  return (
    <button
      onClick={() => onSelectFile(node.path)}
      className={`w-full text-left flex items-center gap-1.5 py-1 pr-2 transition-colors ${
        isSelected
          ? "bg-brand-500/10 text-th-primary"
          : "text-th-secondary hover:bg-overlay-medium"
      }`}
      style={{ paddingLeft: paddingLeft + 14 }}
      title={drift?.detail || node.summary}
    >
      <FileText size={13} className={`flex-shrink-0 ${isSelected ? "text-brand-400" : "text-th-dimmed"}`} />
      <span className="text-xs truncate">{node.name}</span>
      <DriftBadge status={drift?.status} />
    </button>
  );
}

// ── Main component ───────────────────────────────────────────────────

export default function SpecEditor({ appId, onStartConversation }: SpecEditorProps) {
  const [entries, setEntries] = useState<SpecEntry[]>([]);
  const [specExists, setSpecExists] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState("");
  const [fileLoading, setFileLoading] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [hasPrinciples, setHasPrinciples] = useState(false);
  const [driftResults, setDriftResults] = useState<Record<string, { status: string; detail: string }>>({});

  const tree = useMemo(() => buildTree(entries), [entries]);

  // Auto-expand all folders on initial load
  useEffect(() => {
    const folders = new Set<string>();
    for (const entry of entries) {
      const parts = entry.path.split("/");
      for (let i = 1; i < parts.length; i++) {
        folders.add(parts.slice(0, i).join("/"));
      }
    }
    setExpandedFolders(folders);
  }, [entries]);

  const fetchIndex = useCallback(async () => {
    try {
      const res = await fetch(`/api/apps/${appId}/spec`);
      if (!res.ok) return;
      const data = await res.json();
      setSpecExists(data.exists);
      setEntries(data.entries || []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
    try {
      const res = await fetch(`/api/apps/${appId}/spec/PRINCIPLES.md`);
      setHasPrinciples(res.ok);
    } catch {
      setHasPrinciples(false);
    }
    try {
      const data = await getDriftResults(appId);
      if (data.results && data.results.length > 0) {
        const map: Record<string, { status: string; detail: string }> = {};
        for (const r of data.results) {
          map[r.path] = { status: r.status, detail: r.detail };
        }
        setDriftResults(map);
      }
    } catch {
      // ignore
    }
  }, [appId]);

  useEffect(() => {
    fetchIndex();
  }, [fetchIndex]);

  const loadFile = useCallback(async (filePath: string) => {
    setFileLoading(true);
    setSelectedPath(filePath);
    try {
      const res = await fetch(`/api/apps/${appId}/spec/${filePath}`);
      if (!res.ok) throw new Error("Failed to load file");
      const data = await res.json();
      setFileContent(data.content);
    } catch {
      setFileContent("");
    } finally {
      setFileLoading(false);
    }
  }, [appId]);

  const toggleFolder = useCallback((folderPath: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderPath)) {
        next.delete(folderPath);
      } else {
        next.add(folderPath);
      }
      return next;
    });
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 text-sm text-th-muted h-full">
        <SpinnerGap size={16} className="animate-spin" />
        Loading spec...
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* ── Sidebar: folder tree ───────────────────────────────── */}
      {entries.length > 0 && <div className="w-56 flex-shrink-0 border-r border-th flex flex-col bg-th-sidebar">
        {/* Header */}
        <div className="h-10 px-3 border-b border-th flex items-center justify-between">
          <span className="text-meta font-semibold text-th-muted uppercase tracking-wider">
            Spec Files
          </span>
        </div>

        {/* Principles entry */}
        {hasPrinciples && (
          <div className="px-1 py-1 border-b border-th">
            <button
              onClick={() => loadFile("PRINCIPLES.md")}
              className={`w-full text-left flex items-center gap-1.5 py-1 px-2 rounded transition-colors ${
                selectedPath === "PRINCIPLES.md"
                  ? "bg-brand-500/10 text-th-primary"
                  : "text-th-secondary hover:bg-overlay-medium"
              }`}
            >
              <BookOpen size={13} className={selectedPath === "PRINCIPLES.md" ? "text-brand-400" : "text-th-dimmed"} />
              <span className="text-xs font-medium">Principles</span>
            </button>
          </div>
        )}

        {/* Tree */}
        <div className="flex-1 overflow-y-auto py-1">
          {tree.map((node) => (
            <FolderNode
              key={node.path}
              node={node}
              depth={0}
              selectedPath={selectedPath}
              expandedFolders={expandedFolders}
              onToggleFolder={toggleFolder}
              onSelectFile={loadFile}
              driftResults={driftResults}
            />
          ))}
        </div>
      </div>}

      {/* ── Content pane (read-only) ───────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        {selectedPath ? (
          <>
            {/* File header bar */}
            <div className="h-10 px-4 border-b border-th flex items-center justify-between bg-th-subtle">
              <div className="flex items-center gap-2 min-w-0">
                <FileText size={14} className="text-th-dimmed flex-shrink-0" />
                <span className="text-xs font-mono text-th-secondary truncate">{selectedPath}</span>
              </div>
            </div>

            {/* Drift warning */}
            {selectedPath && driftResults[selectedPath] && driftResults[selectedPath].status !== "ok" && (
              <div className={`px-4 py-2 border-b ${
                driftResults[selectedPath].status === "drifted"
                  ? "bg-st-amber border-st-yellow"
                  : "bg-st-red border-st-red"
              }`}>
                <p className={`text-xs ${
                  driftResults[selectedPath].status === "drifted" ? "text-st-amber" : "text-st-red"
                }`}>
                  <span className="font-medium">
                    {driftResults[selectedPath].status === "drifted" ? "Drifted:" : "Missing:"}
                  </span>{" "}
                  {driftResults[selectedPath].detail}
                </p>
              </div>
            )}

            {/* Content area */}
            {fileLoading ? (
              <div className="flex-1 flex items-center justify-center">
                <SpinnerGap size={16} className="animate-spin text-th-muted" />
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto p-6">
                <div className={PROSE_CLASSES}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{fileContent}</ReactMarkdown>
                </div>
              </div>
            )}
          </>
        ) : (
          /* ── Welcome page ────────────────────────────────────── */
          <div className="flex-1 flex items-center justify-center overflow-y-auto">
            <div className="max-w-lg px-8 py-10 text-center">
              <div className="w-14 h-14 mx-auto mb-5 rounded-xl bg-th-muted flex items-center justify-center">
                <FileText size={28} className="text-th-dimmed" />
              </div>
              <p className="text-base text-th-primary mb-1.5 font-semibold">Living Specification</p>
              <p className="text-sm text-th-secondary mb-8 leading-relaxed">
                Your spec describes what your app does. To update the spec, start a new conversation — Archie will make the changes and you can review them in the sidebar diff.
              </p>

              <div className="text-left border border-th rounded-lg p-4 bg-th-subtle space-y-4">
                <div>
                  <p className="text-xs font-semibold text-th-secondary uppercase tracking-wider mb-2.5">How it works</p>
                  <ul className="space-y-2 text-sm text-th-secondary leading-relaxed">
                    <li><span className="text-th-primary font-medium">Start a conversation</span> and describe what you want to change in the spec.</li>
                    <li><span className="text-th-primary font-medium">Review changes</span> in the sidebar diff viewer — all edits happen in a worktree.</li>
                    <li><span className="text-th-primary font-medium">Create a PR</span> to publish spec changes, or continue implementing in the same branch.</li>
                    <li><span className="text-th-primary font-medium">Task-linked updates</span> — after completing a task, ask if the spec needs updating. Changes ship in the same PR.</li>
                  </ul>
                </div>
                <div className="border-t border-th pt-3">
                  <p className="text-xs font-semibold text-th-secondary uppercase tracking-wider mb-2.5">Conversation shortcuts</p>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => onStartConversation?.("Update the spec: ")} className="text-xs px-2.5 py-1.5 rounded bg-th-muted text-th-secondary font-mono hover:bg-th-strong hover:text-th-primary transition-colors cursor-pointer">/update-spec</button>
                    <button onClick={() => onStartConversation?.("Generate a spec from the codebase")} className="text-xs px-2.5 py-1.5 rounded bg-th-muted text-th-secondary font-mono hover:bg-th-strong hover:text-th-primary transition-colors cursor-pointer">/generate-spec</button>
                    <button onClick={() => onStartConversation?.("Check if the spec has drifted from the codebase")} className="text-xs px-2.5 py-1.5 rounded bg-th-muted text-th-secondary font-mono hover:bg-th-strong hover:text-th-primary transition-colors cursor-pointer">/check-drift</button>
                    <button onClick={() => onStartConversation?.("Update the team skills: ")} className="text-xs px-2.5 py-1.5 rounded bg-th-muted text-th-secondary font-mono hover:bg-th-strong hover:text-th-primary transition-colors cursor-pointer">/update-skills</button>
                    <button onClick={() => onStartConversation?.("Update the team principles: ")} className="text-xs px-2.5 py-1.5 rounded bg-th-muted text-th-secondary font-mono hover:bg-th-strong hover:text-th-primary transition-colors cursor-pointer">/update-principles</button>
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
