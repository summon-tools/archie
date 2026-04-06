import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import { runEphemeralQuery } from "@/lib/server/sdk-helpers";
import { toolDefinitions } from "@/tools/definitions";
import { buildIntentClassificationPrompt } from "@/lib/server/prompts/intent";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string }> }
) {
  try {
    await getAuthUser(request);
    await params;
    const { message } = await request.json();

    if (!message || typeof message !== "string") {
      return NextResponse.json({ detail: "message is required" }, { status: 400 });
    }

    // Build categories dynamically from tool definitions
    const categories = toolDefinitions
      .map((s) => `- ${s.id}: ${s.intentKeywords}`)
      .join("\n");

    const validIds = toolDefinitions.map((s) => s.id);

    const prompt = buildIntentClassificationPrompt({ message, categories });

    const result = await runEphemeralQuery(prompt, {
      category: "quick",
      maxTurns: 1,
    });

    const intent = result.trim().toLowerCase();

    return NextResponse.json({
      intent: validIds.includes(intent) ? intent : "code",
    });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ detail: e.message }, { status: 401 });
    }
    return NextResponse.json({ intent: "code" });
  }
}
