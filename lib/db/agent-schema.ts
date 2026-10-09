import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { user } from "./schema";

/** GrokBot agent runtime persistence, separate from legacy LLM Chat tables. */
export const agentSession = pgTable(
  "AgentSession",
  {
    createdAt: timestamp("createdAt", { withTimezone: true })
      .notNull()
      .defaultNow(),
    currentRunId: uuid("currentRunId"),
    deletedAt: timestamp("deletedAt", { withTimezone: true }),
    generation: integer("generation").notNull().default(0),
    id: uuid("id").primaryKey().defaultRandom(),
    modelId: varchar("modelId", { length: 200 }).notNull(),
    ownerId: uuid("ownerId")
      .notNull()
      .references(() => user.id),
    permissionMode: varchar("permissionMode", { length: 12 })
      .notNull()
      .default("ask"),
    state: varchar("state", { length: 32 }).notNull().default("CREATED"),
    stateVersion: integer("stateVersion").notNull().default(1),
    title: varchar("title", { length: 160 }).notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .notNull()
      .defaultNow(),
    workspace: jsonb("workspace").notNull(),
  },
  (t) => [index("agent_session_owner_activity").on(t.ownerId, t.updatedAt)]
);
export const agentSandbox = pgTable(
  "AgentSandbox",
  {
    createdAt: timestamp("createdAt", { withTimezone: true })
      .notNull()
      .defaultNow(),
    doName: varchar("doName", { length: 160 }).notNull(),
    generation: integer("generation").notNull().default(0),
    id: uuid("id").primaryKey().defaultRandom(),
    imageDigest: text("imageDigest"),
    lastError: text("lastError"),
    lastHeartbeat: timestamp("lastHeartbeat", { withTimezone: true }),
    sessionId: uuid("sessionId")
      .notNull()
      .references(() => agentSession.id),
    state: varchar("state", { length: 32 }).notNull().default("ABSENT"),
  },
  (t) => [
    uniqueIndex("agent_sandbox_session_unique").on(t.sessionId),
    uniqueIndex("agent_sandbox_do_unique").on(t.doName),
  ]
);
export const agentRun = pgTable(
  "AgentRun",
  {
    clientMessageId: uuid("clientMessageId").notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .notNull()
      .defaultNow(),
    endedAt: timestamp("endedAt", { withTimezone: true }),
    errorCode: text("errorCode"),
    finishReason: text("finishReason"),
    generation: integer("generation").notNull(),
    id: uuid("id").primaryKey().defaultRandom(),
    idempotencyKey: uuid("idempotencyKey").notNull(),
    modelId: varchar("modelId", { length: 200 }).notNull(),
    prompt: jsonb("prompt").notNull(),
    requestHash: varchar("requestHash", { length: 64 }).notNull(),
    sessionId: uuid("sessionId")
      .notNull()
      .references(() => agentSession.id),
    startedAt: timestamp("startedAt", { withTimezone: true }),
    state: varchar("state", { length: 32 })
      .notNull()
      .default("QUEUED_FOR_DISPATCH"),
  },
  (t) => [
    uniqueIndex("agent_run_idempotency_unique").on(
      t.sessionId,
      t.idempotencyKey
    ),
    index("agent_run_session_created").on(t.sessionId, t.createdAt),
  ]
);
export const agentEvent = pgTable(
  "AgentEvent",
  {
    createdAt: timestamp("createdAt", { withTimezone: true })
      .notNull()
      .defaultNow(),
    generation: integer("generation").notNull(),
    id: uuid("id").primaryKey(),
    payload: jsonb("payload").notNull(),
    payloadVersion: integer("payloadVersion").notNull().default(1),
    runId: uuid("runId").references(() => agentRun.id),
    seq: integer("seq").notNull(),
    sessionId: uuid("sessionId")
      .notNull()
      .references(() => agentSession.id),
    type: varchar("type", { length: 100 }).notNull(),
  },
  (t) => [
    uniqueIndex("agent_event_session_seq").on(t.sessionId, t.seq),
    index("agent_event_run_idx").on(t.runId),
  ]
);
export const agentOperation = pgTable(
  "AgentOperation",
  {
    createdAt: timestamp("createdAt", { withTimezone: true })
      .notNull()
      .defaultNow(),
    errorCode: text("errorCode"),
    expectedVersion: integer("expectedVersion").notNull(),
    finishedAt: timestamp("finishedAt", { withTimezone: true }),
    generation: integer("generation").notNull(),
    id: uuid("id").primaryKey().defaultRandom(),
    idempotencyKey: uuid("idempotencyKey").notNull(),
    kind: varchar("kind", { length: 32 }).notNull(),
    sessionId: uuid("sessionId")
      .notNull()
      .references(() => agentSession.id),
    state: varchar("state", { length: 32 }).notNull().default("PENDING"),
  },
  (t) => [
    uniqueIndex("agent_operation_idempotency_unique").on(
      t.sessionId,
      t.kind,
      t.idempotencyKey
    ),
  ]
);
export const agentApproval = pgTable(
  "AgentApproval",
  {
    decidedAt: timestamp("decidedAt", { withTimezone: true }),
    decidedBy: uuid("decidedBy").references(() => user.id),
    decision: varchar("decision", { length: 20 }),
    expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
    id: uuid("id").primaryKey().defaultRandom(),
    request: jsonb("request").notNull(),
    runId: uuid("runId")
      .notNull()
      .references(() => agentRun.id),
    sessionId: uuid("sessionId")
      .notNull()
      .references(() => agentSession.id),
    state: varchar("state", { length: 20 }).notNull().default("PENDING"),
    toolCallId: text("toolCallId").notNull(),
  },
  (t) => [uniqueIndex("agent_approval_tool_unique").on(t.runId, t.toolCallId)]
);
export const agentTerminal = pgTable(
  "AgentTerminal",
  {
    createdAt: timestamp("createdAt", { withTimezone: true })
      .notNull()
      .defaultNow(),
    generation: integer("generation").notNull(),
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("sessionId")
      .notNull()
      .references(() => agentSession.id),
    state: varchar("state", { length: 30 }).notNull().default("CREATING"),
    tmuxName: varchar("tmuxName", { length: 100 }).notNull(),
  },
  (t) => [
    uniqueIndex("agent_terminal_generation_name").on(
      t.sessionId,
      t.generation,
      t.tmuxName
    ),
  ]
);
export const agentBackup = pgTable(
  "AgentBackup",
  {
    checksum: varchar("checksum", { length: 128 }),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .notNull()
      .defaultNow(),
    generation: integer("generation").notNull(),
    id: uuid("id").primaryKey().defaultRandom(),
    kind: varchar("kind", { length: 20 }).notNull(),
    r2Key: text("r2Key"),
    sessionId: uuid("sessionId")
      .notNull()
      .references(() => agentSession.id),
    snapshotId: text("snapshotId"),
    verified: boolean("verified").notNull().default(false),
  },
  (t) => [index("agent_backup_session_created").on(t.sessionId, t.createdAt)]
);
