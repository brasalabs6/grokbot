import "server-only";
import { createHmac, createHash } from "node:crypto";
import type { SubmitPromptInput } from "./contracts";

export function hashPrompt(parts: SubmitPromptInput["parts"]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

export function signRunPermit(args: {
  sessionId: string; userId: string; runId: string; generation: number;
  promptHash: string;
}):{permit:string;expiresAt:string} {
  const secret=process.env.RUNTIME_TICKET_SECRET;
  if(!secret||secret.length<32)throw new Error("RUN_SIGNING_KEY_NOT_CONFIGURED");
  const exp=Date.now()+60_000;
  const body={
    purpose:"run-dispatch",sessionId:args.sessionId,runId:args.runId,
    userId:args.userId,generation:args.generation,promptHash:args.promptHash,
    jti:crypto.randomUUID(),exp
  };
  const encoded=Buffer.from(JSON.stringify(body)).toString("base64url");
  const sig=createHmac("sha256",secret).update(encoded).digest("base64url");
  return {permit:encoded+"."+sig,expiresAt:new Date(exp).toISOString()};
}
