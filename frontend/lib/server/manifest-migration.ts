import { readManifest, writeManifest, generateManifest } from "./manifest";
import { detectTechStack } from "./techstack";
import type { AppManifest } from "./manifest";

export function ensureManifest(
  appId: number,
  directory: string,
  port: number
): { generated: boolean; manifest: AppManifest } {
  const existing = readManifest(directory);
  if (existing) {
    return { generated: false, manifest: existing };
  }

  const stack = detectTechStack(directory);
  const manifest = generateManifest(stack, port, directory);
  writeManifest(directory, manifest);
  return { generated: true, manifest };
}
