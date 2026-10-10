import { isUuid } from "./ticket";

export type AcpTicket = {
  purpose: "acp";
  sessionId: string;
  userId: string;
  generation: number;
  exp: number;
  jti: string;
};

function decode(data: string): Uint8Array {
  return Uint8Array.from(
    atob(data.replace(/-/g, "+").replace(/_/g, "/")),
    (x) => x.charCodeAt(0)
  );
}

/** A browser cannot supply ACP or container secrets; it receives a one-use signed capability. */
export async function verifyAcpTicket(
  raw: string,
  secret: string
): Promise<AcpTicket | null> {
  if (!secret || secret.length < 32) {
    return null;
  }
  const parts = raw.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return null;
  }
  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { hash: "SHA-256", name: "HMAC" },
      false,
      ["verify"]
    );
    if (
      !(await crypto.subtle.verify(
        "HMAC",
        key,
        decode(parts[1]) as BufferSource,
        encoder.encode(parts[0])
      ))
    ) {
      return null;
    }
    const value: unknown = JSON.parse(
      new TextDecoder().decode(decode(parts[0]))
    );
    if (!value || typeof value !== "object") {
      return null;
    }
    const obj = value as Record<string, unknown>;
    if (
      Object.keys(obj).sort().join(",") !==
      ["exp", "generation", "jti", "purpose", "sessionId", "userId"].join(",")
    ) {
      return null;
    }
    if (
      obj.purpose !== "acp" ||
      !isUuid(obj.sessionId) ||
      !isUuid(obj.userId) ||
      !isUuid(obj.jti)
    ) {
      return null;
    }
    if (
      !Number.isSafeInteger(obj.generation) ||
      (obj.generation as number) < 1 ||
      !Number.isSafeInteger(obj.exp) ||
      (obj.exp as number) < Date.now() ||
      (obj.exp as number) > Date.now() + 120_000
    ) {
      return null;
    }
    return obj as AcpTicket;
  } catch {
    return null;
  }
}
