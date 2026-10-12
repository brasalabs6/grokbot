import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

test.skip(
  process.env.GROKBOT_STAGING_E2E !== "1",
  "Requires protected staging credentials and an isolated PostgreSQL."
);

test("internal user provisions Cloudflare ACP and receives real tool output", async ({
  page,
}) => {
  test.setTimeout(440_000);
  const runtimeURL = process.env.CLOUDFLARE_RUNTIME_URL;
  const controlSecret = process.env.CONTROL_PLANE_SERVICE_SECRET;
  if (!runtimeURL || !controlSecret || controlSecret.length < 32) {
    throw new Error("STAGING_E2E_CREDENTIALS_MISSING");
  }

  let sandboxSessionId: string | undefined;
  const marker = `CLIENT_E2E_${randomUUID().slice(0, 12)}`;

  try {
    await page.goto("/register");
    await page.getByLabel("Email").fill("grokbot-browser-ci@example.test");
    await page.getByLabel("Password").fill("browser-ci-password");
    await page
      .getByLabel("Private invitation code")
      .fill("grokbot-browser-ci-only-invite-32-characters");
    await page.getByRole("button", { name: "Sign up" }).click();
    await expect(page.getByText("Account created!")).toBeVisible();

    await page.goto("/agent-sessions");
    await expect(
      page.getByRole("heading", { name: "Agent sessions" })
    ).toBeVisible();
    await page
      .getByLabel("Title")
      .fill("Disposable Cloudflare browser acceptance");
    await page.getByRole("button", { exact: true, name: "Create" }).click();
    await expect(page).toHaveURL(/\/agent-sessions\/[0-9a-f-]{36}$/);
    sandboxSessionId = page.url().split("/").at(-1);
    if (!sandboxSessionId) {
      throw new Error("SESSION_CREATION_NOT_CONFIRMED");
    }

    await page
      .getByRole("button", { name: "Provision Cloudflare sandbox" })
      .click();
    await expect(page.getByText(/ACP connected/)).toBeVisible({
      timeout: 90_000,
    });

    await page
      .getByRole("textbox")
      .last()
      .fill(
        `Create /workspace/grokbot-browser-proof.txt with exactly ${marker} on one line, then read the file with a real tool. Do not merely describe it.`
      );
    await page.getByRole("button", { name: "Send message" }).click();

    await expect
      .poll(
        async () => {
          // Permission mode is "ask". Respond via the actual UI only in this
          // disposable test sandbox, rather than bypassing agent authorization.
          const dialog = page.getByRole("alertdialog", {
            name: "Tool permission requested",
          });
          if (await dialog.isVisible().catch(() => false)) {
            const options = dialog.getByRole("button");
            const labels = await options.allTextContents();
            const preferred = labels.findIndex(
              (label) =>
                /allow|approve|yes|run|execute/i.test(label) &&
                !/deny|reject/i.test(label)
            );
            const fallback = labels.findIndex(
              (label) => !/deny|reject/i.test(label)
            );
            const chosen = preferred >= 0 ? preferred : fallback;
            if (chosen < 0) throw new Error("SAFE_TOOL_PERMISSION_NOT_FOUND");
            await options.nth(chosen).click();
          }
          const result = await page.request.get(
            `/api/agent-sessions/${sandboxSessionId}/files?mode=read&path=grokbot-browser-proof.txt`
          );
          if (!result.ok()) {
            return null;
          }
          const body = (await result.json()) as {
            ok?: boolean;
            content?: string;
          };
          return body.ok ? body.content?.trim() : null;
        },
        { intervals: [1000, 2000, 5000], timeout: 180_000 }
      )
      .toBe(marker);

    // A successful tool run can advance the optimistic session version.
    // STOP must read the current version instead of using the initial render.
    await expect.poll(async () => {
      const response = await page.request.get(`/api/agent-sessions/${sandboxSessionId}`);
      const body = (await response.json()) as { session?: { state?: string } };
      return body.session?.state;
    }, { timeout: 60_000 }).toBe("IDLE");

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Stop and checkpoint" }).click();
    await expect.poll(async () => {
      const response = await page.request.get(`/api/agent-sessions/${sandboxSessionId}`);
      const body = (await response.json()) as { session?: { state?: string } };
      return body.session?.state;
    }, { timeout: 60_000 }).toBe("STOPPED");

    await page
      .getByRole("button", { name: "Resume Cloudflare sandbox" })
      .click();
    await expect(page.getByText(/ACP connected/)).toBeVisible({
      timeout: 90_000,
    });

    const postRestore = await page.request.get(
      `/api/agent-sessions/${sandboxSessionId}/files?mode=read&path=grokbot-browser-proof.txt`
    );
    expect(postRestore.status()).toBe(200);
    const restored = (await postRestore.json()) as { content?: string };
    expect(restored.content?.trim()).toBe(marker);
  } finally {
    // Always clean up the disposable sandbox directly through the trusted
    // staging control plane, even if browser auth or reconciliation fails.
    if (sandboxSessionId) {
      const stopURL = new URL(`/internal/${sandboxSessionId}/stop`, runtimeURL);
      const response = await fetch(stopURL, {
        body: JSON.stringify({ checkpoint: false, operationId: randomUUID() }),
        headers: {
          Authorization: `Bearer ${controlSecret}`,
          "Content-Type": "application/json",
        },
        method: "POST",
        signal: AbortSignal.timeout(100_000),
      }).catch(() => null);
      if (!response?.ok) {
        throw new Error("STAGING_SANDBOX_CLEANUP_NOT_CONFIRMED");
      }
      const result = (await response.json()) as { running?: boolean };
      if (result.running !== false) {
        throw new Error("STAGING_SANDBOX_STILL_RUNNING");
      }
    }
  }
});
