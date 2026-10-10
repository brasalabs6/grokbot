"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type RpcMessage = {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message?: string };
};
type Approval = {
  id: number | string;
  options: { optionId: string; name: string; kind?: string }[];
  title: string;
};
type ChatEntry = {
  id: string;
  role: "user" | "assistant" | "tool";
  text: string;
};
type Ticket = {
  url: string;
  protocol: string;
  generation: number;
  acpSessionId?: string | null;
  error?: { code?: string };
};

function updateEntries(
  prev: ChatEntry[],
  chunk: string,
  role: ChatEntry["role"]
): ChatEntry[] {
  if (!chunk) {
    return prev;
  }
  const last = prev.at(-1);
  if (last?.role === role && role === "assistant") {
    return [...prev.slice(0, -1), { ...last, text: last.text + chunk }];
  }
  return [...prev, { id: crypto.randomUUID(), role, text: chunk }];
}

/** A real ACP client: JSON-RPC over an authenticated Cloudflare WebSocket. */
export function AcpChat({
  sessionId,
  active,
}: {
  sessionId: string;
  active: boolean;
}) {
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [draft, setDraft] = useState("");
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approval, setApproval] = useState<Approval | null>(null);
  const socket = useRef<WebSocket | null>(null);
  const session = useRef<string | null>(null);
  const counter = useRef(0);
  const pending = useRef(
    new Map<
      number,
      {
        resolve: (result: unknown) => void;
        reject: (error: Error) => void;
      }
    >()
  );
  const replayCursor = useRef(0);

  const rpc = useCallback(
    (method: string, params: Record<string, unknown>) =>
      new Promise<unknown>((resolve, reject) => {
        const ws = socket.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          reject(new Error("ACP_DISCONNECTED"));
          return;
        }
        const id = ++counter.current;
        pending.current.set(id, { reject, resolve });
        ws.send(JSON.stringify({ id, jsonrpc: "2.0", method, params }));
      }),
    []
  );

  const onProtocolMessage = useCallback((raw: string) => {
    let message: RpcMessage;
    try {
      message = JSON.parse(raw) as RpcMessage;
    } catch {
      return;
    }
    if (message.method === "grokbot/event_cursor") {
      const seq = message.params?.seq;
      if (typeof seq === "number" && Number.isSafeInteger(seq) && seq >= 0) {
        replayCursor.current = Math.max(replayCursor.current, seq);
      }
      return;
    }
    if (
      message.id !== undefined &&
      message.method === "session/request_permission"
    ) {
      const params = message.params ?? {};
      const options = Array.isArray(params.options)
        ? (params.options as Approval["options"])
        : [];
      const title =
        typeof params.title === "string"
          ? params.title
          : "Grok requests tool permission";
      setApproval({ id: message.id, options, title });
      return;
    }
    if (
      typeof message.id === "number" &&
      (message.result !== undefined || message.error)
    ) {
      const waiter = pending.current.get(message.id);
      if (!waiter) {
        return;
      }
      pending.current.delete(message.id);
      if (message.error) {
        waiter.reject(new Error(message.error.message ?? "ACP_RPC_ERROR"));
      } else {
        waiter.resolve(message.result);
      }
      return;
    }
    if (
      message.method !== "session/update" &&
      message.method !== "x.ai/session/update"
    ) {
      return;
    }
    const update = message.params?.update as
      | Record<string, unknown>
      | undefined;
    if (!update) {
      return;
    }
    const kind = update.sessionUpdate;
    if (kind === "agent_message_chunk") {
      const text = (update.content as { text?: unknown } | undefined)?.text;
      if (typeof text === "string") {
        setEntries((prev) => updateEntries(prev, text, "assistant"));
      }
    } else if (kind === "tool_call") {
      const title =
        typeof update.title === "string" ? update.title : "Tool call";
      setEntries((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "tool",
          text: "Started: " + title,
        },
      ]);
    } else if (kind === "tool_call_update") {
      const title =
        typeof update.title === "string" ? update.title : "Tool update";
      const status =
        typeof update.status === "string" ? update.status : "updated";
      setEntries((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "tool",
          text: title + " — " + status,
        },
      ]);
    }
  }, []);

  useEffect(() => {
    if (!active) {
      return;
    }
    let disposed = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let reconnectAttempt = 0;
    const outstanding = pending.current;

    const restoreEvents = async () => {
      // Replay persisted events before starting the live socket. Deduplication
      // across the snapshot/live boundary is the next reconciliation milestone.
      try {
        const response = await fetch(
          "/api/agent-sessions/" +
            sessionId +
            "/acp-events?after=" +
            replayCursor.current,
          { cache: "no-store" }
        );
        if (!response.ok) {
          return;
        }
        const payload = (await response.json()) as {
          events?: { seq: number; message: RpcMessage }[];
          cursor?: number;
        };
        for (const event of payload.events ?? []) {
          if (event.seq <= replayCursor.current) {
            continue;
          }
          replayCursor.current = event.seq;
          if (event.message.method === "session/prompt") {
            const parts = event.message.params?.prompt;
            if (Array.isArray(parts)) {
              const text = parts
                .map((p) =>
                  p?.type === "text" && typeof p.text === "string" ? p.text : ""
                )
                .filter(Boolean)
                .join("\n");
              if (text) {
                setEntries((prev) => [
                  ...prev,
                  {
                    id: crypto.randomUUID(),
                    role: "user",
                    text,
                  },
                ]);
              }
            }
          } else if (event.message.method === "session/update") {
            onProtocolMessage(JSON.stringify(event.message));
          }
        }
      } catch {
        // User still gets live streaming; diagnostics surface via session state.
      }
    };
    const connect = async () => {
      try {
        await restoreEvents();
        const response = await fetch(
          "/api/agent-sessions/" + sessionId + "/acp-ticket",
          {
            body: "{}",
            cache: "no-store",
            headers: { "Content-Type": "application/json" },
            method: "POST",
          }
        );
        const ticket = (await response.json()) as Ticket;
        if (!response.ok) {
          throw new Error(ticket.error?.code ?? "ACP_TICKET_FAILED");
        }
        if (disposed) {
          return;
        }
        const ws = new WebSocket(ticket.url, [ticket.protocol]);
        socket.current = ws;
        ws.addEventListener("open", () => {
          if (disposed) {
            ws.close();
            return;
          }
          void (async () => {
            try {
              await rpc("initialize", {
                clientCapabilities: {
                  fs: { readTextFile: false, writeTextFile: false },
                  terminal: false,
                },
                clientInfo: { name: "GrokBot", version: "1.0.0" },
                protocolVersion: 1,
              });
              let result: unknown;
              const resumed = session.current ?? ticket.acpSessionId;
              if (resumed) {
                try {
                  result = await rpc("session/load", {
                    cwd: "/workspace",
                    mcpServers: [],
                    sessionId: resumed,
                  });
                  session.current = resumed;
                } catch {
                  result = undefined;
                }
              }
              if (!result) {
                result = await rpc("session/new", {
                  _meta: { yoloMode: false },
                  cwd: "/workspace",
                  mcpServers: [],
                });
                const created = (result as { sessionId?: string } | null)
                  ?.sessionId;
                if (!created) {
                  throw new Error("ACP_SESSION_NEW_FAILED");
                }
                session.current = created;
              }
              // The ACP transport being connected does NOT mean the session
              // database is READY. Await the control plane's generation-fenced
              // confirmation, rather than racing the user's first prompt.
              let confirmed = false;
              for (let attempt = 0; attempt < 6 && !disposed; attempt++) {
                const response = await fetch(
                  "/api/agent-sessions/" + sessionId + "/reconcile",
                  {
                    body: "{}",
                    cache: "no-store",
                    headers: { "Content-Type": "application/json" },
                    method: "POST",
                  }
                );
                if (response.ok) {
                  confirmed = true;
                  break;
                }
                if (response.status !== 409) {
                  const payload = (await response.json().catch(() => null)) as {
                    error?: { code?: string };
                  } | null;
                  throw new Error(
                    payload?.error?.code ?? "ACP_RECONCILE_FAILED"
                  );
                }
                await new Promise((resolve) =>
                  setTimeout(resolve, 400 * (attempt + 1))
                );
              }
              if (!confirmed) {
                throw new Error("ACP_RECONCILIATION_PENDING");
              }
              if (!disposed) {
                reconnectAttempt = 0;
                setConnected(true);
                setError(null);
              }
            } catch (err) {
              if (!disposed) {
                setError(
                  err instanceof Error ? err.message : "ACP_INIT_FAILED"
                );
              }
              ws.close();
            }
          })();
        });
        ws.addEventListener("message", (event) => {
          if (typeof event.data === "string") {
            onProtocolMessage(event.data);
          }
        });
        ws.addEventListener("close", () => {
          if (socket.current === ws) {
            socket.current = null;
          }
          setConnected(false);
          for (const waiter of outstanding.values()) {
            waiter.reject(new Error("ACP_CONNECTION_LOST"));
          }
          outstanding.clear();
          if (!disposed) {
            setBusy(false);
            reconnectAttempt = Math.min(6, reconnectAttempt + 1);
            retryTimer = setTimeout(
              () => void connect(),
              Math.min(30_000, 1000 * 2 ** reconnectAttempt)
            );
          }
        });
        ws.addEventListener("error", () => {
          if (!disposed) {
            setError("ACP_SOCKET_ERROR");
          }
        });
      } catch (err) {
        if (disposed) {
          return;
        }
        setConnected(false);
        setError(err instanceof Error ? err.message : "ACP_CONNECT_FAILED");
        reconnectAttempt = Math.min(6, reconnectAttempt + 1);
        retryTimer = setTimeout(
          () => void connect(),
          Math.min(30_000, 1000 * 2 ** reconnectAttempt)
        );
      }
    };
    void connect();
    return () => {
      disposed = true;
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
      socket.current?.close();
      socket.current = null;
      for (const waiter of outstanding.values()) {
        waiter.reject(new Error("ACP_CLOSED"));
      }
      outstanding.clear();
    };
  }, [active, sessionId, rpc, onProtocolMessage]);

  async function sendPrompt() {
    const text = draft.trim();
    if (!text || !session.current || busy || !connected) {
      return;
    }
    setBusy(true);
    setError(null);
    let accepted = false;
    try {
      const current = await fetch("/api/agent-sessions/" + sessionId, {
        cache: "no-store",
      });
      const record = (await current.json()) as {
        session?: { state: string; stateVersion: number };
        error?: { code?: string };
      };
      if (!current.ok || !record.session) {
        throw new Error(record.error?.code ?? "SESSION_UNAVAILABLE");
      }
      if (!["READY", "IDLE"].includes(record.session.state)) {
        throw new Error("SESSION_NOT_READY");
      }
      const messageId = crypto.randomUUID();
      const parts = [{ text, type: "text" }];
      const submitted = await fetch(
        "/api/agent-sessions/" + sessionId + "/runs",
        {
          body: JSON.stringify({
            clientMessageId: messageId,
            expectedSessionVersion: record.session.stateVersion,
            parts,
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }
      );
      const reservation = (await submitted.json()) as {
        runId?: string;
        permit?: string;
        error?: { code?: string };
      };
      if (!submitted.ok || !reservation.permit || !reservation.runId) {
        throw new Error(reservation.error?.code ?? "RUN_NOT_ACCEPTED");
      }
      // The reservation is now authoritative. Never auto-retry the prompt:
      // a disconnect may mean the agent is still running inside Cloudflare.
      accepted = true;
      setDraft("");
      setEntries((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "user", text },
      ]);
      await rpc("grokbot/dispatch", {
        permit: reservation.permit,
        prompt: parts,
        sessionId: session.current,
      });
      // Wait for the authoritative run result before enabling another prompt.
      const settled = await fetch(
        "/api/agent-sessions/" +
          sessionId +
          "/runs/" +
          reservation.runId +
          "/reconcile",
        {
          body: "{}",
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }
      );
      if (!settled.ok) {
        const body = (await settled.json()) as { error?: { code?: string } };
        throw new Error(body.error?.code ?? "RUN_RECONCILIATION_PENDING");
      }
    } catch (err) {
      setError(
        (err instanceof Error ? err.message : "PROMPT_FAILED") +
          (accepted
            ? " — outcome may be unknown; check activity before retrying."
            : "")
      );
    } finally {
      setBusy(false);
    }
  }
  function cancel() {
    if (
      !session.current ||
      !socket.current ||
      socket.current.readyState !== WebSocket.OPEN
    ) {
      return;
    }
    socket.current.send(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "session/cancel",
        params: { sessionId: session.current },
      })
    );
  }
  function resolvePermission(optionId?: string) {
    const ws = socket.current;
    if (!approval || !ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }
    const outcome = optionId
      ? { optionId, outcome: "selected" }
      : { outcome: "cancelled" };
    ws.send(
      JSON.stringify({ id: approval.id, jsonrpc: "2.0", result: { outcome } })
    );
    setApproval(null);
  }

  if (!active) {
    return (
      <div className="grid flex-1 place-content-center text-sm text-muted-foreground">
        Start the sandbox to connect Grok ACP.
      </div>
    );
  }
  return (
    <div className="flex min-h-[350px] flex-1 flex-col gap-3">
      <div
        aria-live="polite"
        className="flex items-center gap-2 text-xs text-muted-foreground"
      >
        <span className={connected ? "text-emerald-500" : "text-amber-500"}>
          ●
        </span>
        {connected ? "ACP connected" : "Connecting to Grok ACP…"}
        {busy && " · Agent running"}
      </div>
      <div
        aria-label="ACP conversation"
        className="min-h-0 flex-1 space-y-3 overflow-auto rounded-md bg-muted/15 p-3"
        role="log"
      >
        {entries.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Messages, tool calls and agent replies from the Cloudflare sandbox
            appear here.
          </p>
        )}
        {entries.map((e) => (
          <div
            className={
              "max-w-[95%] rounded-xl border px-3 py-2 text-sm whitespace-pre-wrap break-words " +
              (e.role === "user"
                ? "ml-auto bg-primary text-primary-foreground"
                : e.role === "tool"
                  ? "bg-muted text-xs text-muted-foreground"
                  : "bg-background")
            }
            key={e.id}
          >
            <div className="mb-1 text-[11px] opacity-60">
              {e.role === "user" ? "You" : e.role === "tool" ? "Tool" : "Grok"}
            </div>
            {e.text}
          </div>
        ))}
      </div>
      {approval && (
        <div
          aria-label="Tool permission requested"
          className="rounded-lg border border-amber-400 p-3"
          role="alertdialog"
        >
          <p className="mb-2 text-sm font-medium">{approval.title}</p>
          <div className="flex flex-wrap gap-2">
            {approval.options.map((option) => (
              <Button
                key={option.optionId}
                onClick={() => resolvePermission(option.optionId)}
                size="sm"
                variant={option.kind === "reject_once" ? "outline" : "default"}
              >
                {option.name}
              </Button>
            ))}
            <Button
              onClick={() => resolvePermission()}
              size="sm"
              variant="outline"
            >
              Deny
            </Button>
          </div>
        </div>
      )}
      {error && (
        <p className="text-xs text-red-500" role="alert">
          {error}
        </p>
      )}
      <label className="sr-only" htmlFor="agent-prompt">
        Message Grok
      </label>
      <Textarea
        disabled={!connected || busy}
        id="agent-prompt"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void sendPrompt();
          }
        }}
        placeholder="Ask Grok to write code, inspect files, or execute a task…"
        rows={3}
        value={draft}
      />
      <div className="flex justify-end gap-2">
        {busy && (
          <Button onClick={cancel} variant="outline">
            Cancel
          </Button>
        )}
        <Button
          disabled={!connected || busy || !draft.trim()}
          onClick={() => void sendPrompt()}
        >
          Send message
        </Button>
      </div>
    </div>
  );
}
