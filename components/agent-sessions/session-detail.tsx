"use client";
import {
  Activity,
  FolderTree,
  MessageSquare,
  TerminalSquare,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { AcpChat } from "./acp-chat";
import { AgentTerminal } from "./agent-terminal";
import { FileBrowser } from "./file-browser";

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
  const [startBusy, setStartBusy] = useState(false);
  const [stopBusy, setStopBusy] = useState(false);
  const [pendingStopOperation, setPendingStopOperation] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [currentState, setCurrentState] = useState(initialState);
  useEffect(() => {
    setCurrentState(initialState);
  }, [initialState]);

  async function stopContainer() {
    if (!window.confirm("Stop this sandbox after taking a checkpoint? Run only when there is no active agent task.")) {
      return;
    }
    const operationId = crypto.randomUUID();
    setPendingStopOperation(operationId);
    setStopBusy(true);
    setStartError(null);
    try {
      const response = await fetch(`/api/agent-sessions/${id}/stop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedSessionVersion: stateVersion,
          operationId,
          checkpoint: true,
        }),
      });
      const payload = (await response.json()) as {
        state?: string;
        error?: { code?: string };
      };
      if (!response.ok) {
        throw new Error(payload.error?.code ?? "STOP_OUTCOME_UNKNOWN");
      }
      setCurrentState(payload.state ?? "STOPPED");
      setPendingStopOperation(null);
      router.refresh();
    } catch (e) {
      setStartError(e instanceof Error ? e.message : "Stop outcome unknown");
      router.refresh();
    } finally {
      setStopBusy(false);
    }
  }
  async function reconcileStop() {
    if (!pendingStopOperation) return;
    setStopBusy(true);
    setStartError(null);
    try {
      const response = await fetch(`/api/agent-sessions/${id}/stop/reconcile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operationId: pendingStopOperation }),
      });
      const result = (await response.json()) as {
        state?: string;
        error?: { code?: string };
      };
      if (!response.ok) throw new Error(result.error?.code ?? "STOP_NOT_CONFIRMED");
      setCurrentState(result.state ?? "STOPPED");
      setPendingStopOperation(null);
      router.refresh();
    } catch (e) {
      setStartError(e instanceof Error ? e.message : "Stop not confirmed");
    } finally {
      setStopBusy(false);
    }
  }

  async function startContainer() {
    setStartBusy(true);
    setStartError(null);
    try {
      const response = await fetch("/api/agent-sessions/" + id + "/start", {
        body: JSON.stringify({
          expectedSessionVersion: stateVersion,
          operationId: crypto.randomUUID(),
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const result = (await response.json()) as {
        error?: { code?: string };
        state?: string;
      };
      if (!response.ok) {
        throw new Error(result.error?.code ?? "RUNTIME_START_FAILED");
      }
      setCurrentState(result.state ?? "PROVISIONING");
      router.refresh();
    } catch (error) {
      setStartError(
        error instanceof Error ? error.message : "Unexpected error"
      );
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
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            Session {id} · {modelId} · Generation {generation} · {currentState}
          </p>
          {pendingStopOperation && (
            <Button disabled={stopBusy} onClick={() => void reconcileStop()} size="sm" variant="outline">
              Verify stop outcome
            </Button>
          )}
          {["READY", "IDLE", "DEGRADED"].includes(currentState) && !pendingStopOperation && (
            <Button
              disabled={stopBusy || startBusy}
              onClick={() => void stopContainer()}
              size="sm"
              variant="outline"
            >
              {stopBusy ? "Stopping…" : "Stop and checkpoint"}
            </Button>
          )}
        </div>
        {startError && <p className="mb-3 text-sm text-red-500" role="alert">{startError}</p>}
        {panel === "chat" && (
          <>
            {["CREATED", "STOPPED", "SUSPENDED"].includes(currentState) && (
              <div className="grid flex-1 place-content-center text-center">
                <h2 className="font-semibold">Start your Grok workspace</h2>
                <p className="mt-2 max-w-md text-sm text-muted-foreground">
                  The Cloudflare sandbox is provisioned on demand. The agent
                  connects over a signed, short-lived ACP WebSocket capability.
                </p>
                <Button
                  className="mx-auto mt-4"
                  disabled={startBusy}
                  onClick={() => void startContainer()}
                >
                  {startBusy
                    ? "Requesting sandbox…"
                    : currentState === "CREATED"
                      ? "Provision Cloudflare sandbox"
                      : "Resume Cloudflare sandbox"}
                </Button>
              </div>
            )}
            <AcpChat
              active={[
                "PROVISIONING",
                "READY",
                "IDLE",
                "RUNNING",
                "WAITING_APPROVAL",
                "DEGRADED",
              ].includes(currentState)}
              sessionId={id}
            />
          </>
        )}
        {panel === "terminal" && (
          <AgentTerminal
            active={[
              "PROVISIONING",
              "READY",
              "IDLE",
              "RUNNING",
              "WAITING_APPROVAL",
              "DEGRADED",
            ].includes(currentState)}
            sessionId={id}
          />
        )}
        {panel === "files" && (
          <FileBrowser
            active={[
              "PROVISIONING",
              "READY",
              "IDLE",
              "RUNNING",
              "WAITING_APPROVAL",
              "DEGRADED",
            ].includes(currentState)}
            sessionId={id}
          />
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
