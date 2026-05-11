import { DEFAULT_HOME_AGENTS, getHomeAgent, type HomeAgentDefinition } from "@/lib/home/agents";
import { getProvider, type AgentProvider, type ToolStreamEvent } from "@/lib/server/agent";
import * as dal from "./dal";
import type { AppRow, HomeRoomRow, RoomMessageRow } from "./types";

function buildRoomAgentPrompt({
  app,
  room,
  userMessage,
  agent,
}: {
  app: AppRow;
  room: HomeRoomRow;
  userMessage: RoomMessageRow;
  agent: HomeAgentDefinition;
}): string {
  const plan = dal.getPlansByRoom(room.id)[0] || null;
  const steps = plan ? dal.getPlanSteps(plan.id) : [];
  const recentMessages = dal.getRoomMessages(room.id, 12);
  const isCoordinator = agent.key === "coordinator";

  return [
    `You are the ${agent.name} agent inside an Archie planning room for software work.`,
    `Your role: ${agent.role}`,
    "",
    "Your job:",
    isCoordinator
      ? "- Answer the user's planning questions directly."
      : "- Answer from your specialist perspective because the user tagged you for this reply.",
    isCoordinator
      ? "- Clarify scope, risks, sequencing, and acceptance criteria."
      : "- Surface the most important risks, tradeoffs, questions, and recommendations in your area.",
    isCoordinator ? "- Route concerns to the fixed agent team when useful." : null,
    "- Do not claim that implementation has started unless a plan step has been executed.",
    "- You may inspect the repository for context, but this is read-only planning chat.",
    "- Do not edit files, install dependencies, change git state, or create commits from this room reply.",
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
    userMessage.body_md,
    "",
    `Respond as ${agent.name}.`,
  ].filter((line): line is string => line !== null).join("\n");
}

function getTaggedAgent(message: RoomMessageRow): HomeAgentDefinition | null {
  if (!message.payload_json) return null;
  try {
    const payload = JSON.parse(message.payload_json) as { target_agent_key?: unknown };
    if (typeof payload.target_agent_key !== "string") return null;
    return DEFAULT_HOME_AGENTS.find((agent) => agent.key === payload.target_agent_key) || null;
  } catch {
    return null;
  }
}

function getReplyAgent(message: RoomMessageRow): HomeAgentDefinition {
  return getTaggedAgent(message) || getHomeAgent("coordinator");
}

async function runPlanningAgentQuery({
  provider,
  prompt,
  model,
  cwd,
}: {
  provider: AgentProvider;
  prompt: string;
  model: string;
  cwd: string;
}): Promise<{ text: string; events: ToolStreamEvent[] }> {
  const events: ToolStreamEvent[] = [];
  let text = "";

  for await (const event of provider.toolEnabledStream(prompt, {
    model,
    cwd,
    maxTurns: 6,
  })) {
    events.push(event);
    if (event.type === "result" && event.resultText) {
      text = event.resultText;
    }
    if (event.type === "error") {
      throw new Error(event.detail);
    }
  }

  return { text, events };
}

export async function createRoomAgentReply({
  app,
  room,
  userMessage,
}: {
  app: AppRow;
  room: HomeRoomRow;
  userMessage: RoomMessageRow;
}): Promise<RoomMessageRow> {
  const agent = getReplyAgent(userMessage);
  const prompt = buildRoomAgentPrompt({
    app,
    room,
    userMessage,
    agent,
  });

  const run = dal.createRoomAgentRun({
    room_id: room.id,
    agent_key: agent.key,
    provider_id: agent.defaultProvider,
    model_id: agent.defaultModel,
    phase: "planning",
    tool_policy_json: JSON.stringify({ mode: "planning_chat", tools: "read_only_codebase" }),
    input_json: JSON.stringify({ prompt }),
  });

  try {
    const provider = getProvider(agent.defaultProvider);
    const result = await runPlanningAgentQuery({
      provider,
      prompt,
      model: agent.defaultModel,
      cwd: app.directory,
    });
    const text = result.text.trim();

    const replyText = text || `I am the ${agent.name} for this planning room. I can help with ${agent.role.toLowerCase()}`;

    dal.updateRoomAgentRun(run.id, {
      status: "completed",
      result_json: JSON.stringify({ text: replyText, events: result.events }),
    });

    return dal.createRoomMessage({
      room_id: room.id,
      role: "agent",
      agent_key: agent.key,
      kind: "message",
      body_md: replyText,
      payload_json: JSON.stringify({
        run_id: run.id,
        provider_id: agent.defaultProvider,
        model_id: agent.defaultModel,
      }),
    });
  } catch (error) {
    const errorText = error instanceof Error ? error.message : `Unknown ${agent.name} error`;
    dal.updateRoomAgentRun(run.id, {
      status: "failed",
      error_text: errorText,
    });

    return dal.createRoomMessage({
      room_id: room.id,
      role: "agent",
      agent_key: agent.key,
      kind: "error",
      body_md: `I saved your message, but the ${agent.name} model could not respond. Try again in a moment.`,
      payload_json: JSON.stringify({ run_id: run.id, error: errorText }),
    });
  }
}
