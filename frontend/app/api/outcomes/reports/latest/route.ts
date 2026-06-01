import { NextRequest, NextResponse } from "next/server";
import { AuthError, getAuthUser } from "@/lib/server/auth";
import * as dal from "@/lib/server/dal";
import { serializeOutcomeLearningReport } from "@/lib/server/outcome-reports";

export async function GET(request: NextRequest) {
  try {
    await getAuthUser(request);
    return NextResponse.json({
      report: serializeOutcomeLearningReport(dal.getLatestLlmOutcomeReport()),
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ detail: error.message }, { status: 401 });
    }
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : "Failed to load latest outcome learning report" },
      { status: 500 },
    );
  }
}
