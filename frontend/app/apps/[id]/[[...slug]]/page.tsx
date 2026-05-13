"use client";

import { useEffect, useState, useCallback, useRef, lazy, Suspense } from "react";
import { useParams, useRouter } from "next/navigation";
import { SpinnerGap, WarningCircle } from "@phosphor-icons/react";
import { App, HomeRoom, Task } from "@/lib/types";
import { getApp, getApps, getRooms, createRoom, updateRoom, getWorkItem, getWorkItems, startApp, stopApp, restartApp, archiveConversation } from "@/lib/api";
import ChatSidebar from "@/components/ChatSidebar";
import ConversationView from "@/components/ConversationView";
import AppSettingsPanel from "@/components/AppSettingsPanel";
import NewChatView from "@/components/NewChatView";
import RoomWorkspace from "@/components/RoomWorkspace";
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
  const roomIdFromUrl = slug && slug[0] === "rooms" && slug[1] ? Number(slug[1]) : null;
  const isRoomsPage = slug?.[0] === "rooms" || slug?.[0] === "home";
  const isSettingsPage = slug?.[0] === "settings";
  const isSpecPage = slug?.[0] === "spec";
  const isCodebaseIndexPage = slug?.[0] === "codebase-index" || slug?.[0] === "knowledge";
  const isSkillsPage = slug?.[0] === "skills";
  const isNotificationsPage = slug?.[0] === "notifications";
  const [app, setApp] = useState<App | null>(null);
  const [allApps, setAllApps] = useState<App[]>([]);
  const [workItems, setWorkItems] = useState<Task[]>([]);
  const [rooms, setRooms] = useState<HomeRoom[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<number | null>(itemIdFromUrl);
  const [selectedRoomId, setSelectedRoomId] = useState<number | null>(roomIdFromUrl);
  const [selectedItem, setSelectedItem] = useState<Task | null>(null);
  const [showNewItem, setShowNewItem] = useState(!itemIdFromUrl && !isRoomsPage && !isSettingsPage && !isSpecPage && !isCodebaseIndexPage && !isSkillsPage && !isNotificationsPage);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Active view: null = conversation/new, "settings" = app settings, "profile" = profile
  const [activeView, setActiveView] = useState<string | null>(isRoomsPage ? "room" : isSettingsPage ? "settings" : isSpecPage ? "spec" : isCodebaseIndexPage ? "codebase-index" : isSkillsPage ? "skills" : isNotificationsPage ? "notifications" : null);
  const [notificationUnreadCount, setNotificationUnreadCount] = useState(0);
  const [prefillMessage, setPrefillMessage] = useState<string | null>(null);
  const replacePath = useCallback((path: string) => {
    router.replace(path);
  }, [router]);

  // Handle "Start Conversation" from inbox task proposals
  const handleStartConversation = useCallback((message: string) => {
    setPrefillMessage(message);
    setSelectedItemId(null);
    setSelectedItem(null);
    setShowNewItem(true);
    setActiveView(null);
    replacePath(`/apps/${appId}`);
  }, [appId, replacePath]);

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
      const [appData, itemsData, appsData, roomsData] = await Promise.all([
        getApp(appId),
        getWorkItems(appId),
        getApps(),
        getRooms(appId),
      ]);
      setApp(appData);
      setWorkItems(itemsData);
      setAllApps(appsData);
      setRooms(roomsData);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load app — try refreshing the page");
    } finally {
      setLoading(false);
    }
  }, [appId, replacePath]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Sync item selection from URL
  useEffect(() => {
    if (itemIdFromUrl && itemIdFromUrl !== selectedItemId) {
      setSelectedItemId(itemIdFromUrl);
      setSelectedRoomId(null);
      setShowNewItem(false);
      setActiveView(null);
    }
  }, [itemIdFromUrl]);

  // Sync room selection from URL
  useEffect(() => {
    if (roomIdFromUrl && roomIdFromUrl !== selectedRoomId) {
      setSelectedRoomId(roomIdFromUrl);
      setSelectedItemId(null);
      setShowNewItem(false);
      setActiveView("room");
    }
  }, [roomIdFromUrl]);

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
    setSelectedRoomId(null);
    setShowNewItem(false);
    setActiveView(null);
    replacePath(`/apps/${appId}/conversation/${itemId}`);
  };

  const handleSelectRoom = useCallback((roomId: number) => {
    setSelectedRoomId(roomId);
    setSelectedItemId(null);
    setSelectedItem(null);
    setShowNewItem(false);
    setActiveView("room");
    replacePath(`/apps/${appId}/rooms/${roomId}`);
  }, [appId, replacePath]);

  const handleNewRoom = useCallback(async () => {
    try {
      const room = await createRoom(appId, {
        title: `Planning Room ${rooms.length + 1}`,
        purpose: "Plan and coordinate project work before creating implementation tasks.",
      });
      setRooms((prev) => [room, ...prev]);
      handleSelectRoom(room.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create room");
    }
  }, [appId, rooms.length, handleSelectRoom]);

  const handleCloseRoom = useCallback(async (roomId: number) => {
    try {
      const closedRoom = await updateRoom(appId, roomId, { status: "archived" });
      let nextRoomId: number | null = null;
      setRooms((currentRooms) => {
        nextRoomId = currentRooms.find((room) => room.status === "open" && room.id !== roomId)?.id ?? null;
        return currentRooms.map((room) => (room.id === roomId ? closedRoom : room));
      });

      if (selectedRoomId === roomId) {
        if (nextRoomId) {
          handleSelectRoom(nextRoomId);
        } else {
          setSelectedRoomId(null);
          setSelectedItemId(null);
          setSelectedItem(null);
          setShowNewItem(false);
          setActiveView("room");
          replacePath(`/apps/${appId}/rooms`);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to close room");
    }
  }, [appId, handleSelectRoom, replacePath, selectedRoomId]);

  // Handle new item
  const handleNewItem = () => {
    setSelectedItemId(null);
    setSelectedRoomId(null);
    setSelectedItem(null);
    setShowNewItem(true);
    setActiveView(null);
    replacePath(`/apps/${appId}`);
  };

  // Handle view change from sidebar (settings, profile)
  const handleViewChange = (view: string | null) => {
    setActiveView(view);
    if (view === "room") {
      setSelectedItemId(null);
      setSelectedItem(null);
      setShowNewItem(false);
      if (selectedRoomId) {
        replacePath(`/apps/${appId}/rooms/${selectedRoomId}`);
      } else {
        const firstOpenRoom = rooms.find((room) => room.status === "open");
        if (firstOpenRoom) {
          handleSelectRoom(firstOpenRoom.id);
          return;
        }
        replacePath(`/apps/${appId}/rooms`);
      }
    } else if (view === "settings") {
      replacePath(`/apps/${appId}/settings`);
    } else if (view === "spec") {
      replacePath(`/apps/${appId}/spec`);
    } else if (view === "codebase-index") {
      replacePath(`/apps/${appId}/codebase-index`);
    } else if (view === "skills") {
      replacePath(`/apps/${appId}/skills`);
    } else if (view === "inbox") {
      replacePath(`/apps/${appId}/inbox`);
    } else if (view === "notifications") {
      replacePath(`/apps/${appId}/notifications`);
    } else if (view === null) {
      // Go back to current item or new item
      if (selectedItemId) {
        replacePath(`/apps/${appId}/conversation/${selectedItemId}`);
      } else {
        replacePath(`/apps/${appId}`);
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
        replacePath(`/apps/${appId}`);
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
      replacePath(`/apps/${appId}/conversation/${next.id}`);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [workItems, selectedItemId, appId, replacePath]);

  // Handle item created
  const handleItemCreated = (item: Task) => {
    setWorkItems((prev) => [item, ...prev]);
    setSelectedRoomId(null);
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
    setSelectedRoomId(null);
    setSelectedItem(null);
    setShowNewItem(true);
    setActiveView(null);
    loadData();
    replacePath(`/apps/${appId}`);
  };

  const selectedRoom = selectedRoomId
    ? rooms.find((room) => room.id === selectedRoomId) || null
    : null;

  useEffect(() => {
    if (loading || activeView !== "room" || selectedRoomId) return;
    const firstOpenRoom = rooms.find((room) => room.status === "open");
    if (!firstOpenRoom) return;
    handleSelectRoom(firstOpenRoom.id);
  }, [activeView, handleSelectRoom, loading, rooms, selectedRoomId]);

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

    if (activeView === "room") {
      return (
        <RoomWorkspace
          appId={appId}
          room={selectedRoom}
          onOpenConversation={handleSelectItem}
          onWorkItemCreated={handleItemCreated}
          onCloseRoom={handleCloseRoom}
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
                  replacePath(`/apps/${appId}/conversation/${wi.id}`);
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
        rooms={rooms}
        roomsLoading={loading}
        selectedRoomId={selectedRoomId}
        selectedItemId={selectedItemId}
        activeWorkMode={activeView === "room" ? "rooms" : "tasks"}
        onSelectRoom={handleSelectRoom}
        onNewRoom={handleNewRoom}
        onCloseRoom={handleCloseRoom}
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
