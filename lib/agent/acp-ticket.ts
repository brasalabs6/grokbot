import "server-only";
import { createHmac } from "node:crypto";
import { z } from "zod";

const payload = z.object({
  purpose: z.literal("acp"),
  sessionId: z.uuid(),
  userId: z.uuid(),
  generation: z.number().int().positive(),
  exp: z.number().int().positive(),
  jti: z.uuid(),
}).strict();

/** 60-second ACP capability; the Worker consumes its ID exactly once. */
export function createAcpTicket(input: {
  sessionId: string;
  userId: string;
  generation: number;
}): { token: string; expiresAt: string } {
  const key = process.env.RUNTIME_TICKET_SECRET;
  if (!key || key.length < 32) throw new Error("ACP_TICKET_KEY_NOT_CONFIGURED");
  const exp = Date.now() + 60_000;
  const fields = payload.parse({
    ...input,
    exp, jti: crypto.randomUUID(), purpose: "acp",
  });
  const data = Buffer.from(JSON.stringify(fields)).toString("base64url");
  const sig = createHmac("sha256", key).update(data).digest("base64url");
  return { token: data + "." + sig, expiresAt: new Date(exp).toISOString() };
}
