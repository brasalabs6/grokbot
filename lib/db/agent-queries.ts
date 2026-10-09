import "server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type {
  AgentRunState,
  AgentSessionState,
  CreateAgentSessionInput,
  SubmitPromptInput,
} from "@/lib/agent/contracts";
import {
  canAcceptRun,
  transitionRun,
  transitionSession,
} from "@/lib/agent/lifecycle";
import {
  agentEvent,
  agentRun,
  agentSandbox,
  agentSession,
} from "./agent-schema";

// Small explicit pool: serverless deploys can otherwise exhaust PostgreSQL connections.
const sqlClient = postgres(process.env.POSTGRES_URL ?? "", {
  connect_timeout: 10,
  idle_timeout: 20,
  max: 3,
});
const db = drizzle(sqlClient);
export type AgentSessionRecord = typeof agentSession.$inferSelect;

export class AgentConflict extends Error {
  constructor(
    public readonly code:
      | "VERSION_CONFLICT"
      | "RUN_ALREADY_ACTIVE"
      | "SESSION_NOT_READY"
      | "IDEMPOTENCY_CONFLICT"
      | "GENERATION_CONFLICT"
  ) {
    super(code);
    this.name = "AgentConflict";
  }
}
export async function createAgentSession(
  ownerId: string,
  input: CreateAgentSessionInput
) {
  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(agentSession)
      .values({
        modelId: input.modelId,
        ownerId,
        permissionMode: input.permissionMode,
        title: input.title ?? "New agent session",
        workspace: input.workspace,
      })
      .returning();
    await tx
      .insert(agentSandbox)
      .values({ doName: `grokbot-${created.id}`, sessionId: created.id });
    return created;
  });
}
export async function getAgentSession(sessionId: string, ownerId: string) {
  const [result] = await db
    .select()
    .from(agentSession)
    .where(
      and(
        eq(agentSession.id, sessionId),
        eq(agentSession.ownerId, ownerId),
        isNull(agentSession.deletedAt)
      )
    )
    .limit(1);
  return result ?? null;
}
export async function listAgentSessions(ownerId: string, limit = 40) {
  return db
    .select()
    .from(agentSession)
    .where(
      and(eq(agentSession.ownerId, ownerId), isNull(agentSession.deletedAt))
    )
    .orderBy(desc(agentSession.updatedAt), desc(agentSession.id))
    .limit(Math.max(1, Math.min(limit, 100)));
}
export async function renameAgentSession(
  sessionId: string,
  ownerId: string,
  title: string,
  version: number
) {
  const [updated] = await db
    .update(agentSession)
    .set({
      stateVersion: sql`${agentSession.stateVersion}+1`,
      title,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(agentSession.id, sessionId),
        eq(agentSession.ownerId, ownerId),
        eq(agentSession.stateVersion, version),
        isNull(agentSession.deletedAt)
      )
    )
    .returning();
  if (updated) {
    return updated;
  }
  if (!(await getAgentSession(sessionId, ownerId))) {
    return null;
  }
  throw new AgentConflict("VERSION_CONFLICT");
}
export async function setAgentSessionState(args: {
  sessionId: string;
  ownerId: string;
  from: AgentSessionState;
  to: AgentSessionState;
  version: number;
  generation?: number;
}) {
  transitionSession(args.from, args.to);
  const conditions = [
    eq(agentSession.id, args.sessionId),
    eq(agentSession.ownerId, args.ownerId),
    eq(agentSession.state, args.from),
    eq(agentSession.stateVersion, args.version),
    isNull(agentSession.deletedAt),
  ];
  if (args.generation !== undefined) {
    conditions.push(eq(agentSession.generation, args.generation));
  }
  const [updated] = await db
    .update(agentSession)
    .set({
      state: args.to,
      stateVersion: sql`${agentSession.stateVersion}+1`,
      updatedAt: new Date(),
    })
    .where(and(...conditions))
    .returning();
  if (updated) {
    return updated;
  }
  throw new AgentConflict("VERSION_CONFLICT");
}
/** Atomically accept a run, bound to generation and idempotency key. */
export async function acceptAgentRun(args: {
  sessionId: string;
  ownerId: string;
  idempotencyKey: string;
  requestHash: string;
  input: SubmitPromptInput;
}) {
  return db.transaction(async (tx) => {
    const [session] = await tx
      .select()
      .from(agentSession)
      .where(
        and(
          eq(agentSession.id, args.sessionId),
          eq(agentSession.ownerId, args.ownerId),
          isNull(agentSession.deletedAt)
        )
      )
      .for("update");
    if (!session) {
      return null;
    }
    const [sameKey] = await tx
      .select()
      .from(agentRun)
      .where(
        and(
          eq(agentRun.sessionId, session.id),
          eq(agentRun.idempotencyKey, args.idempotencyKey)
        )
      )
      .limit(1);
    if (sameKey) {
      if (sameKey.requestHash !== args.requestHash) {
        throw new AgentConflict("IDEMPOTENCY_CONFLICT");
      }
      return { duplicate: true, run: sameKey };
    }
    if (session.stateVersion !== args.input.expectedSessionVersion) {
      throw new AgentConflict("VERSION_CONFLICT");
    }
    if (
      !canAcceptRun(
        session.state as AgentSessionState,
        Boolean(session.currentRunId)
      )
    ) {
      throw new AgentConflict(
        session.currentRunId ? "RUN_ALREADY_ACTIVE" : "SESSION_NOT_READY"
      );
    }
    const [run] = await tx
      .insert(agentRun)
      .values({
        clientMessageId: args.input.clientMessageId,
        generation: session.generation,
        idempotencyKey: args.idempotencyKey,
        modelId: session.modelId,
        prompt: args.input.parts,
        requestHash: args.requestHash,
        sessionId: session.id,
      })
      .returning();
    await tx
      .update(agentSession)
      .set({
        currentRunId: run.id,
        state: "RUNNING",
        stateVersion: sql`${agentSession.stateVersion}+1`,
        updatedAt: new Date(),
      })
      .where(eq(agentSession.id, session.id));
    return { duplicate: false, run };
  });
}
export async function getAgentRun(
  runId: string,
  sessionId: string,
  ownerId: string
) {
  const owner = await getAgentSession(sessionId, ownerId);
  if (!owner) {
    return null;
  }
  const [run] = await db
    .select()
    .from(agentRun)
    .where(and(eq(agentRun.id, runId), eq(agentRun.sessionId, sessionId)))
    .limit(1);
  return run ?? null;
}
/** Complete a run only if the current run/generation is still authoritative. */
export async function transitionAgentRun(args: {
  runId: string;
  sessionId: string;
  generation: number;
  from: AgentRunState;
  to: AgentRunState;
}) {
  transitionRun(args.from, args.to);
  return db.transaction(async (tx) => {
    const [session] = await tx
      .select()
      .from(agentSession)
      .where(eq(agentSession.id, args.sessionId))
      .for("update");
    if (
      !session ||
      session.generation !== args.generation ||
      session.currentRunId !== args.runId
    ) {
      throw new AgentConflict("GENERATION_CONFLICT");
    }
    const [run] = await tx
      .update(agentRun)
      .set({
        state: args.to,
        ...([
          "SUCCEEDED",
          "FAILED",
          "CANCELLED",
          "TIMED_OUT",
          "OUTCOME_UNKNOWN",
        ].includes(args.to)
          ? { endedAt: new Date() }
          : {}),
        ...(args.to === "RUNNING" ? { startedAt: new Date() } : {}),
      })
      .where(
        and(
          eq(agentRun.id, args.runId),
          eq(agentRun.sessionId, args.sessionId),
          eq(agentRun.state, args.from),
          eq(agentRun.generation, args.generation)
        )
      )
      .returning();
    if (!run) {
      throw new AgentConflict("VERSION_CONFLICT");
    }
    if (
      [
        "SUCCEEDED",
        "FAILED",
        "CANCELLED",
        "TIMED_OUT",
        "OUTCOME_UNKNOWN",
      ].includes(args.to)
    ) {
      await tx
        .update(agentSession)
        .set({
          currentRunId: null,
          state: args.to === "SUCCEEDED" ? "IDLE" : "DEGRADED",
          stateVersion: sql`${agentSession.stateVersion}+1`,
          updatedAt: new Date(),
        })
        .where(eq(agentSession.id, args.sessionId));
    }
    return run;
  });
}
/** Session lock serializes event allocation, removing MAX(seq) races. */
export async function appendAgentEvent(args: {
  eventId: string;
  sessionId: string;
  generation: number;
  runId?: string | null;
  type: string;
  payload: Record<string, unknown>;
}) {
  return db.transaction(async (tx) => {
    const [session] = await tx
      .select({ generation: agentSession.generation, id: agentSession.id })
      .from(agentSession)
      .where(eq(agentSession.id, args.sessionId))
      .for("update");
    if (!session || session.generation !== args.generation) {
      throw new AgentConflict("GENERATION_CONFLICT");
    }
    const [duplicate] = await tx
      .select()
      .from(agentEvent)
      .where(eq(agentEvent.id, args.eventId))
      .limit(1);
    if (duplicate) {
      return duplicate;
    }
    const [head] = await tx
      .select({ seq: sql<number>`coalesce(max(${agentEvent.seq}),0)` })
      .from(agentEvent)
      .where(eq(agentEvent.sessionId, args.sessionId));
    const [saved] = await tx
      .insert(agentEvent)
      .values({
        generation: args.generation,
        id: args.eventId,
        payload: args.payload,
        runId: args.runId ?? null,
        seq: Number(head?.seq ?? 0) + 1,
        sessionId: args.sessionId,
        type: args.type,
      })
      .returning();
    return saved;
  });
}
export async function listAgentEvents(
  sessionId: string,
  ownerId: string,
  after = 0,
  limit = 300
) {
  if (!(await getAgentSession(sessionId, ownerId))) {
    return null;
  }
  return db
    .select()
    .from(agentEvent)
    .where(
      and(
        eq(agentEvent.sessionId, sessionId),
        sql`${agentEvent.seq} > ${after}`
      )
    )
    .orderBy(agentEvent.seq)
    .limit(Math.max(1, Math.min(limit, 500)));
}
