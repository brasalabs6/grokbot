import { auth } from "@/app/(auth)/auth";
import { z } from "zod";
import { AgentConflict, confirmAgentReady, getAgentSession } from "@/lib/db/agent-queries";
import { getRuntimeStatus, RuntimeApiError } from "@/lib/agent/runtime-client";

type Params={params:Promise<{id:string}>};

/** Reconcile after successful ACP session/new or load, not after container.start(). */
export async function POST(request:Request,{params}:Params) {
  const user=await auth();
  if(!user?.user||user.user.type==="guest")
    return Response.json({error:{code:"FORBIDDEN"}},{status:403});
  if(process.env.FEATURE_AGENT_RUNTIME!=="1")
    return Response.json({error:{code:"RUNTIME_DISABLED"}},{status:503});
  if(request.headers.get("Origin")!==new URL(request.url).origin)
    return Response.json({error:{code:"INVALID_ORIGIN"}},{status:403});
  const {id}=await params;
  if(!z.uuid().safeParse(id).success)
    return Response.json({error:{code:"NOT_FOUND"}},{status:404});
  const session=await getAgentSession(id,user.user.id);
  if(!session)return Response.json({error:{code:"NOT_FOUND"}},{status:404});
  try {
    const state=await getRuntimeStatus(id);
    if(!state.running || state.generation!==session.generation ||
       !state.acpSessionId || state.acpHealthyGeneration!==state.generation) {
      return Response.json({error:{code:"ACP_NOT_HEALTHY"}},{status:409});
    }
    const ready=await confirmAgentReady({
      sessionId:id,ownerId:user.user.id,generation:state.generation
    });
    return Response.json({session:ready,acpSessionId:state.acpSessionId});
  } catch(error){
    if(error instanceof AgentConflict)
      return Response.json({error:{code:error.code}},{status:409});
    return Response.json({error:{
      code:error instanceof RuntimeApiError?error.code:"RECONCILE_FAILED"
    }},{status:503});
  }
}
