import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/auth";
import * as dal from "@/lib/server/dal";
import { handleRouteError, RouteInputError } from "@/lib/server/route-utils";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin(request);
    const { id } = await params;
    const tokenId = Number(id);
    if (!Number.isInteger(tokenId) || tokenId <= 0) {
      throw new RouteInputError("Invalid token id");
    }
    const token = dal.getMcpTokenById(tokenId);
    if (!token) {
      return NextResponse.json({ detail: "MCP token not found" }, { status: 404 });
    }

    const hardDelete = request.nextUrl.searchParams.get("hard") === "1";
    if (hardDelete) {
      dal.deleteMcpToken(tokenId);
      return NextResponse.json({ success: true, deleted: true });
    }

    dal.revokeMcpToken(tokenId);
    return NextResponse.json({ success: true, revoked: true });
  } catch (error) {
    const errorResponse = handleRouteError(error);
    if (errorResponse) return errorResponse;
    throw error;
  }
}
