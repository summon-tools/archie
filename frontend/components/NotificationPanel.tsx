"use client";

import { useState, useEffect, useCallback } from "react";
import { SpinnerGap, Bell, Eye, CheckCircle, ArrowSquareOut, Checks } from "@phosphor-icons/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  type NotificationItem,
} from "@/lib/api";

import { PROSE_CLASSES } from "@/lib/prose";

const KIND_LABELS: Record<string, string> = {
  completed_work_review: "Work Review",
  spec_drift_review: "Spec Drift",
};

const KIND_COLORS: Record<string, string> = {
  completed_work_review: "bg-indigo-500/10 text-indigo-400",
  spec_drift_review: "bg-teal-500/10 text-teal-400",
};

type StatusFilter = "unread" | "all";

interface NotificationPanelProps {
  appId: number;
  onCountChange?: (count: number) => void;
  onNavigateToConversation?: (conversationId: number) => void;
}

export default function NotificationPanel({ appId, onCountChange, onNavigateToConversation }: NotificationPanelProps) {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("unread");

  // Notify parent whenever the local unread count settles.
  // Using an effect (rather than calling onCountChange inline) ensures the value
  // passed to the parent always reflects the fully-batched React state, even when
  // multiple items are opened before the next render cycle completes.
  useEffect(() => {
    onCountChange?.(unreadCount);
  }, [unreadCount, onCountChange]);

  const loadItems = useCallback(async () => {
    try {
      const status = statusFilter === "all" ? undefined : statusFilter;
      const data = await getNotifications(status, appId);
      setItems(data.notifications);
      setUnreadCount(data.unread_count);
    } catch {
    } finally {
      setLoading(false);
    }
  }, [statusFilter, appId]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const handleSelect = async (item: NotificationItem) => {
    setSelectedId(item.id);
    if (item.status === "unread") {
      // Optimistically update local state so the item stays visible.
      // onCountChange is driven by the useEffect above, so no inline call needed.
      setItems((prev) => prev.map((i) => i.id === item.id ? { ...i, status: "read" as const, read_at: new Date().toISOString() } : i));
      setUnreadCount((c) => Math.max(0, c - 1));
      try {
        await markNotificationRead(item.id);
      } catch {}
    }
  };

  const handleMarkAllRead = async () => {
    // Optimistically mark all local items read
    setItems((prev) => prev.map((i) => ({ ...i, status: "read" as const, read_at: i.read_at || new Date().toISOString() })));
    setUnreadCount(0);
    try {
      await markAllNotificationsRead(appId);
      // Reload to get accurate server state
      await loadItems();
    } catch {}
  };

  const selectedItem = items.find((i) => i.id === selectedId) || null;

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex items-center gap-3 text-th-muted">
          <SpinnerGap size={20} className="animate-spin" />
          <span className="text-sm">Loading notifications...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex min-h-0">
      {/* Left: item list */}
      <div className="w-72 flex-shrink-0 border-r border-th flex flex-col">
        {/* Header */}
        <div className="h-10 px-4 border-b border-th flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bell size={18} weight="bold" className="text-th-muted" />
            <span className="text-sm font-semibold text-th-primary">Notifications</span>
            {unreadCount > 0 && (
              <span className="text-meta font-medium bg-brand-500/20 text-brand-400 px-1.5 py-0.5 rounded-full">
                {unreadCount}
              </span>
            )}
          </div>
          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllRead}
              className="text-meta text-th-muted hover:text-th-primary transition-colors flex items-center gap-1"
              title="Mark all as read"
            >
              <Checks size={12} weight="bold" />
              All read
            </button>
          )}
        </div>

        {/* Filters */}
        <div className="px-3 py-2 border-b border-th flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value as StatusFilter); setSelectedId(null); }}
            className="text-xs bg-transparent text-th-secondary border-none focus:outline-none cursor-pointer"
          >
            <option value="unread">Unread</option>
            <option value="all">All</option>
          </select>
        </div>

        {/* Item list */}
        <div className="flex-1 overflow-y-auto">
          {items.length === 0 ? (
            <div className="p-6 text-center">
              <Bell size={32} className="mx-auto mb-3 text-th-muted opacity-40" />
              <p className="text-sm text-th-muted mb-1">
                {statusFilter === "unread" ? "No unread notifications" : "No notifications"}
              </p>
              <p className="text-xs text-th-dimmed">
                Automation results and updates will appear here.
              </p>
            </div>
          ) : (
            <div className="py-1">
              {items.map((item) => (
                <button
                  key={item.id}
                  onClick={() => handleSelect(item)}
                  className={`w-full text-left px-4 py-2.5 transition-colors ${
                    selectedId === item.id
                      ? "bg-th-muted border-l-2 border-l-th-strong"
                      : "border-l-2 border-l-transparent hover:bg-th-subtle"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    {item.status === "unread" && (
                      <span className="w-2 h-2 rounded-full bg-brand-400 flex-shrink-0" />
                    )}
                    <span className={`text-meta font-medium px-1.5 py-0.5 rounded ${KIND_COLORS[item.kind] || "bg-th-muted text-th-dimmed"}`}>
                      {KIND_LABELS[item.kind] || item.kind}
                    </span>
                  </div>
                  <p className={`text-sm truncate ${item.status === "unread" ? "text-th-primary font-medium" : "text-th-secondary"}`}>
                    {item.title}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    {item.app_name && (
                      <span className="text-meta text-th-dimmed">{item.app_name}</span>
                    )}
                    <span className="text-meta text-th-dimmed">
                      {new Date(item.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right: detail pane */}
      <div className="flex-1 overflow-y-auto">
        {selectedItem ? (
          <NotificationDetail
            item={selectedItem}
            onNavigateToConversation={onNavigateToConversation}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center h-full">
            <div className="text-center">
              <Bell size={32} className="mx-auto mb-3 text-th-muted opacity-30" />
              <p className="text-sm text-th-muted">Select a notification to view details</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function NotificationDetail({
  item,
  onNavigateToConversation,
}: {
  item: NotificationItem;
  onNavigateToConversation?: (conversationId: number) => void;
}) {
  return (
    <div className="flex flex-col h-full">
      {/* Top bar */}
      <div className="h-10 px-4 border-b border-th flex items-center gap-3 flex-shrink-0">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className={`text-meta font-medium px-1.5 py-0.5 rounded flex-shrink-0 ${KIND_COLORS[item.kind] || "bg-th-muted text-th-dimmed"}`}>
            {KIND_LABELS[item.kind] || item.kind}
          </span>
          <h2 className="text-sm font-semibold text-th-primary truncate">{item.title}</h2>
          {item.status === "read" && (
            <span className="text-meta px-1.5 py-0.5 rounded bg-th-muted text-th-dimmed flex items-center gap-1">
              <Eye size={10} /> read
            </span>
          )}
        </div>

        {item.related_conversation_id && (
          <button
            onClick={() => onNavigateToConversation?.(item.related_conversation_id!)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-brand-500/10 border border-brand-500/20 text-brand-400 hover:bg-brand-500/20 transition-colors"
          >
            <ArrowSquareOut size={13} weight="bold" />
            View Conversation
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-6 py-6">
          {/* Metadata line */}
          <div className="flex items-center gap-3 mb-5 text-xs text-th-dimmed">
            {item.app_name && (
              <span className="font-medium text-th-secondary">{item.app_name}</span>
            )}
            {item.automation_key && (
              <span className="flex items-center gap-1">
                <CheckCircle size={12} />
                {item.automation_key.replace(/_/g, " ")}
              </span>
            )}
            <span>{new Date(item.created_at).toLocaleString()}</span>
          </div>

          {/* Summary */}
          {item.summary_md && (
            <div className={PROSE_CLASSES}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.summary_md}</ReactMarkdown>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
