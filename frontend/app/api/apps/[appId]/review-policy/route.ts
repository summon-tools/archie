import { NextRequest, NextResponse } from "next/server";
import { AuthError, ForbiddenError } from "@/lib/server/auth";
import * as dal from "@/lib/server/dal";
import { requireProjectReviewMaintainer } from "@/lib/server/review-authorization";
import { reviewPolicySchema } from "@/lib/schemas/api";
import { formatZodError } from "@/lib/schemas/utils";

function idFrom(value: string): number | null {
  const id = Number.parseInt(value, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function auth(request: NextRequest, appId: number): Promise<NextResponse | null> {
  try {
    const authorized = await requireProjectReviewMaintainer(request, appId);
    return authorized ? null : NextResponse.json({ detail: "App not found" }, { status: 404 });
  }
  catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ detail: error.message }, { status: 401 });
    if (error instanceof ForbiddenError) return NextResponse.json({ detail: error.message }, { status: 403 });
    throw error;
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ appId: string }> }) {
  const appId = idFrom((await params).appId);
  if (!appId) return NextResponse.json({ detail: "Invalid app ID" }, { status: 400 });
  const error = await auth(request, appId); if (error) return error;
  const owner = request.nextUrl.searchParams.get("owner")?.trim() || "";
  const repo = request.nextUrl.searchParams.get("repo")?.trim() || "";
  const layers = dal.getReviewPolicyLayers(appId, owner, repo);
  return NextResponse.json({
    policy: layers.repository || layers.company || null,
    company_policy: layers.company || null,
    repository_policy: layers.repository || null,
  });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ appId: string }> }) {
  const appId = idFrom((await params).appId);
  if (!appId) return NextResponse.json({ detail: "Invalid app ID" }, { status: 400 });
  const error = await auth(request, appId); if (error) return error;
  const parsed = reviewPolicySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ detail: formatZodError(parsed.error) }, { status: 400 });
  const data = parsed.data;
  try {
    dal.archiveReviewPolicies(appId, data.owner ?? null, data.repo ?? null);
    const policy = dal.createReviewPolicy({
      app_id: appId,
      owner: data.owner ?? null,
      repo: data.repo ?? null,
      revision: data.revision,
      policy_json: JSON.stringify({
        priorities: data.priorities,
        severity_guidance: data.severity_guidance,
        required_checks: data.required_checks,
        behavior: data.behavior,
        tone: data.tone,
      }),
    });
    return NextResponse.json(policy, { status: 201 });
  } catch (error) {
    return NextResponse.json({ detail: error instanceof Error ? error.message : "Failed to save review policy" }, { status: 500 });
  }
}
