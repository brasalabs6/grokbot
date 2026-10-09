import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const ticketSchema = z.object({
  purpose: z.literal("terminal"),
  sessionId: z.uuid(),
  userId: z.uuid(),
  terminalId: z.uuid(),
  generation: z.number().int().positive(),
  exp: z.number().int().positive(),
  jti: z.uuid(),
}).strict();

export type SignedTerminalTicket = z.infer<typeof ticketSchema>;

function key(): string {
  const secret = process.env.RUNTIME_TICKET_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("TERMINAL_TICKETS_NOT_CONFIGURED");
  }
  return secret;
}

/** Stateless, short-lived access. The Cloudflare Durable Object consumes each jti once. */
export function createTerminalTicket(input: Omit<SignedTerminalTicket, "purpose" | "exp" | "jti">): {
  token: string;
  expiresAt: string;
} {
  const exp = Date.now() + 60_000;
  const payload = ticketSchema.parse({
    ...input,
    purpose: "terminal",
    exp,
    jti: crypto.randomUUID(),
  });
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", key()).update(encoded).digest("base64url");
  return { token: encoded + "." + signature, expiresAt: new Date(exp).toISOString() };
}

/** Test-only signature verification; Cloudflare uses Web Crypto and its own verifier. */
export function verifyIssuedTerminalTicket(token: string): SignedTerminalTicket | null {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return null;
  const expected = createHmac("sha256", key()).update(payload).digest();
  let received: Buffer;
  try { received = Buffer.from(signature, "base64url"); } catch { return null; }
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
  try {
    const parsed = ticketSchema.parse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
    if (parsed.exp < Date.now() || parsed.exp > Date.now() + 60_000) return null;
    return parsed;
  } catch { return null; }
}
