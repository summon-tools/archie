import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    version: process.env.APP_VERSION || "unknown",
  });
}
