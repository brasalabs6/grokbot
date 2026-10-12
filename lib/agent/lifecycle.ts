import type { AgentRunState, AgentSessionState } from "./contracts";

/** Illegal transitions fail closed rather than silently accepting stale lifecycle commands. */
const SESSION_EDGES: Record<AgentSessionState, readonly AgentSessionState[]> = {
  CREATED: ["PROVISIONING", "DELETING", "FAILED"],
  DEGRADED: ["RECOVERING", "READY", "IDLE", "FAILED", "STOPPING", "DELETING"],
  DELETED: [],
  DELETING: ["DELETED", "FAILED"],
  FAILED: ["RECOVERING", "RESUMING", "STOPPING", "DELETING"],
  IDLE: [
    "RUNNING",
    "SUSPENDING",
    "STOPPING",
    "DELETING",
    "RECOVERING",
    "FAILED",
  ],
  PROVISIONING: ["READY", "FAILED", "RECOVERING", "STOPPING"],
  READY: [
    "RUNNING",
    "IDLE",
    "SUSPENDING",
    "STOPPING",
    "DELETING",
    "RECOVERING",
    "FAILED",
  ],
  RECOVERING: ["READY", "IDLE", "SUSPENDED", "DEGRADED", "FAILED", "STOPPED"],
  RESUMING: ["READY", "IDLE", "RECOVERING", "DEGRADED", "FAILED", "STOPPING"],
  RUNNING: [
    "WAITING_APPROVAL",
    "IDLE",
    "RECOVERING",
    "DEGRADED",
    "FAILED",
    "STOPPING",
  ],
  STOPPED: ["RESUMING", "PROVISIONING", "DELETING"],
  STOPPING: ["STOPPED", "FAILED", "RECOVERING"],
  SUSPENDED: ["RESUMING", "STOPPING", "DELETING", "FAILED"],
  SUSPENDING: ["SUSPENDED", "DEGRADED", "FAILED", "RECOVERING"],
  WAITING_APPROVAL: ["RUNNING", "IDLE", "RECOVERING", "FAILED", "STOPPING"],
};
const RUN_EDGES: Record<AgentRunState, readonly AgentRunState[]> = {
  CANCELLED: [],
  CANCELLING: ["CANCELLED", "FAILED", "TIMED_OUT", "OUTCOME_UNKNOWN"],
  DISPATCHING: [
    "RUNNING",
    "CANCELLING",
    "FAILED",
    "TIMED_OUT",
    "OUTCOME_UNKNOWN",
  ],
  FAILED: [],
  OUTCOME_UNKNOWN: [],
  QUEUED_FOR_DISPATCH: ["DISPATCHING", "CANCELLED", "FAILED"],
  RUNNING: [
    "WAITING_APPROVAL",
    "CANCELLING",
    "SUCCEEDED",
    "FAILED",
    "TIMED_OUT",
    "OUTCOME_UNKNOWN",
  ],
  SUCCEEDED: [],
  TIMED_OUT: [],
  WAITING_APPROVAL: [
    "RUNNING",
    "CANCELLING",
    "FAILED",
    "TIMED_OUT",
    "OUTCOME_UNKNOWN",
  ],
};
export class IllegalTransitionError extends Error {
  constructor(
    public readonly entity: "session" | "run",
    public readonly from: string,
    public readonly to: string
  ) {
    super(`Illegal ${entity} transition: ${from} -> ${to}`);
    this.name = "IllegalTransitionError";
  }
}
export function transitionSession(
  from: AgentSessionState,
  to: AgentSessionState
): AgentSessionState {
  if (!SESSION_EDGES[from].includes(to)) {
    throw new IllegalTransitionError("session", from, to);
  }
  return to;
}
export function transitionRun(
  from: AgentRunState,
  to: AgentRunState
): AgentRunState {
  if (!RUN_EDGES[from].includes(to)) {
    throw new IllegalTransitionError("run", from, to);
  }
  return to;
}
export function isRunTerminal(s: AgentRunState): boolean {
  return [
    "SUCCEEDED",
    "FAILED",
    "CANCELLED",
    "TIMED_OUT",
    "OUTCOME_UNKNOWN",
  ].includes(s);
}
export function canAcceptRun(
  s: AgentSessionState,
  hasActiveRun: boolean
): boolean {
  return !hasActiveRun && (s === "READY" || s === "IDLE");
}
export function acceptsGeneration(received: number, current: number): boolean {
  return (
    Number.isSafeInteger(received) &&
    Number.isSafeInteger(current) &&
    received === current &&
    received >= 1
  );
}
