import { NextRequest, NextResponse } from "next/server";
import * as dal from "@/lib/server/dal";
import { FileStorageError, serializeAppFile, storeUploadedFile } from "@/lib/server/file-storage";
import { handleRouteError, requireAppAccess, RouteInputError } from "@/lib/server/route-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string }> },
) {
  try {
    const { appId } = await params;
    const { app } = await requireAppAccess(request, appId);
    const includeDeleted = request.nextUrl.searchParams.get("include_deleted") === "true";
    return NextResponse.json({
      files: dal.listAppFiles(app.id, includeDeleted).map(serializeAppFile),
    });
  } catch (error) {
    const errorResponse = handleRouteError(error);
    if (errorResponse) return errorResponse;
    throw error;
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string }> },
) {
  try {
    const { appId } = await params;
    const { user, app } = await requireAppAccess(request, appId);
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      throw new RouteInputError("Request must be multipart/form-data");
    }
    const file = formData.get("file");
    if (!(file instanceof File)) {
      throw new RouteInputError("file is required");
    }

    const saved = await storeUploadedFile({
      appId: app.id,
      userId: user.id,
      file,
    });

    return NextResponse.json({ file: serializeAppFile(saved) }, { status: 201 });
  } catch (error) {
    if (error instanceof FileStorageError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    const errorResponse = handleRouteError(error);
    if (errorResponse) return errorResponse;
    throw error;
  }
}
