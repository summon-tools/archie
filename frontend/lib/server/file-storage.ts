import crypto from "crypto";
import fs from "fs";
import path from "path";
import { UPLOADS_DIR } from "./config";
import * as dal from "./dal";
import type { AppFileRow } from "./types";

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const MAX_CONTEXT_MATERIALIZED_BYTES = 100 * 1024 * 1024;

const BLOCKED_EXTENSIONS = new Set([
  ".app", ".bat", ".bin", ".cmd", ".com", ".dmg", ".exe", ".msi", ".pkg", ".scr",
  ".7z", ".bz2", ".gz", ".rar", ".tar", ".tgz", ".xz", ".zip",
  ".bash", ".cgi", ".command", ".csh", ".dll", ".dylib", ".env", ".fish", ".hta",
  ".jar", ".ksh", ".lua", ".php", ".pl", ".ps1", ".psm1", ".py", ".pyw", ".r",
  ".rb", ".run", ".sh", ".so", ".vbe", ".vbs", ".wsf", ".wsh", ".zsh",
]);

const ALLOWED_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp",
  ".pdf",
  ".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".jsonl", ".yaml", ".yml",
  ".xml", ".html", ".css", ".scss", ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs",
  ".go", ".rs", ".java", ".kt", ".swift", ".c", ".cpp", ".h", ".hpp",
  ".cs", ".sql", ".toml", ".ini", ".sample",
  ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx",
]);

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/json",
  "application/xml",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/csv",
  "text/html",
  "text/markdown",
  "text/plain",
  "text/tab-separated-values",
  "text/xml",
]);

const TEXT_EXTENSIONS = new Set([
  ".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".jsonl", ".yaml", ".yml",
  ".xml", ".html", ".css", ".scss", ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs",
  ".go", ".rs", ".java", ".kt", ".swift", ".c", ".cpp", ".h", ".hpp", ".cs",
  ".sql", ".toml", ".ini", ".sample",
]);

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);
const OFFICE_EXTENSIONS = new Set([".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx"]);
const ZIP_BASED_OFFICE_EXTENSIONS = new Set([".docx", ".pptx", ".xlsx"]);
const CFB_OFFICE_EXTENSIONS = new Set([".doc", ".ppt", ".xls"]);
const DANGEROUS_DOWNLOAD_MIME_TYPES = new Set([
  "application/ecmascript",
  "application/javascript",
  "application/xhtml+xml",
  "image/svg+xml",
  "text/html",
  "text/javascript",
]);

export class FileStorageError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "FileStorageError";
  }
}

export function sanitizeFilename(filename: string): string {
  const basename = path.basename(filename || "attachment");
  const sanitized = basename
    .normalize("NFKD")
    .replace(/[^\w.\- ]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 160)
    .replace(/^\.+/, "")
    .trim();
  return sanitized || "attachment";
}

function extensionFor(filename: string): string {
  const basename = path.basename(filename || "").toLowerCase();
  if (basename === ".env" || basename.endsWith(".env")) return ".env";
  return path.extname(basename);
}

function normalizeContentType(contentType: string): string {
  return (contentType || "application/octet-stream").toLowerCase().split(";")[0].trim();
}

function startsWith(buffer: Buffer, bytes: number[]): boolean {
  if (buffer.length < bytes.length) return false;
  return bytes.every((byte, index) => buffer[index] === byte);
}

function isZip(buffer: Buffer): boolean {
  return startsWith(buffer, [0x50, 0x4b, 0x03, 0x04]) ||
    startsWith(buffer, [0x50, 0x4b, 0x05, 0x06]) ||
    startsWith(buffer, [0x50, 0x4b, 0x07, 0x08]);
}

function isCompoundFileBinary(buffer: Buffer): boolean {
  return startsWith(buffer, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
}

function imageMagicMatches(ext: string, buffer: Buffer): boolean {
  if (ext === ".png") return startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (ext === ".jpg" || ext === ".jpeg") return startsWith(buffer, [0xff, 0xd8, 0xff]);
  if (ext === ".gif") return buffer.subarray(0, 6).toString("ascii") === "GIF87a" || buffer.subarray(0, 6).toString("ascii") === "GIF89a";
  if (ext === ".webp") return buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP";
  return false;
}

function imageExtensionForContentType(contentType: string): string | null {
  if (contentType === "image/png") return ".png";
  if (contentType === "image/jpeg") return ".jpg";
  if (contentType === "image/gif") return ".gif";
  if (contentType === "image/webp") return ".webp";
  return null;
}

function isProbablyText(buffer: Buffer): boolean {
  if (buffer.includes(0)) return false;
  for (const byte of buffer) {
    if (byte < 0x09) return false;
    if (byte > 0x0d && byte < 0x20) return false;
  }
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return true;
  } catch {
    return false;
  }
}

export function safeDownloadContentType(contentType: string): string {
  const normalized = normalizeContentType(contentType);
  if (DANGEROUS_DOWNLOAD_MIME_TYPES.has(normalized)) return "application/octet-stream";
  return normalized || "application/octet-stream";
}

export function assertAllowedUpload(input: { filename: string; contentType: string; size: number; buffer: Buffer }): void {
  if (input.size <= 0) throw new FileStorageError("File is empty");
  if (input.size > MAX_UPLOAD_BYTES) throw new FileStorageError("File is too large");

  const ext = extensionFor(input.filename);
  if (BLOCKED_EXTENSIONS.has(ext)) {
    throw new FileStorageError("File type is not allowed");
  }

  const contentType = normalizeContentType(input.contentType);
  const allowedByExtension = ALLOWED_EXTENSIONS.has(ext);
  const allowedByMime = ALLOWED_MIME_TYPES.has(contentType) || (!ext && contentType.startsWith("text/"));
  if (!allowedByExtension && !allowedByMime) {
    throw new FileStorageError("File type is not supported");
  }

  if (IMAGE_EXTENSIONS.has(ext) || contentType.startsWith("image/")) {
    const expectedExt = IMAGE_EXTENSIONS.has(ext) ? ext : imageExtensionForContentType(contentType);
    if (!expectedExt || !imageMagicMatches(expectedExt, input.buffer)) {
      throw new FileStorageError("File content does not match its declared type");
    }
    return;
  }

  if (ext === ".pdf" || contentType === "application/pdf") {
    if (!input.buffer.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
      throw new FileStorageError("File content does not match its declared type");
    }
    return;
  }

  if (OFFICE_EXTENSIONS.has(ext)) {
    if (ZIP_BASED_OFFICE_EXTENSIONS.has(ext) && !isZip(input.buffer)) {
      throw new FileStorageError("File content does not match its declared type");
    }
    if (CFB_OFFICE_EXTENSIONS.has(ext) && !isCompoundFileBinary(input.buffer)) {
      throw new FileStorageError("File content does not match its declared type");
    }
    return;
  }

  if (TEXT_EXTENSIONS.has(ext) || contentType.startsWith("text/") || contentType.includes("json") || contentType.includes("xml")) {
    if (!isProbablyText(input.buffer)) {
      throw new FileStorageError("File content does not match its declared type");
    }
    return;
  }

  throw new FileStorageError("File type is not supported");
}

export function serializeAppFile(file: AppFileRow) {
  return {
    id: file.id,
    app_id: file.app_id,
    original_name: file.original_name,
    content_type: file.content_type,
    size_bytes: file.size_bytes,
    sha256: file.sha256,
    status: file.status,
    metadata_json: file.metadata_json,
    created_at: file.created_at,
    deleted_at: file.deleted_at,
    download_url: `/api/apps/${file.app_id}/files/${file.id}/download`,
  };
}

export async function storeUploadedFile(params: {
  appId: number;
  userId: number | null;
  file: File;
}): Promise<AppFileRow> {
  const rawName = params.file.name || "attachment";
  const originalName = sanitizeFilename(rawName);
  const contentType = normalizeContentType(params.file.type || "application/octet-stream");
  const buffer = Buffer.from(await params.file.arrayBuffer());
  assertAllowedUpload({ filename: rawName, contentType, size: buffer.length, buffer });

  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  const record = dal.createAppFile({
    app_id: params.appId,
    uploaded_by_user_id: params.userId,
    original_name: originalName,
    stored_name: "__pending__",
    content_type: contentType,
    size_bytes: buffer.length,
    sha256,
    storage_path: "__pending__",
    status: "uploading",
    metadata_json: JSON.stringify({ source: "upload" }),
  });

  const fileDir = path.join(UPLOADS_DIR, "apps", String(params.appId), String(record.id));
  const storedName = `file-${record.id}`;
  const storagePath = path.join(fileDir, storedName);
  try {
    fs.mkdirSync(fileDir, { recursive: true });
    fs.writeFileSync(storagePath, buffer, { mode: 0o600 });
    return dal.updateAppFileStoragePath(params.appId, record.id, { stored_name: storedName, storage_path: storagePath });
  } catch (error) {
    try { dal.markAppFileDeleted(params.appId, record.id); } catch {}
    try { fs.rmSync(fileDir, { recursive: true, force: true }); } catch {}
    throw error;
  }
}

export function deleteStoredFile(file: AppFileRow): void {
  if (file.storage_path && file.storage_path !== "__pending__") {
    try { fs.unlinkSync(file.storage_path); } catch {}
    try {
      const dir = path.dirname(file.storage_path);
      if (dir.includes(path.join("uploads", "apps"))) {
        fs.rmdirSync(dir);
      }
    } catch {}
  }
}

export function deleteAppUploadDirectory(appId: number): void {
  try {
    fs.rmSync(path.join(UPLOADS_DIR, "apps", String(appId)), { recursive: true, force: true });
  } catch {}
}

export function cleanupMaterializedFilesForContext(params: {
  appId: number;
  targetDirectory: string;
}): void {
  if (!params.targetDirectory) return;
  try {
    fs.rmSync(path.join(params.targetDirectory, ".archie", "context-files", `app-${params.appId}`), {
      recursive: true,
      force: true,
    });
  } catch {}
}

export function materializeFilesForContext(params: {
  appId: number;
  targetDirectory: string;
  files: AppFileRow[];
}): Array<{ file: AppFileRow; contextPath: string | null }> {
  if (!params.targetDirectory) {
    return params.files.map((file) => ({ file, contextPath: null }));
  }

  const contextDir = path.join(params.targetDirectory, ".archie", "context-files", `app-${params.appId}`);
  try {
    fs.mkdirSync(contextDir, { recursive: true });
  } catch {
    return params.files.map((file) => ({ file, contextPath: null }));
  }

  let materializedBytes = 0;
  return params.files.map((file) => {
    if (file.status !== "available" || !file.storage_path || file.storage_path === "__pending__") {
      return { file, contextPath: null };
    }
    if (materializedBytes + file.size_bytes > MAX_CONTEXT_MATERIALIZED_BYTES) {
      return { file, contextPath: null };
    }
    const targetPath = path.join(contextDir, `file-${file.id}`);
    try {
      fs.copyFileSync(file.storage_path, targetPath);
      try { fs.chmodSync(targetPath, 0o600); } catch {}
      materializedBytes += file.size_bytes;
      return { file, contextPath: targetPath };
    } catch {
      return { file, contextPath: null };
    }
  });
}

export function formatAttachmentContext(files: Array<{ file: AppFileRow; contextPath: string | null }>): string {
  if (files.length === 0) return "";
  return [
    "Attached files:",
    ...files.map(({ file, contextPath }) => [
      `- ${file.original_name}`,
      `  id: ${file.id}`,
      `  type: ${file.content_type}`,
      `  size: ${file.size_bytes} bytes`,
      `  sha256: ${file.sha256}`,
      `  readable_path: ${contextPath || "unavailable"}`,
    ].join("\n")),
    "",
    "Attached files are available as context. Use them only when relevant to the current request or plan step; do not inspect every file by default. Do not claim visual or file details unless you actually inspect the file.",
  ].join("\n");
}
