import { NextRequest, NextResponse } from "next/server";
import { isEffortLevel } from "@/lib/effort";
import { streamConversationMessage } from "@/lib/server/conversation";
import { handleRouteError, parseFileIds, readJsonBody, requireAvailableAppFiles, requireConversationAccess } from "@/lib/server/route-utils";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; conversationId: string }> }
) {
  try {
    const { appId, conversationId } = await params;
    const access = await requireConversationAccess(request, appId, conversationId);

    const body = await readJsonBody(request);
    const { content, model, provider, retry, effort } = body;
    const fileIds = parseFileIds(body.file_ids);

    if ((!content || typeof content !== "string") && fileIds.length === 0) {
      return NextResponse.json(
        { detail: "content is required" },
        { status: 400 }
      );
    }
    requireAvailableAppFiles(access.app.id, fileIds);

    const stream = await streamConversationMessage(
      access.conversation.id,
      typeof content === "string" ? content : "",
      access.app.name,
      access.app.directory,
      typeof model === "string" ? model : undefined,
      access.user.id,
      !!retry,
      typeof provider === "string" ? provider : undefined,
      fileIds,
      undefined,
      isEffortLevel(effort) ? effort : undefined,
    );

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (e) {
    const errorResponse = handleRouteError(e);
    if (errorResponse) return errorResponse;
    if (e instanceof Error && e.message.includes("already running")) {
      return NextResponse.json({ detail: e.message }, { status: 409 });
    }
    throw e;
  }
}
