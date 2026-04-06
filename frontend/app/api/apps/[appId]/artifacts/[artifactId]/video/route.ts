import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import { getAuthUser, AuthError } from "@/lib/server/auth";
import * as dal from "@/lib/server/dal";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; artifactId: string }> }
) {
  try {
    await getAuthUser(request);
    const { appId, artifactId } = await params;

    const app = dal.getApp(Number(appId));
    if (!app) {
      return NextResponse.json({ detail: "App not found" }, { status: 404 });
    }

    const artifact = dal.getArtifact(Number(artifactId));
    if (!artifact || artifact.app_id !== Number(appId) || artifact.kind !== "demo_video") {
      return NextResponse.json({ detail: "Video artifact not found" }, { status: 404 });
    }

    const videoPath = artifact.file_path;
    if (!videoPath || !fs.existsSync(videoPath)) {
      return NextResponse.json({ detail: "Video file not found on disk" }, { status: 404 });
    }

    const stat = fs.statSync(videoPath);
    const fileSize = stat.size;
    const contentType = videoPath.endsWith(".mp4") ? "video/mp4" : "video/webm";
    const rangeHeader = request.headers.get("range");

    if (rangeHeader) {
      const parts = rangeHeader.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;

      const fileStream = fs.createReadStream(videoPath, { start, end });
      const readableStream = new ReadableStream({
        start(controller) {
          fileStream.on("data", (chunk) => controller.enqueue(chunk));
          fileStream.on("end", () => controller.close());
          fileStream.on("error", (err) => controller.error(err));
        },
      });

      return new Response(readableStream, {
        status: 206,
        headers: {
          "Content-Range": `bytes ${start}-${end}/${fileSize}`,
          "Accept-Ranges": "bytes",
          "Content-Length": String(chunkSize),
          "Content-Type": contentType,
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    }

    const fileBuffer = fs.readFileSync(videoPath);
    return new Response(fileBuffer, {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(fileSize),
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ detail: e.message }, { status: 401 });
    }
    throw e;
  }
}
