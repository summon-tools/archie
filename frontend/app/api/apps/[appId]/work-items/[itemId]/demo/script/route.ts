import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import * as dal from "@/lib/server/dal";
import { generateNavigationScript } from "@/lib/server/demo";
import { getConversationMessages } from "@/lib/server/conversation";
import { detectTechStack } from "@/lib/server/techstack";

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; itemId: string }> }
) {
  try {
    await getAuthUser(request);
    const { appId, itemId } = await params;

    const app = dal.getApp(Number(appId));
    if (!app) {
      return NextResponse.json({ detail: "App not found" }, { status: 404 });
    }

    const wi = dal.getWorkItem(Number(itemId));
    if (!wi || wi.app_id !== Number(appId)) {
      return NextResponse.json({ detail: "Work item not found" }, { status: 404 });
    }

    const env = dal.getWorkItemEnv(wi.id);
    if (!env?.preview_port || !env?.preview_pid) {
      return NextResponse.json(
        { detail: "No preview running. Start a preview first to record a demo." },
        { status: 400 }
      );
    }

    // Seed data is optional — the app may already have data from development.
    // If the demo looks empty, the user can generate seed data and retry.

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        let controllerOpen = true;
        const send = (event: string, data: unknown) => {
          if (!controllerOpen) return;
          try {
            controller.enqueue(encoder.encode(sseEvent(event, data)));
          } catch {
            controllerOpen = false;
          }
        };

        const keepalive = setInterval(() => {
          try { controller.enqueue(encoder.encode(": keepalive\n\n")); } catch {}
        }, 15_000);

        try {
          const previewUrl = `http://localhost:${env.preview_port}`;
          const reflectionMessages = wi.primary_conversation_id
            ? getConversationMessages(wi.primary_conversation_id)
            : [];
          const abort = new AbortController();

          // Load existing seed data
          const personasArt = dal.getArtifactByKind(wi.id, "demo_personas");
          let personas: { name: string; email?: string; username?: string; password?: string }[] = [];
          try {
            personas = personasArt?.inline_text ? JSON.parse(personasArt.inline_text) : [];
          } catch { personas = []; }

          send("progress", { step: "nav_script", message: "Generating navigation script..." });

          // Get conversation messages for context
          const conversationMessages = wi.primary_conversation_id
            ? dal.getConversationMessages(wi.primary_conversation_id)
            : [];

          const chatMessages = conversationMessages.length > 1
            ? conversationMessages
                .map((m: any) => `[${m.role}]: ${m.body_md}`)
                .join("\n\n")
                .slice(-6000)
            : undefined;

          const script = await generateNavigationScript(
            wi.title,
            wi.summary || "",
            previewUrl,
            abort.signal,
            {
              reflectionMessages,
              personas: personas.length > 0 ? personas : undefined,
              chatMessages,
              worktreeDir: env.worktree_dir || undefined,
            },
            (activity) => {
              send("activity", {
                tool: activity.tool || undefined,
                type: activity.type,
                detail: activity.detail,
              });
            }
          );

          // Save navigation script as artifact
          dal.deleteArtifactsByKind(wi.id, "demo_script");
          dal.createArtifact({
            app_id: Number(appId),
            work_item_id: wi.id,
            kind: "demo_script",
            storage_type: "inline",
            inline_text: script,
          });

          send("result", {
            script,
            personas: personas.length > 0 ? personas : undefined,
          });
          send("done", {});
        } catch (e: any) {
          send("error", { error: e.message || "Script generation failed" });
        } finally {
          clearInterval(keepalive);
          try { controller.close(); } catch {}
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ detail: e.message }, { status: 401 });
    }
    throw e;
  }
}
