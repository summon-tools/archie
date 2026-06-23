import { logger } from "./logger";
import { streamConversationMessage } from "./conversation";
import * as dal from "./dal";
import type { AppRow, RunRow } from "./types";

const _g = globalThis as typeof globalThis & {
  __backgroundConversationRuns?: Set<number>;
};

const runningConversationRuns: Set<number> = _g.__backgroundConversationRuns ??= new Set();

export async function drainConversationStream(stream: ReadableStream<Uint8Array>): Promise<void> {
  const reader = stream.getReader();
  try {
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
}

function startConversationDrain(runId: number, stream: ReadableStream<Uint8Array>): void {
  if (runningConversationRuns.has(runId)) return;
  runningConversationRuns.add(runId);

  setTimeout(() => {
    drainConversationStream(stream)
      .catch((error) => {
        logger.error({ err: error, runId }, "background conversation run failed while draining");
      })
      .finally(() => {
        runningConversationRuns.delete(runId);
      });
  }, 0);
}

export async function waitForRunStatus(runId: number, waitSeconds: number): Promise<RunRow | undefined> {
  const deadline = Date.now() + Math.min(Math.max(waitSeconds, 0), 30) * 1000;
  let run = dal.getRun(runId);
  while (run?.status === "running" && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    run = dal.getRun(runId);
  }
  return run;
}

export async function startBackgroundConversationRun(params: {
  conversationId: number;
  content: string;
  app: AppRow;
  userId: number | null;
  provider?: string;
  model?: string;
  waitSeconds?: number;
}): Promise<RunRow> {
  const stream = await streamConversationMessage(
    params.conversationId,
    params.content,
    params.app.name,
    params.app.directory,
    params.model,
    params.userId ?? undefined,
    false,
    params.provider,
  );
  const run = dal.getLatestRunForConversation(params.conversationId);
  if (!run) {
    startConversationDrain(-Date.now(), stream);
    throw new Error("Task could not start; no run was created");
  }

  startConversationDrain(run.id, stream);
  if (params.waitSeconds && params.waitSeconds > 0) {
    await waitForRunStatus(run.id, params.waitSeconds);
  }
  return dal.getRun(run.id) ?? run;
}
