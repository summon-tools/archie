import { getDb } from "../db";
import type { AppDependencyRow } from "../types";

const DEPENDENCY_SELECT = `
  SELECT
    d.*,
    dependency.name AS dependency_name,
    dependency.description AS dependency_description,
    dependency.directory AS dependency_directory,
    dependency.github_repo AS dependency_github_repo
  FROM app_dependencies d
  JOIN apps dependency ON dependency.id = d.dependency_app_id
`;

export function listAppDependencies(appId: number): AppDependencyRow[] {
  return getDb().prepare(
    `${DEPENDENCY_SELECT} WHERE d.app_id = ? ORDER BY dependency.name COLLATE NOCASE ASC, d.id ASC`
  ).all(appId) as AppDependencyRow[];
}

export function getAppDependency(appId: number, dependencyId: number): AppDependencyRow | undefined {
  return getDb().prepare(
    `${DEPENDENCY_SELECT} WHERE d.app_id = ? AND d.id = ?`
  ).get(appId, dependencyId) as AppDependencyRow | undefined;
}

export function createAppDependency(data: {
  app_id: number;
  dependency_app_id: number;
  role: string;
  purpose: string;
}): AppDependencyRow {
  const db = getDb();
  const result = db.prepare(
    `INSERT INTO app_dependencies (app_id, dependency_app_id, role, purpose)
     VALUES (?, ?, ?, ?)`
  ).run(data.app_id, data.dependency_app_id, data.role, data.purpose);
  return getAppDependency(data.app_id, Number(result.lastInsertRowid))!;
}

export function updateAppDependency(
  appId: number,
  dependencyId: number,
  fields: { role?: string; purpose?: string },
): AppDependencyRow | undefined {
  const db = getDb();
  const setParts: string[] = [];
  const values: unknown[] = [];
  for (const field of ["role", "purpose"] as const) {
    if (fields[field] !== undefined) {
      setParts.push(`${field} = ?`);
      values.push(fields[field]);
    }
  }
  if (setParts.length > 0) {
    setParts.push("updated_at = datetime('now')");
    values.push(appId, dependencyId);
    db.prepare(
      `UPDATE app_dependencies SET ${setParts.join(", ")} WHERE app_id = ? AND id = ?`
    ).run(...values);
  }
  return getAppDependency(appId, dependencyId);
}

export function deleteAppDependency(appId: number, dependencyId: number): boolean {
  const result = getDb().prepare(
    "DELETE FROM app_dependencies WHERE app_id = ? AND id = ?"
  ).run(appId, dependencyId);
  return result.changes > 0;
}
