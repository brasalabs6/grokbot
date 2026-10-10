import { isUuid } from "./ticket";

export type RunPermit = {
  purpose: "run-dispatch";
  sessionId: string;
  userId: string;
  runId: string;
  generation: number;
  promptHash: string;
  jti: string;
  exp: number;
};
const encode = new TextEncoder();
const digest = /^[a-f0-9]{64}$/;
const base64decode = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (x) =>
    x.charCodeAt(0)
  );

export async function verifyRunPermit(
  raw: string,
  secret: string
): Promise<RunPermit | null> {
  if (!secret || secret.length < 32 || raw.length > 4096) {
    return null;
  }
  const items = raw.split(".");
  if (items.length !== 2) {
    return null;
  }
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      encode.encode(secret),
      { hash: "SHA-256", name: "HMAC" },
      false,
      ["verify"]
    );
    if (
      !(await crypto.subtle.verify(
        "HMAC",
        key,
        base64decode(items[1]) as BufferSource,
        encode.encode(items[0])
      ))
    ) {
      return null;
    }
    const obj = JSON.parse(new TextDecoder().decode(base64decode(items[0])));
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
      return null;
    }
    const names = Object.keys(obj).sort().join(",");
    if (
      names !==
      [
        "exp",
        "generation",
        "jti",
        "promptHash",
        "purpose",
        "runId",
        "sessionId",
        "userId",
      ].join(",")
    ) {
      return null;
    }
    if (
      obj.purpose !== "run-dispatch" ||
      !isUuid(obj.sessionId) ||
      !isUuid(obj.userId) ||
      !isUuid(obj.runId) ||
      !isUuid(obj.jti) ||
      !digest.test(obj.promptHash)
    ) {
      return null;
    }
    if (
      !Number.isSafeInteger(obj.generation) ||
      obj.generation < 1 ||
      !Number.isSafeInteger(obj.exp) ||
      obj.exp < Date.now() ||
      obj.exp > Date.now() + 120_000
    ) {
      return null;
    }
    return obj as RunPermit;
  } catch {
    return null;
  }
}
export async function promptHash(parts: unknown): Promise<string> {
  const raw = JSON.stringify(parts);
  const bytes = new TextEncoder().encode(raw);
  const result = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(result), (x) =>
    x.toString(16).padStart(2, "0")
  ).join("");
}
