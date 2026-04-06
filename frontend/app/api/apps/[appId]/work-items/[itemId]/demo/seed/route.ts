import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import * as dal from "@/lib/server/dal";
import { generateDemoSeedScript, executeSeedScript } from "@/lib/server/demo";
import { detectTechStack } from "@/lib/server/techstack";
import { stopPreview, startPreview, resetWorktreeDatabase } from "@/lib/server/worktrees";
import { routeLogger } from "@/lib/server/logger";

const log = routeLogger("demo/seed");

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
    if (!env?.worktree_dir) {
      return NextResponse.json(
        { detail: "No worktree available. Work item must have a worktree to generate seed data." },
        { status: 400 }
      );
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
          const techStack = detectTechStack(env.worktree_dir!);

          if (techStack.database === "none") {
            send("error", { error: "No database detected -- seed generation not needed for frontend-only apps." });
            // Store seed status as artifact metadata
            dal.deleteArtifactsByKind(wi.id, "demo_seed");
            dal.createArtifact({
              app_id: Number(appId),
              work_item_id: wi.id,
              kind: "demo_seed",
              storage_type: "inline",
              metadata_json: JSON.stringify({ status: "failed" }),
            });
            return;
          }

          const abort = new AbortController();

          // Mark seed as generating
          dal.deleteArtifactsByKind(wi.id, "demo_seed");
          dal.createArtifact({
            app_id: Number(appId),
            work_item_id: wi.id,
            kind: "demo_seed",
            storage_type: "inline",
            metadata_json: JSON.stringify({ status: "generating" }),
          });

          // Build a task-like object for generateDemoSeedScript
          const taskLike = {
            id: wi.id,
            title: wi.title,
            description: wi.summary || "",
            worktree_dir: env.worktree_dir,
          } as any;

          const seedGen = generateDemoSeedScript(
            taskLike, app, techStack, abort.signal, customInstruction
          );

          let seedScript: string | undefined;
          let personas: { name: string; email?: string; username?: string; password?: string }[] = [];
          let seedOutput: string | undefined;

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
              seedScript = event.script;
              personas = event.personas || [];
              seedOutput = event.seedOutput;

              // Save seed artifact
              dal.deleteArtifactsByKind(wi.id, "demo_seed");
              dal.createArtifact({
                app_id: Number(appId),
                work_item_id: wi.id,
                kind: "demo_seed",
                storage_type: "inline",
                inline_text: seedScript,
                metadata_json: JSON.stringify({ status: "completed", output: seedOutput }),
              });

              // Save personas artifact
              dal.deleteArtifactsByKind(wi.id, "demo_personas");
              if (personas.length > 0) {
                dal.createArtifact({
                  app_id: Number(appId),
                  work_item_id: wi.id,
                  kind: "demo_personas",
                  storage_type: "inline",
                  inline_text: JSON.stringify(personas),
                });
              }

              send("seed_result", {
                script: seedScript,
                personas,
                seedOutput,
              });
            } else if (event.type === "error") {
              dal.deleteArtifactsByKind(wi.id, "demo_seed");
              dal.createArtifact({
                app_id: Number(appId),
                work_item_id: wi.id,
                kind: "demo_seed",
                storage_type: "inline",
                inline_text: event.script || null,
                metadata_json: JSON.stringify({ status: "failed", output: event.seedOutput || null }),
              });
              if (event.personas && event.personas.length > 0) {
                dal.deleteArtifactsByKind(wi.id, "demo_personas");
                dal.createArtifact({
                  app_id: Number(appId),
                  work_item_id: wi.id,
                  kind: "demo_personas",
                  storage_type: "inline",
                  inline_text: JSON.stringify(event.personas),
                });
              }
              send("error", { error: event.message, script: event.script, personas: event.personas, seedOutput: event.seedOutput });
            }
          }

          // --- Reset DB + re-seed so the preview sees the fresh seeded state ---
          if (seedScript && env.preview_port && env.preview_pid) {
            send("progress", { step: "db_reset", message: "Resetting database..." });

            stopPreview(env.preview_pid, env.worktree_dir!, env.preview_port, { appId: Number(appId), workItemId: wi.id });

            const resetResult = resetWorktreeDatabase(env.worktree_dir!, app.directory, techStack);
            if (!resetResult.success) {
              dal.deleteArtifactsByKind(wi.id, "demo_seed");
              dal.createArtifact({
                app_id: Number(appId),
                work_item_id: wi.id,
                kind: "demo_seed",
                storage_type: "inline",
                inline_text: seedScript,
                metadata_json: JSON.stringify({ status: "failed" }),
              });
              send("error", { error: `DB reset failed: ${resetResult.message}` });
              return;
            }

            send("progress", { step: "db_seed", message: "Seeding database..." });
            const seedResult = executeSeedScript(env.worktree_dir!, seedScript, techStack);
            if (!seedResult.success) {
              dal.deleteArtifactsByKind(wi.id, "demo_seed");
              dal.createArtifact({
                app_id: Number(appId),
                work_item_id: wi.id,
                kind: "demo_seed",
                storage_type: "inline",
                inline_text: seedScript,
                metadata_json: JSON.stringify({ status: "failed" }),
              });
              send("error", { error: `Seed execution failed: ${seedResult.output}` });
              return;
            }

            send("progress", { step: "preview_restart", message: "Restarting preview server..." });
            const previewResult = await startPreview(env.worktree_dir!, env.preview_port, techStack, { appId: Number(appId), workItemId: wi.id });
            if (!previewResult.success) {
              dal.deleteArtifactsByKind(wi.id, "demo_seed");
              dal.createArtifact({
                app_id: Number(appId),
                work_item_id: wi.id,
                kind: "demo_seed",
                storage_type: "inline",
                inline_text: seedScript,
                metadata_json: JSON.stringify({ status: "failed" }),
              });
              send("error", { error: `Preview restart failed: ${previewResult.message}` });
              return;
            }

            if (previewResult.pid) {
              dal.updateWorkItemEnv(wi.id, { preview_pid: previewResult.pid });
            }
          }

          send("done", {});
        } catch (e: any) {
          log.error({ err: e }, "seed generation failed");
          try {
            dal.deleteArtifactsByKind(wi.id, "demo_seed");
            dal.createArtifact({
              app_id: Number(appId),
              work_item_id: wi.id,
              kind: "demo_seed",
              storage_type: "inline",
              metadata_json: JSON.stringify({ status: "failed" }),
            });
          } catch {}
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
