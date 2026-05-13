"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import useSWR from "swr";
import { App, Task, GitStatus, HomeRoom } from "@/lib/types";
import { fetcher } from "@/lib/swr";
import { SpinnerGap, X, Plus, CaretRight, CaretLeft, CaretUpDown, Check, FolderSimplePlus, BookOpen, Brain, Lightning, CheckCircle, CaretDown, SquaresFour, GearSix, ArrowDown, Bell, UsersThree, ChatsCircle, FileText } from "@phosphor-icons/react";
import BackgroundJobsBar from "./BackgroundJobsBar";

interface ChatSidebarProps {
  appId: number;
  app: App | null;
  apps?: App[];
  workItems: Task[];
  rooms: HomeRoom[];
  roomsLoading?: boolean;
  selectedRoomId: number | null;
  selectedItemId: number | null;
  activeWorkMode: "rooms" | "tasks";
  onSelectRoom: (roomId: number) => void;
  onNewRoom: () => void;
  onCloseRoom?: (roomId: number) => void;
  onSelectItem: (itemId: number) => void;
  onNewItem: () => void;
  onMarkDone?: (itemId: number) => void;
  isNewItemActive: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;
  activeView?: string | null;
  onViewChange?: (view: string | null) => void;
  notificationUnreadCount?: number;
  onNotificationCountChange?: (count: number) => void;
}

function ClaudeIndicator({ claudeStatus }: { claudeStatus: string | null }) {
  if (!claudeStatus) return null;
  if (claudeStatus === "running") {
    return (
      <span className="flex items-center">
        <SpinnerGap size={12} className="animate-spin text-st-blue" />
      </span>
    );
  }
  if (claudeStatus === "waiting_approval") {
    return <span className="w-2 h-2 rounded-full bg-yellow-500 flex-shrink-0" title="Waiting for response" />;
  }
  if (claudeStatus === "failed") {
    return (
      <X size={14} weight="bold" className="text-st-red flex-shrink-0" />
    );
  }
  return null;
}

function SectionLabel({ label }: { label: string }) {
  return (
    <div className="px-4 pt-3 pb-1 text-meta font-semibold uppercase tracking-wider text-th-dimmed">
      {label}
    </div>
  );
}

export default function ChatSidebar({
  appId,
  app,
  apps,
  workItems,
  rooms,
  roomsLoading,
  selectedRoomId,
  selectedItemId,
  activeWorkMode,
  onSelectRoom,
  onNewRoom,
  onCloseRoom,
  onSelectItem,
  onNewItem,
  onMarkDone,
  isNewItemActive,
  collapsed,
  onToggleCollapse,
  activeView,
  onViewChange,
  notificationUnreadCount,
  onNotificationCountChange,
}: ChatSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  // Poll app git status to detect when main is behind remote
  const { data: gitStatus } = useSWR<GitStatus>(
    `/api/apps/${appId}/git/status`,
    fetcher,
    { refreshInterval: 30000 }, // poll every 30s
  );
  const behindCount = gitStatus?.behind_count ?? 0;

  // Close project picker on outside click
  useEffect(() => {
    if (!showProjectPicker) return;
    const handleClick = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowProjectPicker(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showProjectPicker]);

  const appInitial = app?.name?.charAt(0).toUpperCase() || "?";
  const openRoomItems = rooms.filter((room) => room.status === "open");
  const openRooms = () => {
    if (selectedRoomId) onSelectRoom(selectedRoomId);
    else if (openRoomItems[0]) onSelectRoom(openRoomItems[0].id);
    else onViewChange?.("room");
  };

  // Collapsed sidebar
  if (collapsed) {
    return (
      <div className="w-14 flex-shrink-0 bg-th-sidebar border-r border-th flex flex-col h-full transition-all duration-200">
        {/* App icon */}
        <div className="h-10 flex items-center justify-center border-b border-th relative">
          <button
            onClick={() => onToggleCollapse()}
            className="w-8 h-8 rounded-lg bg-th-muted flex items-center justify-center text-sm font-semibold text-th-primary hover:bg-th-subtle transition-colors"
            title={app?.name || "Expand"}
          >
            {appInitial}
          </button>
          {behindCount > 0 && (
            <span
              className="absolute top-1 right-1.5 w-2.5 h-2.5 rounded-full bg-yellow-500 border border-th-sidebar"
              title={`${behindCount} commit${behindCount !== 1 ? "s" : ""} behind remote`}
            />
          )}
        </div>

        {/* Work group */}
        <div className="flex flex-col items-center py-1.5 gap-1">
          <button
            onClick={openRooms}
            className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
              activeWorkMode === "rooms"
                ? "bg-btn-secondary text-btn-secondary"
                : "text-th-muted hover:text-th-primary hover:bg-th-muted"
            }`}
            title="Rooms"
            aria-label="Rooms"
          >
            <UsersThree size={16} weight="bold" />
          </button>
          <button
            onClick={onNewRoom}
            className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors text-th-muted hover:text-th-primary hover:bg-th-muted"
            title="New Room"
            aria-label="New Room"
          >
            <Plus size={16} weight="bold" />
          </button>
          <button
            onClick={onNewItem}
            className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
              isNewItemActive
                ? "bg-btn-secondary text-btn-secondary"
                : "text-th-muted hover:text-th-primary hover:bg-th-muted"
            }`}
            title="New Task"
            aria-label="New Task"
          >
            <ChatsCircle size={16} weight="bold" />
          </button>
        </div>

        {/* Work dots */}
        <div className="flex-1 overflow-y-auto py-1">
          {activeWorkMode === "rooms"
            ? openRoomItems.map((room) => (
                <button
                  key={room.id}
                  onClick={() => onSelectRoom(room.id)}
                  className={`w-full flex items-center justify-center py-2 transition-colors ${
                    room.id === selectedRoomId ? "bg-th-muted" : "hover:bg-th-subtle"
                  }`}
                  title={room.title}
                  aria-label={room.title}
                >
                  <span className="w-2.5 h-2.5 rounded-full bg-th-muted" />
                </button>
              ))
            : workItems.filter((item) => item.status !== "done").map((item) => (
                <button
                  key={item.id}
                  onClick={() => onSelectItem(item.id)}
                  className={`w-full flex items-center justify-center py-2 transition-colors ${
                    item.id === selectedItemId ? "bg-th-muted" : "hover:bg-th-subtle"
                  }`}
                  title={item.title}
                  aria-label={item.title}
                >
                  <span className="w-2.5 h-2.5 rounded-full bg-th-muted" />
                </button>
              ))}
        </div>

        {/* Spacer between Work and Project Context groups */}
        <div className="h-2" />

        {/* Project Context group */}
        <div className="flex flex-col items-center gap-1 pb-1">
          <button
            onClick={() => onViewChange?.("spec")}
            className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
              activeView === "spec"
                ? "bg-btn-secondary text-btn-secondary"
                : "text-th-muted hover:text-th-primary hover:bg-th-muted"
            }`}
            title="App Spec"
            aria-label="App Spec"
          >
            <BookOpen size={16} weight="bold" />
          </button>
          <button
            onClick={() => onViewChange?.("codebase-index")}
            className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
              activeView === "codebase-index"
                ? "bg-btn-secondary text-btn-secondary"
                : "text-th-muted hover:text-th-primary hover:bg-th-muted"
            }`}
            title="Codebase Index"
            aria-label="Codebase Index"
          >
            <Brain size={16} weight="bold" />
          </button>
          <button
            onClick={() => onViewChange?.("skills")}
            className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
              activeView === "skills"
                ? "bg-btn-secondary text-btn-secondary"
                : "text-th-muted hover:text-th-primary hover:bg-th-muted"
            }`}
            title="Team Skills"
            aria-label="Team Skills"
          >
            <Lightning size={16} weight="bold" />
          </button>
          <button
            onClick={() => onViewChange?.("files")}
            className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
              activeView === "files"
                ? "bg-btn-secondary text-btn-secondary"
                : "text-th-muted hover:text-th-primary hover:bg-th-muted"
            }`}
            title="Files"
            aria-label="Files"
          >
            <FileText size={16} weight="bold" />
          </button>
        </div>

        {/* Footer */}
        <div className="border-t border-th py-2 space-y-1 flex flex-col items-center">
          <BackgroundJobsBar collapsed appId={appId} onNotificationCountChange={onNotificationCountChange} />
          <Link
            href="/"
            className="p-1.5 rounded-lg transition-colors text-th-muted hover:text-th-primary hover:bg-th-muted"
            title="Dashboard"
          >
            <SquaresFour size={16} weight="bold" />
          </Link>
          <button
            onClick={onToggleCollapse}
            className="p-1.5 text-th-muted hover:text-th-primary hover:bg-th-muted rounded-lg transition-colors"
            title="Expand sidebar"
            aria-label="Expand sidebar"
          >
            <CaretRight size={16} weight="bold" />
          </button>
        </div>
      </div>
    );
  }

  // Expanded sidebar
  return (
    <div className="w-64 flex-shrink-0 bg-th-sidebar border-r border-th flex flex-col h-full transition-all duration-200">
      {/* Project picker header */}
      <div className="h-10 px-3 border-b border-th flex items-center" ref={pickerRef}>
        <div className="flex items-center gap-1 flex-1 min-w-0 relative">
          <button
            onClick={() => setShowProjectPicker(!showProjectPicker)}
            className="flex items-center gap-2 flex-1 min-w-0 px-1.5 py-1 rounded-lg hover:bg-th-subtle transition-colors text-left"
          >
            <span
              className={`w-2 h-2 flex-shrink-0 ${
                app?.is_running ? "rounded-full bg-green-500" : "rounded-sm bg-th-strong"
              }`}
            />
            <span className="text-sm font-semibold text-th-primary truncate">
              {app?.name || "Loading..."}
            </span>
            {behindCount > 0 && (
              <span
                className="flex items-center gap-0.5 text-meta font-medium text-st-amber bg-st-amber/15 px-1.5 py-0.5 rounded-full flex-shrink-0"
                title={`${behindCount} commit${behindCount !== 1 ? "s" : ""} behind remote`}
              >
                <ArrowDown size={10} weight="bold" />
                {behindCount}
              </span>
            )}
            <CaretUpDown size={12} className="text-th-primary flex-shrink-0" />
          </button>

          {/* Collapse button */}
          <button
            onClick={onToggleCollapse}
            className="flex-shrink-0 p-1 text-th-muted hover:text-th-primary hover:bg-th-muted rounded transition-colors"
            title="Collapse sidebar"
            aria-label="Collapse sidebar"
          >
            <CaretLeft size={14} weight="bold" />
          </button>

          {/* Project dropdown */}
          {showProjectPicker && (
            <div className="absolute top-full left-0 mt-1 w-60 bg-th-elevated border border-th rounded-xl shadow-xl overflow-hidden z-50">
              {/* Project list */}
              {apps && apps.length > 0 ? (
                <div className="py-1 max-h-64 overflow-y-auto">
                  {apps.map((a) => (
                    <button
                      key={a.id}
                      onClick={() => {
                        setShowProjectPicker(false);
                        if (a.id !== appId) {
                          router.push(`/apps/${a.id}`);
                        }
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-th-muted transition-colors text-left"
                    >
                      <span
                        className={`w-2 h-2 flex-shrink-0 ${
                          a.is_running ? "rounded-full bg-green-500" : "rounded-sm bg-th-strong"
                        }`}
                      />
                      <span className={`text-sm truncate flex-1 ${a.id === appId ? "text-th-primary font-medium" : "text-th-secondary"}`}>
                        {a.name}
                      </span>
                      {a.id === appId && (
                        <Check size={14} className="text-th-muted flex-shrink-0" />
                      )}
                    </button>
                  ))}
                </div>
              ) : null}

              {/* Add new project */}
              <div className="border-t border-th py-1">
                <Link
                  href="/apps/new"
                  onClick={() => setShowProjectPicker(false)}
                  className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-th-muted transition-colors text-left text-sm text-th-secondary"
                >
                  <FolderSimplePlus size={14} className="text-th-muted" />
                  Add project
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── WORK ───────────────────────────────────────────── */}
      <SectionLabel label="Work" />
      <div className="px-3 pb-2">
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-th-muted p-1">
          <button
            onClick={openRooms}
            className={`px-2 py-1.5 rounded-md text-sm font-medium transition-colors ${
              activeWorkMode === "rooms" ? "bg-th-elevated text-th-primary shadow-sm" : "text-th-muted hover:text-th-primary"
            }`}
          >
            Rooms
          </button>
          <button
            onClick={() => onViewChange?.(null)}
            className={`px-2 py-1.5 rounded-md text-sm font-medium transition-colors ${
              activeWorkMode === "tasks" ? "bg-th-elevated text-th-primary shadow-sm" : "text-th-muted hover:text-th-primary"
            }`}
          >
            Tasks
          </button>
        </div>
      </div>

      <div className="px-3 pb-1 space-y-0.5">
        {activeWorkMode === "rooms" ? (
          <button
            onClick={onNewRoom}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm transition-colors text-th-secondary hover:text-th-primary hover:bg-th-subtle"
            title="New room"
          >
            <Plus size={15} weight="bold" className="text-th-muted" />
            New room
          </button>
        ) : (
          <button
            onClick={onNewItem}
            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm transition-colors ${
              isNewItemActive
                ? "text-th-primary font-medium"
                : "text-th-secondary hover:text-th-primary hover:bg-th-subtle"
            }`}
            title="New task (⌘K)"
          >
            <Plus size={15} weight="bold" className="text-th-muted" />
            New task
            <span className="ml-auto text-meta text-th-dimmed font-mono">⌘K</span>
          </button>
        )}
      </div>

      {activeWorkMode === "rooms" ? (
        <RoomList
          rooms={rooms}
          selectedRoomId={selectedRoomId}
          loading={roomsLoading}
          onSelectRoom={onSelectRoom}
          onCloseRoom={onCloseRoom}
        />
      ) : (
        <ConversationList
          workItems={workItems}
          selectedItemId={selectedItemId}
          activeView={activeView}
          onSelectItem={onSelectItem}
          onViewChange={onViewChange}
          onMarkDone={onMarkDone}
        />
      )}

      {/* ── PROJECT CONTEXT ────────────────────────────────── */}
      <div className="border-t border-th" />
      <SectionLabel label="Project Context" />
      <div className="px-3 pb-2 space-y-0.5">
        <button
          onClick={() => onViewChange?.("spec")}
          title="Living specification for your project"
          className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm transition-colors ${
            activeView === "spec"
              ? "text-th-primary font-medium"
              : "text-th-secondary hover:text-th-primary hover:bg-th-subtle"
          }`}
        >
          <BookOpen size={15} weight="bold" className="text-th-muted" />
          App Spec
        </button>
        <button
          onClick={() => onViewChange?.("codebase-index")}
          title="Auto-indexed codebase used as AI context"
          className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm transition-colors ${
            activeView === "codebase-index"
              ? "text-th-primary font-medium"
              : "text-th-secondary hover:text-th-primary hover:bg-th-subtle"
          }`}
        >
          <Brain size={15} weight="bold" className="text-th-muted" />
          Codebase Index
        </button>
        <button
          onClick={() => onViewChange?.("skills")}
          title="Team conventions and playbooks"
          className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm transition-colors ${
            activeView === "skills"
              ? "text-th-primary font-medium"
              : "text-th-secondary hover:text-th-primary hover:bg-th-subtle"
          }`}
        >
          <Lightning size={15} weight="bold" className="text-th-muted" />
          Skills
        </button>
        <button
          onClick={() => onViewChange?.("files")}
          title="Uploaded project files"
          className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm transition-colors ${
            activeView === "files"
              ? "text-th-primary font-medium"
              : "text-th-secondary hover:text-th-primary hover:bg-th-subtle"
          }`}
        >
          <FileText size={15} weight="bold" className="text-th-muted" />
          Files
        </button>
      </div>

      {/* ── INBOX & NOTIFICATIONS ──────────────────────────────── */}
      <div className="border-t border-th" />
      <div className="px-3 py-1.5 space-y-0.5">
        <button
          onClick={() => onViewChange?.("notifications")}
          className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm transition-colors ${
            activeView === "notifications"
              ? "text-th-primary font-medium"
              : "text-th-secondary hover:text-th-primary hover:bg-th-subtle"
          }`}
        >
          <Bell size={15} weight="bold" className="text-th-muted" />
          Notifications
          {(notificationUnreadCount ?? 0) > 0 && (
            <span className="ml-auto text-meta font-medium bg-brand-500/20 text-brand-400 px-1.5 py-0.5 rounded-full">
              {notificationUnreadCount}
            </span>
          )}
        </button>
      </div>

      {/* ── FOOTER ─────────────────────────────────────────── */}
      <div className="border-t border-th px-3 py-2 space-y-0.5">
        <BackgroundJobsBar collapsed={false} appId={appId} onNotificationCountChange={onNotificationCountChange} />
        <button
          onClick={() => onViewChange?.("settings")}
          className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm transition-colors ${
            activeView === "settings"
              ? "text-th-primary bg-th-muted font-medium"
              : "text-th-secondary hover:text-th-primary hover:bg-th-subtle"
          }`}
        >
          <GearSix size={15} weight="bold" className="text-th-muted" />
          Settings
          {behindCount > 0 && (
            <span className="ml-auto flex items-center gap-0.5 text-meta font-medium text-st-amber">
              <ArrowDown size={10} weight="bold" />
              {behindCount}
            </span>
          )}
        </button>
        <Link
          href="/"
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm transition-colors text-th-secondary hover:text-th-primary hover:bg-th-subtle"
        >
          <SquaresFour size={15} weight="bold" className="text-th-muted" />
          Dashboard
        </Link>
      </div>
    </div>
  );
}

function ConversationList({
  workItems,
  selectedItemId,
  activeView,
  onSelectItem,
  onViewChange,
  onMarkDone,
}: {
  workItems: Task[];
  selectedItemId: number | null;
  activeView?: string | null;
  onSelectItem: (itemId: number) => void;
  onViewChange?: (view: string | null) => void;
  onMarkDone?: (itemId: number) => void;
}) {
  const [showArchived, setShowArchived] = useState(false);

  // Split into active and archived
  const active = workItems.filter((item) => item.status !== "done");
  const archived = workItems.filter((item) => item.status === "done");

  return (
    <div className="flex-1 overflow-y-auto flex flex-col min-h-0">
      {active.length === 0 && archived.length === 0 ? (
        <div className="p-4 text-center text-sm text-th-muted">
          No tasks yet
        </div>
      ) : (
        <>
          {/* Active conversations */}
          <div>
            {active.map((item) => (
              <WorkItemEntry
                key={item.id}
                item={item}
                isSelected={item.id === selectedItemId && !activeView}
                onSelect={() => {
                  onViewChange?.(null);
                  onSelectItem(item.id);
                }}
                onMarkDone={onMarkDone ? () => onMarkDone(item.id) : undefined}
              />
            ))}
          </div>

          {/* Completed section — footer of work group */}
          {archived.length > 0 && (
            <div className="mt-auto">
              <button
                onClick={() => setShowArchived(!showArchived)}
                className="w-full flex items-center gap-2 px-4 py-1.5 text-xs text-th-dimmed hover:text-th-muted transition-colors"
              >
                <CheckCircle size={12} />
                <span>Completed ({archived.length})</span>
                <CaretDown
                  size={10}
                  className={`ml-auto transition-transform ${showArchived ? "" : "-rotate-90"}`}
                />
              </button>
              {showArchived && (
                <div className="pb-1">
                  {archived.map((item) => (
                    <WorkItemEntry
                      key={item.id}
                      item={item}
                      isSelected={item.id === selectedItemId && !activeView}
                      isArchived
                      onSelect={() => {
                        onViewChange?.(null);
                        onSelectItem(item.id);
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function RoomList({
  rooms,
  selectedRoomId,
  loading,
  onSelectRoom,
  onCloseRoom,
}: {
  rooms: HomeRoom[];
  selectedRoomId: number | null;
  loading?: boolean;
  onSelectRoom: (roomId: number) => void;
  onCloseRoom?: (roomId: number) => void;
}) {
  const [showClosed, setShowClosed] = useState(false);
  const openRooms = rooms.filter((room) => room.status === "open");
  const closedRooms = rooms.filter((room) => room.status !== "open");

  return (
    <div className="flex-1 overflow-y-auto flex flex-col min-h-0">
      {loading ? (
        <div className="p-4 text-center text-sm text-th-muted">Loading rooms...</div>
      ) : rooms.length === 0 ? (
        <div className="p-4 text-center text-sm text-th-muted">
          No rooms yet
        </div>
      ) : (
        <>
          <div>
            {openRooms.length === 0 ? (
              <div className="p-4 text-center text-sm text-th-muted">
                No open rooms
              </div>
            ) : (
              openRooms.map((room) => (
                <RoomEntry
                  key={room.id}
                  room={room}
                  isSelected={room.id === selectedRoomId}
                  onSelect={() => onSelectRoom(room.id)}
                  onClose={onCloseRoom ? () => onCloseRoom(room.id) : undefined}
                />
              ))
            )}
          </div>

          {closedRooms.length > 0 && (
            <div className="mt-auto">
              <button
                onClick={() => setShowClosed(!showClosed)}
                className="w-full flex items-center gap-2 px-4 py-1.5 text-xs text-th-dimmed hover:text-th-muted transition-colors"
              >
                <CheckCircle size={12} />
                <span>Closed ({closedRooms.length})</span>
                <CaretDown
                  size={10}
                  className={`ml-auto transition-transform ${showClosed ? "" : "-rotate-90"}`}
                />
              </button>
              {showClosed && (
                <div className="pb-1">
                  {closedRooms.map((room) => (
                    <RoomEntry
                      key={room.id}
                      room={room}
                      isSelected={room.id === selectedRoomId}
                      isClosed
                      onSelect={() => onSelectRoom(room.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function RoomEntry({
  room,
  isSelected,
  isClosed,
  onSelect,
  onClose,
}: {
  room: HomeRoom;
  isSelected: boolean;
  isClosed?: boolean;
  onSelect: () => void;
  onClose?: () => void;
}) {
  const [confirmingClose, setConfirmingClose] = useState(false);
  const closeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!confirmingClose) return;
    const handleClick = (event: MouseEvent) => {
      if (closeRef.current && !closeRef.current.contains(event.target as Node)) {
        setConfirmingClose(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [confirmingClose]);

  return (
    <div
      className={`group w-full text-left px-4 py-2 transition-colors duration-150 ${
        isSelected
          ? "bg-th-muted border-l-2 border-l-th-strong"
          : "border-l-2 border-l-transparent hover:bg-th-subtle"
      } ${isClosed ? "opacity-50" : ""}`}
    >
      <div className="flex items-center gap-2 pl-2">
        <button onClick={onSelect} className="min-w-0 flex-1 text-left" title={room.title}>
          <p className="text-sm text-th-primary truncate">{room.title}</p>
        </button>
        {onClose && !isClosed && (
          <div className="relative flex-shrink-0" ref={closeRef}>
            <button
              onClick={(event) => {
                event.stopPropagation();
                setConfirmingClose(true);
              }}
              className="p-1.5 rounded text-th-muted opacity-0 group-hover:opacity-100 hover:text-st-red hover:bg-th-muted transition-all"
              title="Close room"
              aria-label="Close room"
              aria-expanded={confirmingClose}
            >
              <CheckCircle size={14} weight="bold" />
            </button>
            {confirmingClose && (
              <div
                className="absolute right-0 top-full mt-1 w-52 bg-th-elevated border border-th rounded-xl shadow-xl overflow-hidden z-50 p-3"
                onClick={(event) => event.stopPropagation()}
              >
                <p className="text-xs text-th-muted mb-2.5">Close this room?</p>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => setConfirmingClose(false)}
                    className="flex-1 px-2.5 py-1 text-xs text-th-muted hover:text-th-primary transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      onClose();
                      setConfirmingClose(false);
                    }}
                    className="flex-1 px-2.5 py-1 text-xs font-medium bg-st-red text-st-red-strong border border-st-red rounded-lg hover:bg-st-red-hover transition-colors"
                  >
                    Close
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function WorkItemEntry({
  item,
  isSelected,
  onSelect,
  isArchived,
  onMarkDone,
}: {
  item: Task;
  isSelected: boolean;
  onSelect: () => void;
  isArchived?: boolean;
  onMarkDone?: () => void;
}) {
  return (
    <div
      className={`group w-full text-left px-4 py-2 transition-colors duration-150 ${
        isSelected
          ? "bg-th-muted border-l-2 border-l-th-strong"
          : "border-l-2 border-l-transparent hover:bg-th-subtle"
      } ${isArchived ? "opacity-50" : ""}`}
    >
      <div className="flex items-center gap-2 pl-2">
        <button onClick={onSelect} className="flex-1 min-w-0 text-left" title={`${item.title} · ⌘[ ⌘] to cycle`}>
          <p
            className={`text-sm truncate ${
              isSelected ? "text-th-primary font-medium" : "text-th-primary"
            }`}
          >
            {item.title}
          </p>
        </button>
        <ClaudeIndicator claudeStatus={item.claude_status} />
        {onMarkDone && !isArchived && (
          <button
            onClick={(e) => { e.stopPropagation(); onMarkDone(); }}
            className="flex-shrink-0 p-1.5 rounded text-th-muted opacity-0 group-hover:opacity-100 hover:text-st-green hover:bg-th-muted transition-all"
            title="Complete"
          >
            <CheckCircle size={14} weight="bold" />
          </button>
        )}
      </div>
    </div>
  );
}
