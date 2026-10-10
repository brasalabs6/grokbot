import { redirect } from "next/navigation";
import { auth } from "@/app/(auth)/auth";
import { AgentSessionsDashboard } from "@/components/agent-sessions/dashboard";
import { listAgentSessions } from "@/lib/db/agent-queries";

export const metadata = { title: "Agent Sessions — GrokBot" };
export default async function AgentSessionsPage() {
  const session = await auth();
  if (!session?.user || session.user.type === "guest") {
    redirect("/login");
  }
  const items = await listAgentSessions(session.user.id);
  return (
    <AgentSessionsDashboard
      initialItems={items.map((item) => ({
        generation: item.generation,
        id: item.id,
        modelId: item.modelId,
        state: item.state,
        title: item.title,
        updatedAt: item.updatedAt.toISOString(),
      }))}
    />
  );
}
