"use client";
import {
  Activity,
  FolderTree,
  MessageSquare,
  TerminalSquare,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { AcpChat } from "./acp-chat";

type Panel = "chat" | "terminal" | "files" | "activity";
export function SessionDetail({
  id,
  initialState,
  generation,
  modelId,
  stateVersion,
}: {
  id: string;
  initialState: string;
  generation: number;
  modelId: string;
  stateVersion: number;
}) {
  const router = useRouter();
  const [panel, setPanel] = useState<Panel>("chat");
  const [startBusy,setStartBusy] = useState(false);
  const [startError,setStartError] = useState<string|null>(null);
  const [currentState,setCurrentState] = useState(initialState);
  async function startContainer() {
    setStartBusy(true);
    setStartError(null);
    try {
      const response=await fetch("/api/agent-sessions/"+id+"/start",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          operationId:crypto.randomUUID(),
          expectedSessionVersion:stateVersion
        })
      });
      const result=await response.json() as {error?:{code?:string};state?:string};
      if(!response.ok)throw new Error(result.error?.code??"RUNTIME_START_FAILED");
      setCurrentState(result.state??"PROVISIONING");
      router.refresh();
    } catch(error) {
      setStartError(error instanceof Error?error.message:"Unexpected error");
    } finally {
      setStartBusy(false);
    }
  }
  const [events, setEvents] = useState<
    { seq: number; type: string; createdAt: string }[]
  >([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (panel !== "activity") {
      return;
    }
    let active = true;
    void fetch(`/api/agent-sessions/${id}/events?after=0`)
      .then(async (response) => {
        const body = (await response.json()) as {
          error?: { code?: string };
          events?: { seq: number; type: string; createdAt: string }[];
        };
        if (!response.ok) {
          throw new Error(body.error?.code ?? "Unable to load activity");
        }
        if (active) {
          setEvents(body.events ?? []);
        }
      })
      .catch((e) => {
        if (active) {
          setError(e instanceof Error ? e.message : "Error");
        }
      });
    return () => {
      active = false;
    };
  }, [id, panel]);
  const tabs: [Panel, React.ReactNode][] = [
    ["chat", <MessageSquare className="size-4" key="chat" />],
    ["terminal", <TerminalSquare className="size-4" key="terminal" />],
    ["files", <FolderTree className="size-4" key="files" />],
    ["activity", <Activity className="size-4" key="activity" />],
  ];
  return (
    <div className="flex flex-1 flex-col gap-4 p-4 md:p-8">
      <div
        aria-label="Session panels"
        className="flex flex-wrap gap-2"
        role="tablist"
      >
        {tabs.map(([key, icon]) => (
          <Button
            aria-selected={key === panel}
            key={key}
            onClick={() => setPanel(key)}
            role="tab"
            variant={panel === key ? "default" : "outline"}
          >
            {icon}
            <span className="ml-2 capitalize">{key}</span>
          </Button>
        ))}
      </div>
      <div
        className="flex min-h-[400px] flex-1 flex-col rounded-xl border p-4 md:p-6"
        role="tabpanel"
      >
        <p className="mb-4 text-xs text-muted-foreground">
          Session {id} · {modelId} · Generation {generation}
        </p>
        {panel === "chat" && (
          <>
            {currentState === "CREATED" && (
              <div className="grid flex-1 place-content-center text-center">
                <h2 className="font-semibold">Start your Grok workspace</h2>
                <p className="mt-2 max-w-md text-sm text-muted-foreground">
                  The Cloudflare sandbox is provisioned on demand. The agent connects
                  over a signed, short-lived ACP WebSocket capability.
                </p>
                <Button className="mx-auto mt-4" disabled={startBusy}
                  onClick={()=>void startContainer()}>
                  {startBusy?"Requesting sandbox…":"Provision Cloudflare sandbox"}
                </Button>
                {startError && <p role="alert" className="mt-3 text-sm text-red-500">
                  {startError}
                </p>}
              </div>
            )}
            <AcpChat sessionId={id}
              active={["PROVISIONING","READY","IDLE","RUNNING","WAITING_APPROVAL","DEGRADED"].includes(currentState)}/>
          </>
        )}
        {panel === "terminal" && (
          <div className="grid flex-1 place-content-center text-center">
            <TerminalSquare className="mx-auto mb-3 size-7 text-muted-foreground" />
            <h2 className="font-semibold">Terminal unavailable</h2>
            <p className="mt-2 max-w-md text-sm text-muted-foreground">
              A PTY will become accessible only when this session has a running
              sandbox and a valid terminal ticket.
            </p>
          </div>
        )}
        {panel === "files" && (
          <div className="grid flex-1 place-content-center text-center">
            <h2 className="font-semibold">Workspace offline</h2>
            <p className="mt-2 max-w-md text-sm text-muted-foreground">
              The sandbox must be provisioned before files can be accessed.
            </p>
          </div>
        )}
        {panel === "activity" && (
          <div>
            {error && <p role="alert">{error}</p>}
            {events.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No recorded events yet.
              </p>
            ) : (
              events.map((event) => (
                <div className="border-b py-2 text-sm" key={event.seq}>
                  <span className="font-mono text-xs text-muted-foreground">
                    #{event.seq}
                  </span>{" "}
                  {event.type}{" "}
                  <span className="text-xs text-muted-foreground">
                    {new Date(event.createdAt).toLocaleString()}
                  </span>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
