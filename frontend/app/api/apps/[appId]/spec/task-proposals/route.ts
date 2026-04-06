import { NextRequest, NextResponse } from "next/server";
import * as dal from "@/lib/server/dal";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import { readTaskProposals, removeTaskProposal } from "@/lib/server/spec";

/**
 * GET: Return pending task proposals.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string }> }
) {
  try {
    await getAuthUser(request);
    const { appId } = await params;
    const app = dal.getApp(Number(appId));
    if (!app) return NextResponse.json({ detail: "App not found" }, { status: 404 });
    if (!app.directory) return NextResponse.json({ detail: "App has no directory" }, { status: 400 });

    const proposals = readTaskProposals(app.directory);
    return NextResponse.json({ proposals });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ detail: e.message }, { status: 401 });
    throw e;
  }
}

/**
 * POST: Accept or reject a task proposal.
 * Body: { proposal_id: string, action: "accept" | "reject" }
 *   or  { action: "accept_all" | "reject_all" }
 *
 * Accept creates a real task in the database.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string }> }
) {
  try {
    const user = await getAuthUser(request);
    const { appId } = await params;
    const body = await request.json();
    const { proposal_id, action } = body;

    const app = dal.getApp(Number(appId));
    if (!app) return NextResponse.json({ detail: "App not found" }, { status: 404 });
    if (!app.directory) return NextResponse.json({ detail: "App has no directory" }, { status: 400 });

    const numericAppId = Number(appId);

    if (action === "accept_all") {
      const proposals = readTaskProposals(app.directory);
      for (const p of proposals) {
        createTask(numericAppId, p.title, p.description, user.id);
        removeTaskProposal(app.directory, p.id);
      }
      return NextResponse.json({ message: `Created ${proposals.length} tasks` });
    }

    if (action === "reject_all") {
      const proposals = readTaskProposals(app.directory);
      for (const p of proposals) {
        removeTaskProposal(app.directory, p.id);
      }
      return NextResponse.json({ message: `Rejected ${proposals.length} proposals` });
    }

    if (!proposal_id) {
      return NextResponse.json({ detail: "proposal_id is required" }, { status: 400 });
    }

    const proposals = readTaskProposals(app.directory);
    const proposal = proposals.find((p) => p.id === proposal_id);

    if (action === "accept") {
      if (!proposal) return NextResponse.json({ detail: "Proposal not found" }, { status: 404 });
      createTask(numericAppId, proposal.title, proposal.description, user.id);
      removeTaskProposal(app.directory, proposal_id);
      return NextResponse.json({ message: "Task created" });
    }

    if (action === "reject") {
      removeTaskProposal(app.directory, proposal_id);
      return NextResponse.json({ message: "Proposal rejected" });
    }

    return NextResponse.json({ detail: "Invalid action" }, { status: 400 });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ detail: e.message }, { status: 401 });
    throw e;
  }
}

function createTask(appId: number, title: string, description: string, userId: number) {
  const conversation = dal.createConversation({ app_id: appId, kind: "task", title, created_by: userId });
  dal.createWorkItem({ app_id: appId, primary_conversation_id: conversation.id, title, summary: description, created_by: userId });
}
