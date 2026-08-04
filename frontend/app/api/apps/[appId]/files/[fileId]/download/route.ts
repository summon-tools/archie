import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import * as dal from "@/lib/server/dal";
import { safeDownloadContentType } from "@/lib/server/file-storage";
import { handleRouteError, parseRouteId, requireAppAccess, RouteInputError } from "@/lib/server/route-utils";

function contentDisposition(filename: string): string {
  const safe = path.basename(filename).replace(/[\r\n"]/g, "'");
  return `attachment; filename="${safe}"`;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; fileId: string }> },
) {
  try {
    const { appId, fileId } = await params;
    const { app } = await requireAppAccess(request, appId);
    const parsedFileId = parseRouteId(fileId, "fileId");
    const file = dal.getAppFile(app.id, parsedFileId);
    if (!file || file.status !== "available") throw new RouteInputError("File not found", 404);
    if (!file.storage_path || file.storage_path === "__pending__" || !fs.existsSync(file.storage_path)) {
      throw new RouteInputError("File is unavailable", 404);
    }

    const buffer = fs.readFileSync(file.storage_path);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": safeDownloadContentType(file.content_type),
        "Content-Length": String(buffer.length),
        "Content-Disposition": contentDisposition(file.original_name),
        "Content-Security-Policy": "sandbox",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const errorResponse = handleRouteError(error);
    if (errorResponse) return errorResponse;
    throw error;
  }
}
