import type { NextRequest } from "next/server";
import { ForbiddenError, getAuthUser } from "@/lib/server/auth";
import { getApp } from "@/lib/server/dal";

export async function requireProjectReviewMaintainer(request: NextRequest, appId: number) {
  const user = await getAuthUser(request);
  const app = getApp(appId);
  if (!app) return null;
  if (user.role !== "admin" && app.project_owner_user_id !== user.id) {
    throw new ForbiddenError("Project owner or admin access required");
  }
  return { app, user };
}
