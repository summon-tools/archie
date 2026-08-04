import * as dal from "./dal";
import type { TaskRow } from "./types";

type TaskWithUsers = TaskRow & {
  created_by_name?: string | null;
  created_by_color?: string | null;
  assigned_to_name?: string | null;
};

export function serializeTask(task: TaskWithUsers) {
  const {
    priority: _legacyPriority,
    parent_task_id: _legacyParentTaskId,
    blocked_reason: _legacyBlockedReason,
    ...taskWithoutLegacyFields
  } = task as TaskWithUsers & { priority?: unknown; parent_task_id?: unknown; blocked_reason?: unknown };
  return {
    ...taskWithoutLegacyFields,
    linked_work_items: dal.getTaskWorkItems(task.id),
  };
}
