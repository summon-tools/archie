import fs from "fs";
import path from "path";

function envPath(directory: string): string {
  return path.join(directory, ".env");
}

export function readEnv(directory: string): { key: string; value: string }[] {
  const p = envPath(directory);
  if (!fs.existsSync(p)) return [];

  const content = fs.readFileSync(p, "utf-8");
  const result: { key: string; value: string }[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)/);
    if (match) {
      const key = match[1];
      let value = match[2].trim();
      if (value.length >= 2) {
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
      }
      result.push({ key, value });
    }
  }
  return result;
}

export function writeEnv(
  directory: string,
  envVars: { key: string; value: string }[]
): { success: boolean; message: string } {
  const p = envPath(directory);
  try {
    const lines: string[] = [];
    for (const v of envVars) {
      const key = v.key.trim();
      let value = v.value;
      if (/[ '"#;]/.test(value)) {
        value = `"${value.replace(/"/g, '\\"')}"`;
      }
      lines.push(`${key}=${value}`);
    }
    fs.writeFileSync(p, lines.join("\n") + "\n");
    return { success: true, message: "Environment variables saved" };
  } catch (e: any) {
    return { success: false, message: String(e) };
  }
}

export function setEnvVar(
  directory: string,
  key: string,
  value: string
): { success: boolean; message: string } {
  const envVars = readEnv(directory);
  const existing = envVars.find((v) => v.key === key);
  if (existing) {
    existing.value = value;
  } else {
    envVars.push({ key, value });
  }
  return writeEnv(directory, envVars);
}

export function deleteEnvVar(
  directory: string,
  key: string
): { success: boolean; message: string } {
  const envVars = readEnv(directory).filter((v) => v.key !== key);
  return writeEnv(directory, envVars);
}
