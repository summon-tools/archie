import { NextRequest, NextResponse } from "next/server";
import * as dal from "@/lib/server/dal";
import { deleteStoredFile, serializeAppFile } from "@/lib/server/file-storage";
import { handleRouteError, parseRouteId, requireAppAccess, RouteInputError } from "@/lib/server/route-utils";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; fileId: string }> },
) {
  try {
    const { appId, fileId } = await params;
    const { app } = await requireAppAccess(request, appId);
    const parsedFileId = parseRouteId(fileId, "fileId");
    const file = dal.getAppFile(app.id, parsedFileId);
    if (!file) throw new RouteInputError("File not found", 404);

    const deleted = dal.markAppFileDeleted(app.id, parsedFileId);
    deleteStoredFile(file);
    return NextResponse.json({ file: serializeAppFile(deleted) });
  } catch (error) {
    const errorResponse = handleRouteError(error);
    if (errorResponse) return errorResponse;
    throw error;
  }
}
