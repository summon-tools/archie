"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
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
import type { ProjectTask, ProjectTaskPriority, ProjectTaskStatus, Task } from "@/lib/types";

const COLUMNS: { status: ProjectTaskStatus; label: string; description: string }[] = [
  { status: "backlog", label: "Backlog", description: "Ideas and work not yet ready" },
  { status: "ready", label: "Ready", description: "Defined and ready to pick up" },
  { status: "in_progress", label: "In progress", description: "Currently being implemented" },
  { status: "review", label: "Review", description: "Waiting for review or approval" },
  { status: "blocked", label: "Blocked", description: "Waiting on a decision or dependency" },
  { status: "done", label: "Done", description: "Accepted or completed" },
];

const PRIORITIES: { value: ProjectTaskPriority; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
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
      <div className="flex items-center justify-between gap-4 px-6 py-4 border-b border-th">
        <div>
          <h1 className="text-lg font-semibold text-th-primary">Tasks</h1>
          <p className="text-sm text-th-muted mt-0.5">Plan work now. Start implementation when a task is ready.</p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-btn-primary px-3 py-2 text-sm font-medium text-btn-primary hover:opacity-90"
        >
          <Plus size={16} weight="bold" />
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
                  <div className="flex items-start justify-between gap-2 px-3 py-3">
                    <div>
                      <div className="flex items-center gap-2 text-sm font-semibold text-th-primary">
                        <span className={`h-2 w-2 rounded-full ${statusDot(column.status)}`} />
                        {column.label}
                        <span className="text-xs font-normal text-th-dimmed">{columnTasks.length}</span>
                      </div>
                      <p className="mt-1 text-xs text-th-dimmed">{column.description}</p>
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
          tasks={tasks}
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
      {task.description && <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-th-muted">{task.description}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${priorityStyle(task.priority)}`}>{task.priority}</span>
        {task.dependencies.length > 0 && (
          <span className="rounded bg-th-muted px-1.5 py-0.5 text-[10px] text-th-muted" title="Dependencies">
            {task.dependencies.length} dep{task.dependencies.length === 1 ? "" : "s"}
          </span>
        )}
        {task.parent_task_id && <span className="rounded bg-th-muted px-1.5 py-0.5 text-[10px] text-th-muted">Subtask</span>}
        {activeWorkItem && <span className="rounded bg-st-blue/10 px-1.5 py-0.5 text-[10px] text-st-blue">Execution linked</span>}
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-th pt-2">
        {activeWorkItem?.pr_url ? (
          <a href={activeWorkItem.pr_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] text-st-blue hover:underline">
            <GitPullRequest size={13} /> PR #{activeWorkItem.pr_number}
          </a>
        ) : activeWorkItem?.primary_conversation_id ? (
          <button onClick={() => onOpenConversation(activeWorkItem.work_item_id)} className="text-[11px] text-st-blue hover:underline">Open conversation</button>
        ) : (
          <span className="text-[11px] text-th-dimmed">Not started</span>
        )}
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
  tasks,
  saving,
  onCancel,
  onSaving,
  onSaved,
  onError,
}: {
  appId: number;
  task: ProjectTask | null;
  tasks: ProjectTask[];
  saving: boolean;
  onCancel: () => void;
  onSaving: (saving: boolean) => void;
  onSaved: (task: ProjectTask) => Promise<void>;
  onError: (error: string) => void;
}) {
  const [title, setTitle] = useState(task?.title || "");
  const [description, setDescription] = useState(task?.description || "");
  const [status, setStatus] = useState<ProjectTaskStatus>(task?.status || "backlog");
  const [priority, setPriority] = useState<ProjectTaskPriority>(task?.priority || "medium");
  const [parentTaskId, setParentTaskId] = useState<number | null>(task?.parent_task_id || null);
  const [dependencyIds, setDependencyIds] = useState<number[]>(task?.dependencies.map((dependency) => dependency.depends_on_task_id) || []);
  const availableTasks = tasks.filter((candidate) => candidate.id !== task?.id);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() || saving) return;
    onSaving(true);
    try {
      const saved = task
        ? await updateProjectTask(appId, task.id, { title: title.trim(), description, status, priority, parent_task_id: parentTaskId, dependency_ids: dependencyIds })
        : await createProjectTask(appId, { title: title.trim(), description, status, priority, parent_task_id: parentTaskId, dependency_ids: dependencyIds });
      await onSaved(saved);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to save task");
    } finally {
      onSaving(false);
    }
  };

  const toggleDependency = (id: number) => {
    setDependencyIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
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

        <div className="mt-4 grid grid-cols-2 gap-3">
          <FieldSelect label="Status" value={status} onChange={(value) => setStatus(value as ProjectTaskStatus)} options={COLUMNS.map((column) => ({ value: column.status, label: column.label }))} />
          <FieldSelect label="Priority" value={priority} onChange={(value) => setPriority(value as ProjectTaskPriority)} options={PRIORITIES} />
        </div>

        <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-th-dimmed">Parent task</label>
        <select value={parentTaskId || ""} onChange={(event) => setParentTaskId(event.target.value ? Number(event.target.value) : null)} className="mt-1.5 w-full rounded-lg border border-th bg-th-subtle px-3 py-2 text-sm text-th-primary outline-none focus:border-st-blue">
          <option value="">No parent task</option>
          {availableTasks.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.title}</option>)}
        </select>

        <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-th-dimmed">Dependencies</label>
        <div className="mt-1.5 max-h-32 space-y-1 overflow-y-auto rounded-lg border border-th bg-th-subtle p-2">
          {availableTasks.length === 0 ? <p className="px-1 py-2 text-xs text-th-dimmed">No other tasks yet.</p> : availableTasks.map((candidate) => (
            <label key={candidate.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-th-secondary hover:bg-th-muted">
              <input type="checkbox" checked={dependencyIds.includes(candidate.id)} onChange={() => toggleDependency(candidate.id)} />
              <span className="truncate">{candidate.title}</span>
              <span className="ml-auto text-[10px] text-th-dimmed">{candidate.status.replace("_", " ")}</span>
            </label>
          ))}
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
  return (
    <label className="block text-xs font-semibold uppercase tracking-wide text-th-dimmed">
      {label}
      <span className="relative mt-1.5 block">
        <select value={value} onChange={(event) => onChange(event.target.value)} className="w-full appearance-none rounded-lg border border-th bg-th-subtle px-3 py-2 pr-8 text-sm font-normal capitalize text-th-primary outline-none focus:border-st-blue">
          {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <CaretDown size={14} className="pointer-events-none absolute right-2.5 top-2.5 text-th-muted" />
      </span>
    </label>
  );
}

function statusDot(status: ProjectTaskStatus): string {
  if (status === "done") return "bg-st-green";
  if (status === "blocked") return "bg-st-red";
  if (status === "in_progress") return "bg-st-blue";
  if (status === "review") return "bg-st-amber";
  return "bg-th-dimmed";
}

function priorityStyle(priority: ProjectTaskPriority): string {
  if (priority === "urgent") return "bg-st-red/15 text-st-red";
  if (priority === "high") return "bg-st-amber/15 text-st-amber";
  if (priority === "low") return "bg-th-muted text-th-dimmed";
  return "bg-st-blue/10 text-st-blue";
}
