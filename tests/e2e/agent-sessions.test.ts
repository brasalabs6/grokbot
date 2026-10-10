import { expect, test } from "@playwright/test";

test.describe("GrokBot internal MVP", () => {
  test.describe.configure({ mode: "serial" });

  test("unauthenticated visitors reach sign-in without guest provisioning", async ({ page }) => {
    await page.goto("/agent-sessions");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    const unauthenticated = await page.request.get("/api/agent-sessions");
    expect(unauthenticated.status()).toBe(401);
  });

  test("signup denies addresses outside the internal allowlist", async ({ page }) => {
    await page.goto("/register");
    await page.getByLabel("Email").fill("uninvited@example.test");
    await page.getByLabel("Password").fill("not-allowed-password");
    await page.getByLabel("Private invitation code").fill("invalid-invite");
    await page.getByRole("button", { name: "Sign up" }).click();
    await expect(page.getByText("Registration requires an authorized email and a private invitation code.")).toBeVisible();
    await expect(page).toHaveURL(/\/register$/);
  });

  test("internal account registers, loads dashboard and sees disabled runtime", async ({ page }) => {
    await page.goto("/register");
    await page.getByLabel("Email").fill("internal-test@example.test");
    await page.getByLabel("Password").fill("ci-test-password-2026");
    await page.getByLabel("Private invitation code").fill("ci-only-registration-code-32-chars-long");
    await page.getByRole("button", { name: "Sign up" }).click();
    await expect(page.getByText("Account created!")).toBeVisible();
    await page.goto("/agent-sessions");
    await expect(page.getByRole("heading", { name: "Agent sessions" })).toBeVisible();
    await expect(page.getByText("No sessions yet. Create one above.")).toBeVisible();
    const list = await page.request.get("/api/agent-sessions");
    expect(list.status()).toBe(200);
    expect((await list.json()).items).toEqual([]);
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("RUNTIME_DISABLED");
  });
});
