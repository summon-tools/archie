import crypto from "crypto";
import { AUTH_SECRET_KEY, MODE } from "./config";

const PREFIX = "v1";

function encryptionKey(): Buffer {
  const secret = AUTH_SECRET_KEY || (MODE === "development" ? "dev-only-insecure-key" : "");
  if (!secret) {
    throw new Error("AUTH_SECRET_KEY is required to encrypt GitHub credentials");
  }
  return crypto.createHash("sha256").update(secret).digest();
}

export function encryptSecret(value: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    PREFIX,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(":");
}

export function decryptSecret(value: string | null | undefined): string {
  if (!value) return "";
  const [prefix, ivRaw, tagRaw, ciphertextRaw] = value.split(":");
  if (prefix !== PREFIX || !ivRaw || !tagRaw || !ciphertextRaw) {
    return value;
  }

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(ivRaw, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextRaw, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
