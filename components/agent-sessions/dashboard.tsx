"use client";
import { Bot, Loader2, Plus, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Item = {
  id: string;
  title: string;
  state: string;
  modelId: string;
  updatedAt: string;
  generation: number;
};
export function AgentSessionsDashboard({
  initialItems,
}: {
  initialItems: Item[];
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [model, setModel] = useState("cf-qwen3.8-27b");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function create() {
    setCreating(true);
    setError(null);
    try {
      const response = await fetch("/api/agent-sessions", {
        body: JSON.stringify({
          modelId: model,
          permissionMode: "ask",
          title: title || undefined,
          workspace: { kind: "empty" },
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const result = (await response.json()) as {
        error?: { code?: string };
        session: { id: string };
      };
      if (!response.ok) {
        throw new Error(result.error?.code || "Unable to create session");
      }
      router.push(`/agent-sessions/${result.session.id}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unexpected error");
    } finally {
      setCreating(false);
    }
  }
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col gap-8 px-4 py-6 md:px-8 md:py-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Agent sessions</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Run Grok Build in isolated Cloudflare sandboxes.
          </p>
        </div>
        <Button onClick={() => router.refresh()} variant="outline">
          <RefreshCw className="mr-2 size-4" />
          Refresh
        </Button>
      </div>
      <section
        aria-label="Create agent session"
        className="rounded-xl border p-4 md:p-6"
      >
        <h2 className="font-medium">New session</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
          <label className="grid gap-1 text-sm">
            Title
            <Input
              maxLength={160}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="My coding task"
              value={title}
            />
          </label>
          <label className="grid gap-1 text-sm">
            Grok model (existing Brasamain proxy)
            <Input
              readOnly
              aria-label="CF Qwen 3.8 27B (tested model)"
              placeholder="cf-qwen3.8-27b"
              value={model}
            />
          </label>
          <Button
            disabled={creating || !model.trim()}
            onClick={() => void create()}
          >
            {creating ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Plus className="mr-2 size-4" />
            )}
            Create
          </Button>
        </div>
        {error && (
          <p className="mt-3 text-sm text-red-500" role="alert">
            {error}
          </p>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Creating a session reserves its record. Provisioning begins only after
          the runtime is configured; it will not be marked READY until ACP is
          healthy.
        </p>
      </section>
      <section aria-label="Existing agent sessions" className="grid gap-3">
        <h2 className="font-medium">Recent sessions</h2>
        {initialItems.length === 0 ? (
          <p className="rounded-xl border p-6 text-sm text-muted-foreground">
            No sessions yet. Create one above.
          </p>
        ) : (
          initialItems.map((item) => (
            <Link
              className="flex items-center gap-3 rounded-xl border p-4 transition-colors hover:bg-muted/40"
              href={`/agent-sessions/${item.id}`}
              key={item.id}
            >
              <div className="rounded-lg bg-muted p-2">
                <Bot className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{item.title}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {item.modelId} · Generation {item.generation}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs font-medium">{item.state}</p>
                <p className="text-xs text-muted-foreground">
                  {new Date(item.updatedAt).toLocaleString()}
                </p>
              </div>
            </Link>
          ))
        )}
      </section>
    </main>
  );
}
