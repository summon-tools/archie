import * as dal from "./dal";
import type { TaskRow } from "./types";

type TaskWithUsers = TaskRow & {
  created_by_name?: string | null;
  created_by_color?: string | null;
  assigned_to_name?: string | null;
};

export function serializeTask(task: TaskWithUsers) {
  return {
    ...task,
    dependencies: dal.getTaskDependencies(task.id),
    linked_work_items: dal.getTaskWorkItems(task.id),
  };
}
