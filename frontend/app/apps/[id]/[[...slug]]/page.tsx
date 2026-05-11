"use client";

import { useEffect, useState, useCallback, useRef, lazy, Suspense } from "react";
import { useParams, useRouter } from "next/navigation";
import { SpinnerGap, WarningCircle } from "@phosphor-icons/react";
import { App, Task } from "@/lib/types";
import { getApp, getApps, getWorkItem, getWorkItems, startApp, stopApp, restartApp, archiveConversation } from "@/lib/api";
import ChatSidebar from "@/components/ChatSidebar";
import ConversationView from "@/components/ConversationView";
import AppSettingsPanel from "@/components/AppSettingsPanel";
import NewChatView from "@/components/NewChatView";
import HomePanel from "@/components/HomePanel";
import SplitPanelLayout from "@/components/SplitPanelLayout";
import PreviewPanel from "@/components/PreviewPanel";
import SpecEditor from "@/components/SpecEditor";
import ProfilePanel from "@/components/ProfilePanel";
import CodebaseIndexPanel from "@/components/CodebaseIndexPanel";
import SkillsPanel from "@/components/SkillsPanel";
import NotificationPanel from "@/components/NotificationPanel";


import { usePreviewControls } from "@/hooks/usePreviewControls";
import { useTools } from "@/hooks/useTools";
import { sendConversationMessage } from "@/lib/api";
import type { ToolContext } from "@/tools/types";

const SIDEBAR_COLLAPSED_KEY = "archie-sidebar-collapsed";

export default function AppPage() {
  const params = useParams();
  const router = useRouter();
  const appId = Number(params.id);

  // Parse workItemId from optional catch-all slug: /apps/[id]/conversation/[itemId]
  const slug = params.slug as string[] | undefined;
  const itemIdFromUrl = slug && slug[0] === "conversation" && slug[1] ? Number(slug[1]) : null;
  const isHomePage = slug?.[0] === "home";
  const isSettingsPage = slug?.[0] === "settings";
  const isSpecPage = slug?.[0] === "spec";
  const isCodebaseIndexPage = slug?.[0] === "codebase-index" || slug?.[0] === "knowledge";
  const isSkillsPage = slug?.[0] === "skills";
  const isNotificationsPage = slug?.[0] === "notifications";
  const [app, setApp] = useState<App | null>(null);
  const [allApps, setAllApps] = useState<App[]>([]);
  const [workItems, setWorkItems] = useState<Task[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<number | null>(itemIdFromUrl);
  const [selectedItem, setSelectedItem] = useState<Task | null>(null);
  const [showNewItem, setShowNewItem] = useState(!itemIdFromUrl && !isHomePage && !isSettingsPage && !isSpecPage && !isCodebaseIndexPage && !isSkillsPage && !isNotificationsPage);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Active view: null = conversation/new, "settings" = app settings, "profile" = profile
  const [activeView, setActiveView] = useState<string | null>(isHomePage ? "home" : isSettingsPage ? "settings" : isSpecPage ? "spec" : isCodebaseIndexPage ? "codebase-index" : isSkillsPage ? "skills" : isNotificationsPage ? "notifications" : null);
  const [notificationUnreadCount, setNotificationUnreadCount] = useState(0);
  const [prefillMessage, setPrefillMessage] = useState<string | null>(null);

  // Handle "Start Conversation" from inbox task proposals
  const handleStartConversation = useCallback((message: string) => {
    setPrefillMessage(message);
    setSelectedItemId(null);
    setSelectedItem(null);
    setShowNewItem(true);
    setActiveView(null);
    window.history.replaceState(null, "", `/apps/${appId}`);
  }, [appId]);

  // Sidebar collapse state
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
    }
    return false;
  });

  const toggleSidebarCollapse = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next));
      return next;
    });
  }, []);

  // Load app, all apps, and work items
  const loadData = useCallback(async () => {
    try {
      const [appData, itemsData, appsData] = await Promise.all([
        getApp(appId),
        getWorkItems(appId),
        getApps(),
      ]);
      setApp(appData);
      setWorkItems(itemsData);
      setAllApps(appsData);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load app — try refreshing the page");
    } finally {
      setLoading(false);
    }
  }, [appId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Sync item selection from URL
  useEffect(() => {
    if (itemIdFromUrl && itemIdFromUrl !== selectedItemId) {
      setSelectedItemId(itemIdFromUrl);
      setShowNewItem(false);
      setActiveView(null);
    }
  }, [itemIdFromUrl]);

  // Load selected item details
  useEffect(() => {
    if (selectedItemId) {
      const fromList = workItems.find((t) => t.id === selectedItemId);
      if (fromList) {
        setSelectedItem(fromList);
      }
      getWorkItem(appId, selectedItemId)
        .then((t) => setSelectedItem(t))
        .catch(() => {});
    } else {
      setSelectedItem(null);
    }
  }, [selectedItemId, appId, workItems]);

  // Handle item selection
  const handleSelectItem = (itemId: number) => {
    setSelectedItemId(itemId);
    setShowNewItem(false);
    setActiveView(null);
    window.history.replaceState(null, "", `/apps/${appId}/conversation/${itemId}`);
  };

  // Handle new item
  const handleNewItem = () => {
    setSelectedItemId(null);
    setSelectedItem(null);
    setShowNewItem(true);
    setActiveView(null);
    window.history.replaceState(null, "", `/apps/${appId}`);
  };

  // Handle view change from sidebar (settings, profile)
  const handleViewChange = (view: string | null) => {
    setActiveView(view);
    if (view === "home") {
      window.history.replaceState(null, "", `/apps/${appId}/home`);
    } else if (view === "settings") {
      window.history.replaceState(null, "", `/apps/${appId}/settings`);
    } else if (view === "spec") {
      window.history.replaceState(null, "", `/apps/${appId}/spec`);
    } else if (view === "codebase-index") {
      window.history.replaceState(null, "", `/apps/${appId}/codebase-index`);
    } else if (view === "skills") {
      window.history.replaceState(null, "", `/apps/${appId}/skills`);
    } else if (view === "inbox") {
      window.history.replaceState(null, "", `/apps/${appId}/inbox`);
    } else if (view === "notifications") {
      window.history.replaceState(null, "", `/apps/${appId}/notifications`);
    } else if (view === null) {
      // Go back to current item or new item
      if (selectedItemId) {
        window.history.replaceState(null, "", `/apps/${appId}/conversation/${selectedItemId}`);
      } else {
        window.history.replaceState(null, "", `/apps/${appId}`);
      }
    }
  };

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      // Cmd+K — new conversation
      if (e.key === "k") {
        e.preventDefault();
        setSelectedItemId(null);
        setSelectedItem(null);
        setShowNewItem(true);
        setActiveView(null);
        window.history.replaceState(null, "", `/apps/${appId}`);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [appId]);

  // Cmd+[ / Cmd+] — cycle through active conversations
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key !== "[" && e.key !== "]") return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      const active = workItems.filter((i) => i.status !== "done");
      if (active.length === 0) return;
      e.preventDefault();

      const idx = active.findIndex((i) => i.id === selectedItemId);
      let next: Task;
      if (e.key === "[") {
        next = idx <= 0 ? active[active.length - 1] : active[idx - 1];
      } else {
        next = idx === -1 || idx >= active.length - 1 ? active[0] : active[idx + 1];
      }
      setSelectedItemId(next.id);
      setShowNewItem(false);
      setActiveView(null);
      window.history.replaceState(null, "", `/apps/${appId}/conversation/${next.id}`);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [workItems, selectedItemId, appId]);

  // Handle item created
  const handleItemCreated = (item: Task) => {
    setWorkItems((prev) => [item, ...prev]);
    setShowNewItem(false);
    setActiveView(null);
    setPrefillMessage(null);
    handleSelectItem(item.id);
  };

  // Handle item update
  const handleItemUpdate = useCallback(async () => {
    try {
      const itemsData = await getWorkItems(appId);
      setWorkItems(itemsData);
    } catch {}
    if (selectedItemId) {
      try {
        const t = await getWorkItem(appId, selectedItemId);
        setSelectedItem(t);
      } catch {}
    }
  }, [appId, selectedItemId]);

  // Handle item deleted
  const handleItemDeleted = () => {
    setSelectedItemId(null);
    setSelectedItem(null);
    setShowNewItem(true);
    setActiveView(null);
    loadData();
    window.history.replaceState(null, "", `/apps/${appId}`);
  };

  // Handle marking a work item as done from the sidebar
  const handleSidebarMarkDone = useCallback(async (itemId: number) => {
    const item = workItems.find((i) => i.id === itemId);
    if (!item?.primary_conversation_id) return;
    try {
      await archiveConversation(appId, item.primary_conversation_id);
      // If the completed item is currently selected, navigate away
      if (selectedItemId === itemId) {
        handleItemDeleted();
      } else {
        loadData();
      }
    } catch (err) {
      console.error("Failed to mark as done:", err);
    }
  }, [appId, workItems, selectedItemId, handleItemDeleted, loadData]);

  // App action handlers
  const handleAppAction = async (action: "start" | "stop" | "restart") => {
    setActionLoading(action);
    try {
      if (action === "start") await startApp(appId);
      else if (action === "stop") await stopApp(appId);
      else await restartApp(appId);
      const expectRunning = action !== "stop";
      const start = Date.now();
      while (Date.now() - start < 10000) {
        const current = await getApp(appId);
        if (current.is_running === expectRunning) {
          setApp(current);
          break;
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      loadData();
    } catch (err) {
      console.error(`Failed to ${action} app:`, err);
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="h-screen flex">
        <div className="w-64 bg-th-sidebar animate-pulse border-r border-th" />
        <div className="flex-1 flex items-center justify-center">
          <div className="flex items-center gap-3 text-th-muted">
            <SpinnerGap size={20} className="animate-spin" />
            <span className="text-sm">Loading...</span>
          </div>
        </div>
      </div>
    );
  }

  if (error || !app) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-st-red flex items-center justify-center">
            <WarningCircle size={24} className="text-red-500" />
          </div>
          <p className="text-sm text-th-muted mb-4">{error || "App not found"}</p>
          <a href="/" className="text-sm text-th-muted hover:text-th-primary font-medium">
            Back to Dashboard
          </a>
        </div>
      </div>
    );
  }

  // Determine main content
  const renderMainContent = () => {
    if (activeView === "settings") {
      return (
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-2xl mx-auto px-6 py-8">
            <AppSettingsPanel
              appId={appId}
              app={{
                id: app.id,
                name: app.name,
                is_running: app.is_running,
                port: app.port,
              }}
              githubRepo={app.github_repo}
              onAppAction={handleAppAction}
              actionLoading={actionLoading}
            />
          </div>
        </div>
      );
    }

    if (activeView === "home") {
      return (
        <HomePanel
          appId={appId}
          workItems={workItems}
          onOpenConversation={handleSelectItem}
          onWorkItemCreated={handleItemCreated}
        />
      );
    }

    if (activeView === "profile") {
      return <ProfilePanel />;
    }

    if (activeView === "spec") {
      return (
        <div className="flex-1 flex flex-col min-h-0">
          <SpecEditor appId={appId} onTasksChanged={loadData} onStartConversation={handleStartConversation} />
        </div>
      );
    }

    if (activeView === "codebase-index") {
      return (
        <div className="flex-1 flex flex-col min-h-0">
          <CodebaseIndexPanel appId={appId} />
        </div>
      );
    }

    if (activeView === "skills") {
      return (
        <div className="flex-1 flex flex-col min-h-0">
          <SkillsPanel appId={appId} onStartConversation={handleStartConversation} />
        </div>
      );
    }



    if (activeView === "notifications") {
      return (
        <div className="flex-1 flex flex-col min-h-0">
          <NotificationPanel
            appId={appId}
            onCountChange={setNotificationUnreadCount}
            onNavigateToConversation={async (convId) => {
              // Refresh work items to pick up automation-created tasks
              try {
                const freshItems = await getWorkItems(appId);
                setWorkItems(freshItems);
                const wi = freshItems.find((w: Task) => w.primary_conversation_id === convId);
                if (wi) {
                  setSelectedItemId(wi.id);
                  setActiveView(null);
                  setShowNewItem(false);
                  window.history.replaceState(null, "", `/apps/${appId}/conversation/${wi.id}`);
                }
              } catch {}
            }}
          />
        </div>
      );
    }

    if (showNewItem) {
      return <NewChatView appId={appId} onItemCreated={handleItemCreated} initialMessage={prefillMessage || undefined} />;
    }

    if (selectedItem) {
      return (
        <SelectedItemContent
          key={selectedItem.id}
          appId={appId}
          app={app!}
          workItem={selectedItem}
          onItemUpdate={handleItemUpdate}
          onItemDeleted={handleItemDeleted}
        />
      );
    }

    return <NewChatView appId={appId} onItemCreated={handleItemCreated} initialMessage={prefillMessage || undefined} />;
  };

  return (
    <div className="h-screen flex">
      {/* Sidebar */}
      <ChatSidebar
        appId={appId}
        app={app}
        apps={allApps}
        workItems={workItems}
        selectedItemId={selectedItemId}
        onSelectItem={handleSelectItem}
        onNewItem={handleNewItem}
        onMarkDone={handleSidebarMarkDone}
        isNewItemActive={showNewItem && !activeView}
        collapsed={sidebarCollapsed}
        onToggleCollapse={toggleSidebarCollapse}
        activeView={activeView}
        onViewChange={handleViewChange}
        notificationUnreadCount={notificationUnreadCount}
        onNotificationCountChange={setNotificationUnreadCount}
      />

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-w-0">
        {renderMainContent()}
      </div>
    </div>
  );
}

// Separate component so usePreviewControls hook has access to stable item reference
function SelectedItemContent({
  appId,
  app,
  workItem,
  onItemUpdate,
  onItemDeleted,
}: {
  appId: number;
  app: App;
  workItem: Task;
  onItemUpdate: () => void;
  onItemDeleted: () => void;
}) {
  const [localItem, setLocalItem] = useState(workItem);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    setLocalItem(workItem);
  }, [workItem]);

  const previewControls = usePreviewControls({
    appId,
    workItem: localItem,
    setWorkItem: setLocalItem,
    onItemUpdate,
  });

  const proxyBase = localItem.preview_port ? `/api/p/${localItem.preview_port}` : `/api/p/${app.port}`;

  // Diff control state (used by code walkthrough tool)
  const [forceTab, setForceTab] = useState<"preview" | "diff" | null>(null);
  const [diffHighlightFile, setDiffHighlightFile] = useState<string | null>(null);

  const toolContext: ToolContext = {
    appId,
    itemId: localItem.id,
    app,
    workItem: localItem,
    iframeRef,
    proxyBase,
    saveMessage: async (content, role, type) => {
      if (localItem.primary_conversation_id) {
        await sendConversationMessage(appId, localItem.primary_conversation_id, content, role, type);
      }
    },
    reloadMessages: async () => {
      // Will be overridden by ConversationView
    },
    setDiffHighlight: (file) => setDiffHighlightFile(file),
    setForceTab,
  };

  const toolStates = useTools(toolContext);

  const isArchived = localItem.status === "done" && !localItem.worktree_dir;

  // Archived conversations: full-width conversation, no preview panel
  if (isArchived) {
    return (
      <ConversationView
        key={localItem.id}
        appId={appId}
        workItem={localItem}
        setWorkItem={setLocalItem}
        onItemUpdate={onItemUpdate}
        onItemDeleted={onItemDeleted}
        toolStates={toolStates}
        toolContext={toolContext}
      />
    );
  }

  return (
    <SplitPanelLayout
      chatPanel={
        <ConversationView
          key={localItem.id}
          appId={appId}
          workItem={localItem}
          setWorkItem={setLocalItem}
          onItemUpdate={onItemUpdate}
          onItemDeleted={onItemDeleted}
          toolStates={toolStates}
          toolContext={toolContext}
        />
      }
      previewPanel={
        <PreviewPanel
          ref={iframeRef}
          workItem={localItem}
          startingPreview={previewControls.startingPreview}
          stoppingPreview={previewControls.stoppingPreview}
          restartingPreview={previewControls.restartingPreview}
          previewError={previewControls.previewError}
          onStartPreview={previewControls.startPreview}
          onStopPreview={previewControls.stopPreview}
          onRestartPreview={previewControls.restartPreview}
          appId={appId}
          appDirectory={app?.directory || undefined}
          narrationText={null}
          forceTab={forceTab}
          diffHighlightFile={diffHighlightFile}
        />
      }
    />
  );
}
