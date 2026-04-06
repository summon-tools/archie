import { NextRequest, NextResponse } from "next/server";
import * as dal from "@/lib/server/dal";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import {
  readSpecProposals,
  applySpecProposal,
  removeSpecProposal,
} from "@/lib/server/spec";

/**
 * GET: Return pending spec proposals.
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

    const proposals = readSpecProposals(app.directory);
    return NextResponse.json({ proposals });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ detail: e.message }, { status: 401 });
    throw e;
  }
}

/**
 * POST: Accept or reject a spec proposal.
 * Body: { proposal_id: string, action: "accept" | "reject" }
 *   or  { action: "accept_all" | "reject_all" }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string }> }
) {
  try {
    await getAuthUser(request);
    const { appId } = await params;
    const body = await request.json();
    const { proposal_id, action } = body;

    const app = dal.getApp(Number(appId));
    if (!app) return NextResponse.json({ detail: "App not found" }, { status: 404 });
    if (!app.directory) return NextResponse.json({ detail: "App has no directory" }, { status: 400 });

    if (action === "accept_all") {
      const proposals = readSpecProposals(app.directory);
      for (const proposal of proposals) {
        applySpecProposal(app.directory, proposal);
        removeSpecProposal(app.directory, proposal.id);
      }
      return NextResponse.json({ message: `Applied ${proposals.length} proposals` });
    }

    if (action === "reject_all") {
      const proposals = readSpecProposals(app.directory);
      for (const proposal of proposals) {
        removeSpecProposal(app.directory, proposal.id);
      }
      return NextResponse.json({ message: `Rejected ${proposals.length} proposals` });
    }

    if (!proposal_id) {
      return NextResponse.json({ detail: "proposal_id is required" }, { status: 400 });
    }

    if (action === "accept") {
      const proposals = readSpecProposals(app.directory);
      const proposal = proposals.find((p) => p.id === proposal_id);
      if (!proposal) {
        return NextResponse.json({ detail: "Proposal not found" }, { status: 404 });
      }
      applySpecProposal(app.directory, proposal);
      removeSpecProposal(app.directory, proposal_id);
      return NextResponse.json({ message: "Proposal applied" });
    }

    if (action === "reject") {
      removeSpecProposal(app.directory, proposal_id);
      return NextResponse.json({ message: "Proposal rejected" });
    }

    return NextResponse.json({ detail: "Invalid action" }, { status: 400 });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ detail: e.message }, { status: 401 });
    throw e;
  }
}
