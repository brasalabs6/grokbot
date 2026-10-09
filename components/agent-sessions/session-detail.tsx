"use client";
import {
  Activity,
  FolderTree,
  MessageSquare,
  TerminalSquare,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type Panel = "chat" | "terminal" | "files" | "activity";
export function SessionDetail({
  id,
  initialState,
  generation,
  modelId,
}: {
  id: string;
  initialState: string;
  generation: number;
  modelId: string;
}) {
  const [panel, setPanel] = useState<Panel>("chat");
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
          <div className="grid flex-1 place-content-center text-center">
            <h2 className="font-semibold">Agent not connected</h2>
            <p className="mt-2 max-w-md text-sm text-muted-foreground">
              State: {initialState}. Sending prompts is disabled until
              Cloudflare provisioning and the ACP handshake are verified. The
              legacy chatbot remains available separately.
            </p>
          </div>
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
