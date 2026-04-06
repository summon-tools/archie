import { NextRequest, NextResponse } from "next/server";
import * as dal from "@/lib/server/dal";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import { getKnowledgeJob } from "@/lib/server/knowledge/jobs";
import { getAllKnowledge } from "@/lib/server/knowledge/store";
import { indexApp } from "@/lib/server/knowledge/indexer";

/**
 * GET: Returns codebase index job status + artifact summaries.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string }> }
) {
  try {
    await getAuthUser(request);
    const { appId } = await params;
    const numericAppId = Number(appId);
    const app = dal.getApp(numericAppId);
    if (!app) {
      return NextResponse.json({ detail: "App not found" }, { status: 404 });
    }

    const job = getKnowledgeJob(numericAppId);
    const knowledge = getAllKnowledge(numericAppId);

    return NextResponse.json({
      job: job ? { status: job.status, progress: job.progress, error: job.error } : null,
      topics: knowledge.map((k) => ({
        topic: k.topic,
        label: k.label,
        content: k.content,
        content_length: k.content.length,
      })),
    });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ detail: e.message }, { status: 401 });
    }
    throw e;
  }
}

/**
 * POST: Triggers manual re-index.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string }> }
) {
  try {
    await getAuthUser(request);
    const { appId } = await params;
    const numericAppId = Number(appId);
    const app = dal.getApp(numericAppId);
    if (!app) {
      return NextResponse.json({ detail: "App not found" }, { status: 404 });
    }
    if (!app.directory) {
      return NextResponse.json({ detail: "App has no directory" }, { status: 400 });
    }

    const existing = getKnowledgeJob(numericAppId);
    if (existing?.status === "running") {
      return NextResponse.json({ detail: "Codebase indexing already running" }, { status: 409 });
    }

    // Fire and forget
    indexApp(numericAppId, app.directory).catch(() => {});

    return NextResponse.json({ started: true });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ detail: e.message }, { status: 401 });
    }
    throw e;
  }
}
