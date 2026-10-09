import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { AgentConflict, getAgentSession, recordProvisionedSandbox, setAgentSessionState } from "@/lib/db/agent-queries";
import { RuntimeApiError, startRuntime } from "@/lib/agent/runtime-client";

const inputSchema=z.object({
  operationId:z.uuid(),
  expectedSessionVersion:z.number().int().positive()
}).strict();
type Params={params:Promise<{id:string}>};

/**
 * P02 provisional endpoint: starts a container but deliberately stays in
 * PROVISIONING until the long-lived ACP adapter passes its health gate.
 * It must not claim READY after a container.start() acknowledgement.
 */
export async function POST(request:Request,{params}:Params){
  const logged=await auth();
  if(!logged?.user||logged.user.type==="guest")
    return Response.json({error:{code:"FORBIDDEN"}},{status:403});
  if(process.env.FEATURE_AGENT_RUNTIME!=="1")
    return Response.json({error:{code:"RUNTIME_DISABLED"}},{status:503});
  const origin=request.headers.get("Origin");
  if(origin&&origin!==new URL(request.url).origin)
    return Response.json({error:{code:"INVALID_ORIGIN"}},{status:403});
  const {id}=await params;
  if(!z.uuid().safeParse(id).success)
    return Response.json({error:{code:"NOT_FOUND"}},{status:404});
  const input=inputSchema.safeParse(await request.json().catch(()=>null));
  if(!input.success)return Response.json({error:{code:"VALIDATION_ERROR"}},{status:400});
  const session=await getAgentSession(id,logged.user.id);
  if(!session)return Response.json({error:{code:"NOT_FOUND"}},{status:404});
  if(session.state!=="CREATED")
    return Response.json({error:{code:"SESSION_NOT_STARTABLE",state:session.state}},{status:409});
  if(session.stateVersion!==input.data.expectedSessionVersion)
    return Response.json({error:{code:"VERSION_CONFLICT"}},{status:409});

  let claimed;
  try{
    claimed=await setAgentSessionState({
      sessionId:id,ownerId:logged.user.id,from:"CREATED",
      to:"PROVISIONING",version:session.stateVersion,generation:session.generation
    });
  }catch(error){
    if(error instanceof AgentConflict)
      return Response.json({error:{code:error.code}},{status:409});
    throw error;
  }

  try{
    const runtime=await startRuntime(id,input.data.operationId);
    if(!runtime.running||!Number.isSafeInteger(runtime.generation)||runtime.generation<1)
      throw new RuntimeApiError("RUNTIME_START_UNCONFIRMED",502);
    const updated=await recordProvisionedSandbox({
      sessionId:id,ownerId:logged.user.id,
      expectedVersion:claimed.stateVersion,generation:runtime.generation
    });
    return Response.json({
      sessionId:id,state:updated?.state??"PROVISIONING",
      generation:runtime.generation,operationId:input.data.operationId,
      message:"Sandbox requested; awaiting persistent ACP initialization."
    },{status:202});
  }catch(error){
    // A timeout may have started the container: do not assume it is stopped.
    const uncertain=error instanceof RuntimeApiError &&
      ["RUNTIME_TIMEOUT","RUNTIME_UNREACHABLE"].includes(error.code);
    try{
      await setAgentSessionState({
        sessionId:id,ownerId:logged.user.id,from:"PROVISIONING",
        to:uncertain?"RECOVERING":"FAILED",version:claimed.stateVersion
      });
    }catch{
      // A reconciliation workflow must resolve a concurrently updated state.
    }
    return Response.json({
      error:{code:uncertain?"RUNTIME_OUTCOME_UNKNOWN":
        error instanceof RuntimeApiError?error.code:"RUNTIME_START_FAILED"}
    },{status:uncertain?503:502});
  }
}
