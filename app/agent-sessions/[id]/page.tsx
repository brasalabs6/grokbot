import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/app/(auth)/auth";
import { SessionDetail } from "@/components/agent-sessions/session-detail";
import { getAgentSession } from "@/lib/db/agent-queries";

type Params = { params: Promise<{ id: string }> };
export default async function AgentSessionPage({ params }: Params) {
  const authSession = await auth();
  if (!authSession?.user || authSession.user.type === "guest") {
    redirect("/login");
  }
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    notFound();
  }
  const session = await getAgentSession(id, authSession.user.id);
  if (!session) {
    notFound();
  }
  return (
    <main className="flex min-h-dvh flex-col bg-background">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b px-4 py-4 md:px-8">
        <div>
          <Link
            className="text-sm text-muted-foreground hover:underline"
            href="/agent-sessions"
          >
            ← All sessions
          </Link>
          <h1 className="mt-1 text-xl font-semibold">{session.title}</h1>
        </div>
        <div className="rounded-lg border px-3 py-1 text-xs">
          {session.state}
        </div>
      </header>
      <SessionDetail
        generation={session.generation}
        id={session.id}
        initialState={session.state}
        modelId={session.modelId}
        stateVersion={session.stateVersion}
      />
    </main>
  );
}
