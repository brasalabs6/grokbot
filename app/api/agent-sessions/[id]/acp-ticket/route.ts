import { auth } from "@/app/(auth)/auth";
import { z } from "zod";
import { getAgentSession } from "@/lib/db/agent-queries";
import { getRuntimeStatus, RuntimeApiError, runtimeConfiguration } from "@/lib/agent/runtime-client";
import { createAcpTicket } from "@/lib/agent/acp-ticket";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, {params}:Params) {
  const logged = await auth();
  if(!logged?.user || logged.user.type==="guest")
    return Response.json({error:{code:"FORBIDDEN"}},{status:403});
  if(process.env.FEATURE_AGENT_RUNTIME!=="1")
    return Response.json({error:{code:"RUNTIME_DISABLED"}},{status:503});
  if(request.headers.get("Origin")!==new URL(request.url).origin)
    return Response.json({error:{code:"INVALID_ORIGIN"}},{status:403});
  const {id}=await params;
  if(!z.uuid().safeParse(id).success)
    return Response.json({error:{code:"NOT_FOUND"}},{status:404});
  const session=await getAgentSession(id,logged.user.id);
  if(!session)return Response.json({error:{code:"NOT_FOUND"}},{status:404});
  if(!["PROVISIONING","READY","RUNNING","IDLE","WAITING_APPROVAL","DEGRADED"].includes(session.state) ||
      session.generation<1) {
    return Response.json({error:{code:"SANDBOX_NOT_READY"}},{status:409});
  }
  try {
    const current=await getRuntimeStatus(id);
    if(!current.running||current.generation!==session.generation)
      return Response.json({error:{code:"SANDBOX_GENERATION_MISMATCH"}},{status:409});
    const {token,expiresAt}=createAcpTicket({
      sessionId:id,userId:logged.user.id,generation:session.generation
    });
    const {baseURL}=runtimeConfiguration();
    const socketURL=new URL("/ws/acp/"+id,baseURL);
    socketURL.protocol="wss:";
    return Response.json({
      url:socketURL.toString(),
      protocol:"grokbot-acp."+token,
      expiresAt,
      generation:session.generation,
      acpSessionId:current.acpSessionId??null
    },{headers:{"Cache-Control":"no-store"}});
  }catch(error) {
    return Response.json({
      error:{code:error instanceof RuntimeApiError?error.code:"ACP_TICKET_ISSUANCE_FAILED"}
    },{status:503});
  }
}
