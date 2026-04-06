import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import * as dal from "@/lib/server/dal";
import { generateDemoSeedScript } from "@/lib/server/demo";
import { detectTechStack } from "@/lib/server/techstack";
import { routeLogger } from "@/lib/server/logger";

const log = routeLogger("seed");

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string }> }
) {
  try {
    await getAuthUser(request);
    const { appId } = await params;

    const app = dal.getApp(Number(appId));
    if (!app) {
      return NextResponse.json({ detail: "App not found" }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const customInstruction = typeof body.customInstruction === "string" ? body.customInstruction : undefined;

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
          const techStack = detectTechStack(app.directory);

          if (techStack.database === "none") {
            send("error", { error: "No database detected — seed generation not needed for frontend-only apps." });
            return;
          }

          const abort = new AbortController();

          const fakeTask = {
            worktree_dir: app.directory,
            title: app.name,
            description: app.description || "",
          } as any;

          const seedGen = generateDemoSeedScript(
            fakeTask, app as any, techStack, abort.signal, customInstruction
          );

          for await (const event of seedGen) {
            if (event.type === "activity" && event.activity) {
              send("activity", {
                tool: event.activity.tool || undefined,
                type: event.activity.type,
                detail: event.activity.detail,
              });
            } else if (event.type === "progress") {
              send("progress", {
                step: event.step,
                message: event.message,
                attempt: event.attempt,
                maxAttempts: event.maxAttempts,
              });
            } else if (event.type === "seed_result") {
              const seedScript = event.script;
              if (seedScript) {
                dal.setAppToolConfig(app.id, "seed", JSON.stringify({ script: seedScript }));
              }
              send("seed_result", {
                script: seedScript,
                personas: event.personas,
                seedOutput: event.seedOutput,
              });
            } else if (event.type === "error") {
              if (event.script) {
                dal.setAppToolConfig(app.id, "seed", JSON.stringify({ script: event.script }));
              }
              send("error", {
                error: event.message,
                script: event.script,
                personas: event.personas,
                seedOutput: event.seedOutput,
              });
            }
          }

          send("done", {});
        } catch (e: any) {
          log.error({ err: e }, "seed generation failed");
          try { send("error", { error: e.message || "Seed generation failed" }); } catch {}
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
