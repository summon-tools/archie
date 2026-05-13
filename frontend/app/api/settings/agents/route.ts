import { NextRequest, NextResponse } from "next/server";
import * as dal from "@/lib/server/dal";
import { AuthError, ForbiddenError, getAuthUser, requireAdmin } from "@/lib/server/auth";
import { getAllModels } from "@/lib/server/agent";
import { getProviderForModel, isKnownHomeAgentKey, resolveHomeAgent, resolveHomeAgents } from "@/lib/server/home-agent-configs";
import { readJsonBody, RouteInputError } from "@/lib/server/room-route-utils";

function serializeAgents(includePrompts = true) {
  const agents = resolveHomeAgents().map((agent) => includePrompts ? agent : { ...agent, prompt: "" });
  return {
    agents,
    availableModels: getAllModels(),
  };
}

function handleError(error: unknown): NextResponse | null {
  if (error instanceof AuthError) {
    return NextResponse.json({ detail: error.message }, { status: 401 });
  }
  if (error instanceof ForbiddenError) {
    return NextResponse.json({ detail: error.message }, { status: 403 });
  }
  if (error instanceof RouteInputError) {
    return NextResponse.json({ detail: error.message }, { status: error.status });
  }
  return null;
}

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    return NextResponse.json(serializeAgents(user.role === "admin"));
  } catch (error) {
    const errorResponse = handleError(error);
    if (errorResponse) return errorResponse;
    throw error;
  }
}

export async function PUT(request: NextRequest) {
  try {
    await requireAdmin(request);

    const body = await readJsonBody(request);
    const agentKey = typeof body.agent_key === "string" ? body.agent_key : "";
    if (!isKnownHomeAgentKey(agentKey)) {
      throw new RouteInputError("Unknown agent key");
    }

    const role = typeof body.role === "string" ? body.role.trim() : "";
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    const modelId = typeof body.model_id === "string" ? body.model_id.trim() : "";
    if (!role) throw new RouteInputError("description is required");
    if (role.length > 2000) throw new RouteInputError("description is too long");
    if (!prompt) throw new RouteInputError("prompt is required");
    if (prompt.length > 12000) throw new RouteInputError("prompt is too long");

    const providerId = getProviderForModel(modelId);
    if (!providerId) {
      throw new RouteInputError("Unknown model");
    }

    dal.upsertHomeAgentConfig(agentKey, {
      role,
      prompt,
      provider_id: providerId,
      model_id: modelId,
    });

    return NextResponse.json({
      agent: resolveHomeAgent(agentKey),
      ...serializeAgents(true),
    });
  } catch (error) {
    const errorResponse = handleError(error);
    if (errorResponse) return errorResponse;
    throw error;
  }
}
