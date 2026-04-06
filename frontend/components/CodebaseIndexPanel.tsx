"use client";

import { useState, useEffect, useCallback } from "react";
import { SpinnerGap, ArrowsClockwise, Brain, CaretDown, CaretRight } from "@phosphor-icons/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { PROSE_CLASSES } from "@/lib/prose";

const TOPIC_DESCRIPTIONS: Record<string, string> = {
  brief: "High-level project overview and purpose",
  architecture: "System design, components, and relationships",
  stack: "Technologies, frameworks, and dependencies",
  conventions: "Coding patterns and best practices",
  data_model: "Database schema and data structures",
  api: "API endpoints and integration points",
  auth: "Authentication and authorization flows",
  testing: "Test patterns and coverage",
};

interface CodebaseIndexTopic {
  topic: string;
  label: string;
  content: string;
  content_length: number;
}

interface CodebaseIndexJob {
  status: "running" | "completed" | "failed";
  progress: string;
  error: string | null;
}

interface CodebaseIndexData {
  job: CodebaseIndexJob | null;
  topics: CodebaseIndexTopic[];
}

interface CodebaseIndexPanelProps {
  appId: number;
}

export default function CodebaseIndexPanel({ appId }: CodebaseIndexPanelProps) {
  const [data, setData] = useState<CodebaseIndexData | null>(null);
  const [loading, setLoading] = useState(true);
  const [reindexing, setReindexing] = useState(false);
  const [expandedTopics, setExpandedTopics] = useState<Set<string>>(new Set(["brief"]));

  const loadCodebaseIndex = useCallback(async () => {
    try {
      const res = await fetch(`/api/apps/${appId}/knowledge`);
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch {
    } finally {
      setLoading(false);
    }
  }, [appId]);

  useEffect(() => {
    loadCodebaseIndex();
  }, [loadCodebaseIndex]);

  // Poll while job is running
  useEffect(() => {
    if (!data?.job || data.job.status !== "running") return;
    const interval = setInterval(loadCodebaseIndex, 2000);
    return () => clearInterval(interval);
  }, [data?.job?.status, loadCodebaseIndex]);

  const handleReindex = async () => {
    setReindexing(true);
    try {
      await fetch(`/api/apps/${appId}/knowledge`, { method: "POST" });
      // Small delay so the job registers before we poll
      await new Promise((r) => setTimeout(r, 500));
      await loadCodebaseIndex();
    } catch {
    } finally {
      setReindexing(false);
    }
  };

  const toggleTopic = (topic: string) => {
    setExpandedTopics((prev) => {
      const next = new Set(prev);
      if (next.has(topic)) next.delete(topic);
      else next.add(topic);
      return next;
    });
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex items-center gap-3 text-th-muted">
          <SpinnerGap size={20} className="animate-spin" />
          <span className="text-sm">Loading codebase index...</span>
        </div>
      </div>
    );
  }

  const job = data?.job;
  const topics = data?.topics || [];
  const isRunning = job?.status === "running";

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Brain size={24} weight="bold" className="text-th-muted" />
            <div>
              <h1 className="text-lg font-semibold text-th-primary">Codebase Index</h1>
              <p className="text-xs text-th-muted">
                Auto-indexed from your codebase · used as project context for conversations and tasks
              </p>
            </div>
          </div>
          <button
            onClick={handleReindex}
            disabled={isRunning || reindexing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-th text-th-secondary hover:text-th-primary hover:bg-th-subtle transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ArrowsClockwise
              size={14}
              weight="bold"
              className={isRunning || reindexing ? "animate-spin" : ""}
            />
            {isRunning ? "Indexing..." : "Re-index"}
          </button>
        </div>

        {/* Job status banner */}
        {job && isRunning && (
          <div className="mb-4 px-4 py-3 rounded-lg bg-st-blue border border-st-blue">
            <div className="flex items-center gap-2">
              <SpinnerGap size={14} className="animate-spin text-st-blue" />
              <span className="text-sm text-st-blue">{job.progress || "Indexing..."}</span>
            </div>
          </div>
        )}

        {job?.status === "failed" && job.error && (
          <div className="mb-4 px-4 py-3 rounded-lg bg-st-red border border-st-red">
            <span className="text-sm text-st-red">Indexing failed: {job.error}</span>
          </div>
        )}

        {/* Empty state */}
        {topics.length === 0 && !isRunning && (
          <div className="text-center py-12">
            <Brain size={40} className="mx-auto mb-3 text-th-muted opacity-40" />
            <p className="text-sm text-th-muted mb-3">No codebase index yet</p>
            <button
              onClick={handleReindex}
              disabled={reindexing}
              className="text-sm text-brand-400 hover:text-brand-300 font-medium"
            >
              Index this app now
            </button>
          </div>
        )}

        {/* Topic sections */}
        <div className="space-y-2">
          {topics.map((topic) => {
            const isExpanded = expandedTopics.has(topic.topic);
            return (
              <div
                key={topic.topic}
                className="border border-th rounded-lg overflow-hidden"
              >
                <button
                  onClick={() => toggleTopic(topic.topic)}
                  className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-th-subtle transition-colors"
                >
                  {isExpanded ? (
                    <CaretDown size={14} weight="bold" className="text-th-muted flex-shrink-0 mt-0.5" />
                  ) : (
                    <CaretRight size={14} weight="bold" className="text-th-muted flex-shrink-0 mt-0.5" />
                  )}
                  <div className="flex flex-col flex-1 min-w-0">
                    <span className="text-sm font-medium text-th-primary">
                      {topic.label}
                    </span>
                    {TOPIC_DESCRIPTIONS[topic.topic] && (
                      <span className="text-meta text-th-dimmed leading-tight">
                        {TOPIC_DESCRIPTIONS[topic.topic]}
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-th-dimmed flex-shrink-0">
                    {topic.content_length > 1000
                      ? `~${Math.ceil(topic.content_length / 1000)} min read`
                      : "Brief"}
                  </span>
                </button>
                {isExpanded && (
                  <div className="px-4 pb-4 border-t border-th">
                    <div className={`pt-3 ${PROSE_CLASSES}`}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {topic.content}
                      </ReactMarkdown>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
