import crypto from "crypto";

export function verifyGitHubWebhookSignature(
  payload: string,
  signature: string | null,
  secret: string,
): boolean {
  if (!signature || !signature.startsWith("sha256=") || !secret) return false;
  const expected = `sha256=${crypto.createHmac("sha256", secret).update(payload, "utf8").digest("hex")}`;
  const expectedBuffer = Buffer.from(expected, "utf8");
  const receivedBuffer = Buffer.from(signature, "utf8");
  return expectedBuffer.length === receivedBuffer.length
    && crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}
