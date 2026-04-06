import { NextResponse } from "next/server";
import { COOKIE_NAME } from "@/lib/server/auth";

export async function POST() {
  const response = NextResponse.json({ message: "Logged out" });
  response.cookies.delete({ name: COOKIE_NAME, path: "/" });
  return response;
}
