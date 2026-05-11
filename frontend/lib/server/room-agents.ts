import { DEFAULT_HOME_AGENTS, getHomeAgent } from "@/lib/home/agents";
import { getProvider } from "@/lib/server/agent";
import * as dal from "./dal";
import type { AppRow, HomeRoomRow, RoomMessageRow } from "./types";

function buildCoordinatorPrompt({
  app,
  room,
  userMessage,
}: {
  app: AppRow;
  room: HomeRoomRow;
  userMessage: string;
}): string {
  const plan = dal.getPlansByRoom(room.id)[0] || null;
  const steps = plan ? dal.getPlanSteps(plan.id) : [];
  const recentMessages = dal.getRoomMessages(room.id, 12);

  return [
    "You are the Coordinator agent inside an Archie planning room for software work.",
    "",
    "Your job:",
    "- Answer the user's planning questions directly.",
    "- Clarify scope, risks, sequencing, and acceptance criteria.",
    "- Route concerns to the fixed agent team when useful.",
    "- Do not claim that implementation has started unless a plan step has been executed.",
    "- Keep replies concise and practical.",
    "",
    "Agent team:",
    ...DEFAULT_HOME_AGENTS.map((agent) => `- ${agent.name}: ${agent.role}`),
    "",
    `App: ${app.name}`,
    `Room: ${room.title}`,
    room.purpose ? `Room purpose: ${room.purpose}` : null,
    plan ? `Current plan: ${plan.title} (${plan.status})` : "Current plan: none yet",
    steps.length > 0 ? "Plan steps:" : null,
    ...steps.map((step) => `- ${step.position + 1}. ${step.title} (${step.status})`),
    "",
    "Recent room messages:",
    ...recentMessages.map((message) => {
      const speaker = message.role === "user"
        ? "User"
        : message.agent_key
          ? message.agent_key
          : message.role;
      return `${speaker}: ${message.body_md}`;
    }),
    "",
    "Latest user message:",
    userMessage,
    "",
    "Respond as Coordinator.",
  ].filter((line): line is string => line !== null).join("\n");
}

export async function createCoordinatorRoomReply({
  app,
  room,
  userMessage,
}: {
  app: AppRow;
  room: HomeRoomRow;
  userMessage: RoomMessageRow;
}): Promise<RoomMessageRow> {
  const coordinator = getHomeAgent("coordinator");
  const prompt = buildCoordinatorPrompt({
    app,
    room,
    userMessage: userMessage.body_md,
  });

  const run = dal.createRoomAgentRun({
    room_id: room.id,
    agent_key: coordinator.key,
    provider_id: coordinator.defaultProvider,
    model_id: coordinator.defaultModel,
    phase: "planning",
    tool_policy_json: JSON.stringify({ mode: "planning_chat", tools: "none" }),
    input_json: JSON.stringify({ prompt }),
  });

  try {
    const provider = getProvider(coordinator.defaultProvider);
    const text = (await provider.ephemeralQuery(prompt, {
      model: coordinator.defaultModel,
      maxTurns: 1,
      cwd: app.directory,
    })).trim();

    const replyText = text || "I am the Coordinator for this planning room. I can help clarify the work, shape the plan, and route concerns to the Architect, Reviewer, QA, or Security agents before implementation starts.";

    dal.updateRoomAgentRun(run.id, {
      status: "completed",
      result_json: JSON.stringify({ text: replyText }),
    });

    return dal.createRoomMessage({
      room_id: room.id,
      role: "agent",
      agent_key: coordinator.key,
      kind: "message",
      body_md: replyText,
      payload_json: JSON.stringify({
        run_id: run.id,
        provider_id: coordinator.defaultProvider,
        model_id: coordinator.defaultModel,
      }),
    });
  } catch (error) {
    const errorText = error instanceof Error ? error.message : "Unknown coordinator error";
    dal.updateRoomAgentRun(run.id, {
      status: "failed",
      error_text: errorText,
    });

    return dal.createRoomMessage({
      room_id: room.id,
      role: "agent",
      agent_key: coordinator.key,
      kind: "error",
      body_md: "I saved your message, but the Coordinator model could not respond. Try again in a moment.",
      payload_json: JSON.stringify({ run_id: run.id, error: errorText }),
    });
  }
}
