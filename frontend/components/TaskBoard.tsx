"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  Check,
  CaretDown,
  GitPullRequest,
  PencilSimple,
  Play,
  Plus,
  SpinnerGap,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import {
  createProjectTask,
  createWorkItem,
  getProjectTasks,
  updateProjectTask,
} from "@/lib/api";
import type { ProjectTask, ProjectTaskStatus, Task } from "@/lib/types";

const COLUMNS: { status: ProjectTaskStatus; label: string }[] = [
  { status: "todo", label: "Todo" },
  { status: "in_progress", label: "In progress" },
  { status: "done", label: "Done" },
];

interface TaskBoardProps {
  appId: number;
  onOpenConversation: (workItemId: number) => void;
  onWorkItemCreated: (item: Task) => void;
}

export default function TaskBoard({ appId, onOpenConversation, onWorkItemCreated }: TaskBoardProps) {
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [startingTaskId, setStartingTaskId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingTask, setEditingTask] = useState<ProjectTask | null>(null);
  const [creating, setCreating] = useState(false);
  const [draggedTaskId, setDraggedTaskId] = useState<number | null>(null);

  const loadTasks = useCallback(async () => {
    try {
      setError(null);
      setTasks(await getProjectTasks(appId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tasks");
    } finally {
      setLoading(false);
    }
  }, [appId]);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  const tasksByStatus = useMemo(() => {
    const grouped = new Map<ProjectTaskStatus, ProjectTask[]>();
    for (const column of COLUMNS) grouped.set(column.status, []);
    for (const task of tasks) grouped.get(task.status)?.push(task);
    return grouped;
  }, [tasks]);

  const moveTask = async (taskId: number, status: ProjectTaskStatus) => {
    const task = tasks.find((item) => item.id === taskId);
    if (!task || task.status === status) return;
    const targetTasks = tasksByStatus.get(status) || [];
    const position = targetTasks.length;
    setTasks((current) => current.map((item) => item.id === taskId ? { ...item, status, position } : item));
    try {
      await updateProjectTask(appId, taskId, { status, position });
      await loadTasks();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to move task");
      await loadTasks();
    }
  };

  const handleSaved = async (task: ProjectTask) => {
    setTasks((current) => {
      const exists = current.some((item) => item.id === task.id);
      return exists ? current.map((item) => item.id === task.id ? task : item) : [...current, task];
    });
    setEditingTask(null);
    setCreating(false);
    await loadTasks();
  };

  const handleStartWork = async (task: ProjectTask) => {
    if (startingTaskId !== null) return;
    setStartingTaskId(task.id);
    setError(null);
    try {
      const prompt = task.description.trim() ? `${task.title}\n\n${task.description}` : task.title;
      const item = await createWorkItem(appId, prompt, undefined, [], task.id);
      onWorkItemCreated(item);
      await loadTasks();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start task");
    } finally {
      setStartingTaskId(null);
    }
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-th-bg">
      <div className="h-10 flex items-center justify-between gap-4 px-6 border-b border-th">
        <h1 className="text-sm font-semibold text-th-primary">Tasks</h1>
        <button
          onClick={() => setCreating(true)}
          className="h-7 inline-flex items-center gap-1.5 rounded-md border border-th bg-transparent px-2.5 text-xs font-medium text-th-secondary transition-colors hover:bg-th-muted hover:text-th-primary"
        >
          <Plus size={14} weight="bold" />
          New task
        </button>
      </div>

      {error && (
        <div className="mx-6 mt-4 flex items-center gap-2 rounded-lg border border-st-red/30 bg-st-red/10 px-3 py-2 text-sm text-st-red">
          <WarningCircle size={16} />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} aria-label="Dismiss error"><X size={15} /></button>
        </div>
      )}

      {loading ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-sm text-th-muted">
          <SpinnerGap size={18} className="animate-spin" />
          Loading tasks...
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden p-6">
          <div className="flex h-full min-w-max gap-3">
            {COLUMNS.map((column) => {
              const columnTasks = tasksByStatus.get(column.status) || [];
              return (
                <section
                  key={column.status}
                  className="flex h-full w-64 flex-col rounded-xl bg-th-subtle/60"
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (draggedTaskId !== null) void moveTask(draggedTaskId, column.status);
                    setDraggedTaskId(null);
                  }}
                >
                  <div className="flex items-center justify-between gap-2 px-3 py-3">
                    <div>
                      <div className="flex items-center gap-2 text-sm font-semibold text-th-primary">
                        <span className={`h-2 w-2 rounded-full ${statusDot(column.status)}`} />
                        {column.label}
                        <span className="text-xs font-normal text-th-dimmed">{columnTasks.length}</span>
                      </div>
                    </div>
                    <button
                      onClick={() => setCreating(true)}
                      className="rounded p-1 text-th-dimmed hover:bg-th-muted hover:text-th-primary"
                      title={`Add task to ${column.label}`}
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                  <div className="flex-1 space-y-2 overflow-y-auto px-2 pb-2">
                    {columnTasks.map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        starting={startingTaskId === task.id}
                        onEdit={() => setEditingTask(task)}
                        onStart={() => void handleStartWork(task)}
                        onOpenConversation={onOpenConversation}
                        onDragStart={() => setDraggedTaskId(task.id)}
                      />
                    ))}
                    {columnTasks.length === 0 && (
                      <div className="rounded-lg border border-dashed border-th px-3 py-6 text-center text-xs text-th-dimmed">
                        Drop tasks here
                      </div>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      )}

      {(creating || editingTask) && (
        <TaskEditor
          appId={appId}
          task={editingTask}
          saving={saving}
          onCancel={() => { setCreating(false); setEditingTask(null); }}
          onSaving={setSaving}
          onSaved={handleSaved}
          onError={setError}
        />
      )}
    </div>
  );
}

function TaskCard({
  task,
  starting,
  onEdit,
  onStart,
  onOpenConversation,
  onDragStart,
}: {
  task: ProjectTask;
  starting: boolean;
  onEdit: () => void;
  onStart: () => void;
  onOpenConversation: (workItemId: number) => void;
  onDragStart: () => void;
}) {
  const activeWorkItem = task.linked_work_items[0];
  return (
    <article
      draggable
      onDragStart={onDragStart}
      className="group cursor-grab rounded-lg border border-th bg-th-elevated p-3 shadow-sm transition-shadow hover:shadow-md active:cursor-grabbing"
    >
      <div className="flex items-start gap-2">
        <button onClick={onEdit} className="min-w-0 flex-1 text-left">
          <h3 className="text-sm font-medium leading-snug text-th-primary">{task.title}</h3>
        </button>
        <button onClick={onEdit} className="rounded p-1 text-th-dimmed opacity-0 transition-opacity hover:bg-th-muted hover:text-th-primary group-hover:opacity-100" aria-label="Edit task">
          <PencilSimple size={14} />
        </button>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-th pt-2">
        <div className="flex min-w-0 items-center gap-3">
          {activeWorkItem?.pr_url && (
            <a href={activeWorkItem.pr_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] text-st-blue hover:underline">
              <GitPullRequest size={13} /> PR #{activeWorkItem.pr_number}
            </a>
          )}
          {activeWorkItem?.primary_conversation_id && (
            <button onClick={() => onOpenConversation(activeWorkItem.work_item_id)} className="text-[11px] text-st-blue hover:underline">Open conversation</button>
          )}
          {!activeWorkItem && <span className="text-[11px] text-th-dimmed">Not started</span>}
        </div>
        {!activeWorkItem && task.status !== "done" && (
          <button onClick={onStart} disabled={starting} className="inline-flex items-center gap-1 rounded-md bg-btn-secondary px-2 py-1 text-[11px] font-medium text-btn-secondary hover:opacity-80 disabled:opacity-50">
            {starting ? <SpinnerGap size={12} className="animate-spin" /> : <Play size={12} weight="fill" />}
            Start work
          </button>
        )}
      </div>
    </article>
  );
}

function TaskEditor({
  appId,
  task,
  saving,
  onCancel,
  onSaving,
  onSaved,
  onError,
}: {
  appId: number;
  task: ProjectTask | null;
  saving: boolean;
  onCancel: () => void;
  onSaving: (saving: boolean) => void;
  onSaved: (task: ProjectTask) => Promise<void>;
  onError: (error: string) => void;
}) {
  const [title, setTitle] = useState(task?.title || "");
  const [description, setDescription] = useState(task?.description || "");
  const [status, setStatus] = useState<ProjectTaskStatus>(task?.status || "todo");

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() || saving) return;
    onSaving(true);
    try {
      const saved = task
        ? await updateProjectTask(appId, task.id, { title: title.trim(), description, status })
        : await createProjectTask(appId, { title: title.trim(), description, status });
      await onSaved(saved);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to save task");
    } finally {
      onSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <form onSubmit={save} className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl border border-th bg-th-elevated p-5 shadow-xl">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-th-primary">{task ? "Edit task" : "New task"}</h2>
            <p className="mt-1 text-sm text-th-muted">Keep planning separate from execution.</p>
          </div>
          <button type="button" onClick={onCancel} className="rounded-lg p-1.5 text-th-muted hover:bg-th-muted hover:text-th-primary" aria-label="Close"><X size={18} /></button>
        </div>

        <label className="mt-5 block text-xs font-semibold uppercase tracking-wide text-th-dimmed">Title</label>
        <input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="What needs to be done?" className="mt-1.5 w-full rounded-lg border border-th bg-th-subtle px-3 py-2 text-sm text-th-primary outline-none focus:border-st-blue" />

        <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-th-dimmed">Description</label>
        <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={5} placeholder="Add context, acceptance criteria, or notes..." className="mt-1.5 w-full resize-y rounded-lg border border-th bg-th-subtle px-3 py-2 text-sm text-th-primary outline-none focus:border-st-blue" />

        <div className="mt-4">
          <FieldSelect label="Status" value={status} onChange={(value) => setStatus(value as ProjectTaskStatus)} options={COLUMNS.map((column) => ({ value: column.status, label: column.label }))} />
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-lg px-3 py-2 text-sm text-th-secondary hover:bg-th-muted">Cancel</button>
          <button type="submit" disabled={!title.trim() || saving} className="inline-flex items-center gap-2 rounded-lg bg-btn-primary px-3 py-2 text-sm font-medium text-btn-primary disabled:opacity-50">
            {saving ? <SpinnerGap size={15} className="animate-spin" /> : <Check size={15} weight="bold" />}
            {task ? "Save changes" : "Create task"}
          </button>
        </div>
      </form>
    </div>
  );
}

function FieldSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const selectedOption = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <label className="block text-xs font-semibold uppercase tracking-wide text-th-dimmed">
      {label}
      <div className="relative mt-1.5" ref={pickerRef}>
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-haspopup="listbox"
          aria-expanded={open}
          className="flex w-full items-center justify-between gap-2 rounded-lg border border-th bg-th-subtle px-3 py-2 text-left text-sm font-normal text-th-primary outline-none transition-colors hover:bg-th-muted focus:border-st-blue focus:ring-1 focus:ring-st-blue"
        >
          <span className="flex min-w-0 items-center gap-2">
            <span className={`h-2 w-2 shrink-0 rounded-full ${statusDot(value as ProjectTaskStatus)}`} />
            <span className="truncate">{selectedOption?.label || value}</span>
          </span>
          <CaretDown size={14} className={`shrink-0 text-th-muted transition-transform ${open ? "rotate-180" : ""}`} />
        </button>

        {open && (
          <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-lg border border-th bg-th-elevated p-1 shadow-xl" role="listbox" aria-label={label}>
            {options.map((option) => {
              const isSelected = option.value === value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors ${
                    isSelected ? "bg-st-blue/15 text-th-primary" : "text-th-secondary hover:bg-th-muted hover:text-th-primary"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${statusDot(option.value as ProjectTaskStatus)}`} />
                    {option.label}
                  </span>
                  {isSelected && <Check size={14} className="text-st-blue" weight="bold" />}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </label>
  );
}

function statusDot(status: ProjectTaskStatus): string {
  if (status === "done") return "bg-st-green";
  if (status === "in_progress") return "bg-st-blue";
  return "bg-th-dimmed";
}
