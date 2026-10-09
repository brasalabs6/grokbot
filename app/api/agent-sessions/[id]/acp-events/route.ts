import { auth } from "@/app/(auth)/auth";
import { z } from "zod";
import { getAgentSession } from "@/lib/db/agent-queries";
import { getRuntimeAcpEvents, RuntimeApiError } from "@/lib/agent/runtime-client";

type Params={params:Promise<{id:string}>};
export async function GET(request:Request,{params}:Params) {
  const logged=await auth();
  if(!logged?.user||logged.user.type==="guest")
    return Response.json({error:{code:"UNAUTHENTICATED"}},{status:401});
  if(process.env.FEATURE_AGENT_RUNTIME!=="1")
    return Response.json({error:{code:"RUNTIME_DISABLED"}},{status:503});
  const {id}=await params;
  if(!z.uuid().safeParse(id).success)
    return Response.json({error:{code:"NOT_FOUND"}},{status:404});
  if(!await getAgentSession(id,logged.user.id))
    return Response.json({error:{code:"NOT_FOUND"}},{status:404});
  const raw=new URL(request.url).searchParams.get("after")??"0";
  if(!/^(0|[1-9]\d{0,9})$/.test(raw))
    return Response.json({error:{code:"INVALID_CURSOR"}},{status:400});
  try{
    const result=await getRuntimeAcpEvents(id,Number(raw));
    return Response.json(result,{headers:{"Cache-Control":"no-store"}});
  }catch(error) {
    return Response.json({error:{
      code:error instanceof RuntimeApiError?error.code:"ACP_EVENTS_UNAVAILABLE"
    }},{status:503});
  }
}
