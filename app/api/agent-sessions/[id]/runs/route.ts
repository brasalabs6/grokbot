import { auth } from "@/app/(auth)/auth";
import { submitPromptSchema } from "@/lib/agent/contracts";
import { hashPrompt, signRunPermit } from "@/lib/agent/run-permit";
import { acceptAgentRun, AgentConflict } from "@/lib/db/agent-queries";
import { z } from "zod";
type Params={params:Promise<{id:string}>};

export async function POST(request:Request,{params}:Params) {
  const logged=await auth();
  if(!logged?.user||logged.user.type==="guest")
    return Response.json({error:{code:"FORBIDDEN"}},{status:403});
  if(process.env.FEATURE_AGENT_RUNTIME!=="1")
    return Response.json({error:{code:"RUNTIME_DISABLED"}},{status:503});
  if(!process.env.RUNTIME_TICKET_SECRET||process.env.RUNTIME_TICKET_SECRET.length<32)
    return Response.json({error:{code:"RUN_DISPATCH_NOT_CONFIGURED"}},{status:503});
  if(request.headers.get("Origin")!==new URL(request.url).origin)
    return Response.json({error:{code:"INVALID_ORIGIN"}},{status:403});
  const {id}=await params;
  if(!z.uuid().safeParse(id).success)
    return Response.json({error:{code:"NOT_FOUND"}},{status:404});
  const parsed=submitPromptSchema.safeParse(await request.json().catch(()=>null));
  if(!parsed.success)
    return Response.json({error:{code:"INVALID_RUN_INPUT"}},{status:400});
  const requestHash=hashPrompt(parsed.data.parts);
  try {
    const accepted=await acceptAgentRun({
      sessionId:id,ownerId:logged.user.id,
      idempotencyKey:parsed.data.clientMessageId,
      requestHash,input:parsed.data
    });
    if(!accepted)return Response.json({error:{code:"NOT_FOUND"}},{status:404});
    const permit=signRunPermit({
      sessionId:id,userId:logged.user.id,runId:accepted.run.id,
      generation:accepted.run.generation,promptHash:requestHash
    });
    return Response.json({
      runId:accepted.run.id,generation:accepted.run.generation,
      duplicate:accepted.duplicate,permit:permit.permit,expiresAt:permit.expiresAt
    },{status:202,headers:{"Cache-Control":"no-store"}});
  }catch(error){
    if(error instanceof AgentConflict)
      return Response.json({error:{code:error.code}},{status:409});
    throw error;
  }
}
