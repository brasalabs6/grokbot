/** Translation is intentionally lossless: original ACP payload remains in raw for replay/debugging. */
export type AcpUpdate = { sessionUpdate: string; [key: string]: unknown };
export type MappedAcpUpdate = {
  type: string;
  payload: Record<string, unknown>;
};
const EVENTS: Record<string, string> = {
  agent_message_chunk: "assistant.text.delta",
  agent_thought_chunk: "agent.thought.delta",
  plan: "agent.plan.updated",
  tool_call: "tool.started",
  tool_call_update: "tool.updated",
};
export function mapAcpUpdate(value: unknown): MappedAcpUpdate {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { payload: { raw: value }, type: "agent.raw_event" };
  }
  const raw = value as Record<string, unknown>;
  const kind =
    typeof raw.sessionUpdate === "string" ? raw.sessionUpdate : "unknown";
  return { payload: { kind, raw }, type: EVENTS[kind] ?? "agent.raw_event" };
}
