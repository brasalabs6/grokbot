export type TerminalTicket = {
  purpose: "terminal";
  sessionId: string;
  userId: string;
  terminalId: string;
  generation: number;
  exp: number;
  jti: string;
};
const encoder = new TextEncoder();
function fromBase64Url(s: string) {
  return Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (x) =>
    x.charCodeAt(0)
  );
}
export async function verifyTerminalTicket(
  value: string,
  key: string
): Promise<TerminalTicket | null> {
  const [encoded, signature, ...extra] = value.split(".");
  if (!encoded || !signature || extra.length) {
    return null;
  }
  try {
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      encoder.encode(key),
      { hash: "SHA-256", name: "HMAC" },
      false,
      ["verify"]
    );
    if (
      !(await crypto.subtle.verify(
        "HMAC",
        cryptoKey,
        fromBase64Url(signature),
        encoder.encode(encoded)
      ))
    ) {
      return null;
    }
    const obj = JSON.parse(new TextDecoder().decode(fromBase64Url(encoded)));
    if (
      obj?.purpose !== "terminal" ||
      !isUuid(obj.sessionId) ||
      !isUuid(obj.userId) ||
      !isUuid(obj.terminalId) ||
      !isUuid(obj.jti)
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
    return obj as TerminalTicket;
  } catch {
    return null;
  }
}
export function isUuid(s: unknown): s is string {
  return (
    typeof s === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      s
    )
  );
}
