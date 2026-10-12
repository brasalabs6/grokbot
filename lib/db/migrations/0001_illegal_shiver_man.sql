-- Agent-only additive migration: 0000_initial.sql already creates legacy tables.
CREATE TABLE "AgentApproval" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sessionId" uuid NOT NULL,
	"runId" uuid NOT NULL,
	"toolCallId" text NOT NULL,
	"request" jsonb NOT NULL,
	"state" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"decision" varchar(20),
	"decidedBy" uuid,
	"expiresAt" timestamp with time zone NOT NULL,
	"decidedAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "AgentBackup" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sessionId" uuid NOT NULL,
	"generation" integer NOT NULL,
	"kind" varchar(20) NOT NULL,
	"snapshotId" text,
	"r2Key" text,
	"checksum" varchar(128),
	"verified" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "AgentEvent" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sessionId" uuid NOT NULL,
	"runId" uuid,
	"seq" integer NOT NULL,
	"generation" integer NOT NULL,
	"type" varchar(100) NOT NULL,
	"payloadVersion" integer DEFAULT 1 NOT NULL,
	"payload" jsonb NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "AgentOperation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sessionId" uuid NOT NULL,
	"idempotencyKey" uuid NOT NULL,
	"kind" varchar(32) NOT NULL,
	"state" varchar(32) DEFAULT 'PENDING' NOT NULL,
	"expectedVersion" integer NOT NULL,
	"generation" integer NOT NULL,
	"errorCode" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"finishedAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "AgentRun" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sessionId" uuid NOT NULL,
	"idempotencyKey" uuid NOT NULL,
	"requestHash" varchar(64) NOT NULL,
	"clientMessageId" uuid NOT NULL,
	"prompt" jsonb NOT NULL,
	"modelId" varchar(200) NOT NULL,
	"generation" integer NOT NULL,
	"state" varchar(32) DEFAULT 'QUEUED_FOR_DISPATCH' NOT NULL,
	"finishReason" text,
	"errorCode" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"startedAt" timestamp with time zone,
	"endedAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "AgentSandbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sessionId" uuid NOT NULL,
	"doName" varchar(160) NOT NULL,
	"imageDigest" text,
	"generation" integer DEFAULT 0 NOT NULL,
	"state" varchar(32) DEFAULT 'ABSENT' NOT NULL,
	"lastHeartbeat" timestamp with time zone,
	"lastError" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "AgentSession" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ownerId" uuid NOT NULL,
	"title" varchar(160) NOT NULL,
	"modelId" varchar(200) NOT NULL,
	"permissionMode" varchar(12) DEFAULT 'ask' NOT NULL,
	"workspace" jsonb NOT NULL,
	"state" varchar(32) DEFAULT 'CREATED' NOT NULL,
	"stateVersion" integer DEFAULT 1 NOT NULL,
	"generation" integer DEFAULT 0 NOT NULL,
	"currentRunId" uuid,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"deletedAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "AgentTerminal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sessionId" uuid NOT NULL,
	"generation" integer NOT NULL,
	"tmuxName" varchar(100) NOT NULL,
	"state" varchar(30) DEFAULT 'CREATING' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "AgentApproval" ADD CONSTRAINT "AgentApproval_sessionId_AgentSession_id_fk" FOREIGN KEY ("sessionId") REFERENCES "public"."AgentSession"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "AgentApproval" ADD CONSTRAINT "AgentApproval_runId_AgentRun_id_fk" FOREIGN KEY ("runId") REFERENCES "public"."AgentRun"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "AgentApproval" ADD CONSTRAINT "AgentApproval_decidedBy_User_id_fk" FOREIGN KEY ("decidedBy") REFERENCES "public"."User"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "AgentBackup" ADD CONSTRAINT "AgentBackup_sessionId_AgentSession_id_fk" FOREIGN KEY ("sessionId") REFERENCES "public"."AgentSession"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "AgentEvent" ADD CONSTRAINT "AgentEvent_sessionId_AgentSession_id_fk" FOREIGN KEY ("sessionId") REFERENCES "public"."AgentSession"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "AgentEvent" ADD CONSTRAINT "AgentEvent_runId_AgentRun_id_fk" FOREIGN KEY ("runId") REFERENCES "public"."AgentRun"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "AgentOperation" ADD CONSTRAINT "AgentOperation_sessionId_AgentSession_id_fk" FOREIGN KEY ("sessionId") REFERENCES "public"."AgentSession"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_sessionId_AgentSession_id_fk" FOREIGN KEY ("sessionId") REFERENCES "public"."AgentSession"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "AgentSandbox" ADD CONSTRAINT "AgentSandbox_sessionId_AgentSession_id_fk" FOREIGN KEY ("sessionId") REFERENCES "public"."AgentSession"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "AgentSession" ADD CONSTRAINT "AgentSession_ownerId_User_id_fk" FOREIGN KEY ("ownerId") REFERENCES "public"."User"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "AgentTerminal" ADD CONSTRAINT "AgentTerminal_sessionId_AgentSession_id_fk" FOREIGN KEY ("sessionId") REFERENCES "public"."AgentSession"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "agent_approval_tool_unique" ON "AgentApproval" USING btree ("runId","toolCallId");
--> statement-breakpoint
CREATE INDEX "agent_backup_session_created" ON "AgentBackup" USING btree ("sessionId","createdAt");
--> statement-breakpoint
CREATE UNIQUE INDEX "agent_event_session_seq" ON "AgentEvent" USING btree ("sessionId","seq");
--> statement-breakpoint
CREATE INDEX "agent_event_run_idx" ON "AgentEvent" USING btree ("runId");
--> statement-breakpoint
CREATE UNIQUE INDEX "agent_operation_idempotency_unique" ON "AgentOperation" USING btree ("sessionId","kind","idempotencyKey");
--> statement-breakpoint
CREATE UNIQUE INDEX "agent_run_idempotency_unique" ON "AgentRun" USING btree ("sessionId","idempotencyKey");
--> statement-breakpoint
CREATE INDEX "agent_run_session_created" ON "AgentRun" USING btree ("sessionId","createdAt");
--> statement-breakpoint
CREATE UNIQUE INDEX "agent_sandbox_session_unique" ON "AgentSandbox" USING btree ("sessionId");
--> statement-breakpoint
CREATE UNIQUE INDEX "agent_sandbox_do_unique" ON "AgentSandbox" USING btree ("doName");
--> statement-breakpoint
CREATE INDEX "agent_session_owner_activity" ON "AgentSession" USING btree ("ownerId","updatedAt");
--> statement-breakpoint
CREATE UNIQUE INDEX "agent_terminal_generation_name" ON "AgentTerminal" USING btree ("sessionId","generation","tmuxName");
