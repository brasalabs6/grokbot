import { redirect } from "next/navigation";

/** GrokBot launches into the coding-agent session manager, not the old demo chat. */
export default function Page() {
  redirect("/agent-sessions");
}
